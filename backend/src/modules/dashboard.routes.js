import { Router } from 'express';
import { withTenant } from '../db/mongo.js';
import { authRequired } from '../middleware/auth.js';
import { isClientRole } from '../lib/rbac.js';

export const dashboardRouter = Router();
dashboardRouter.use(authRequired);

const ROLE_DOMAINS = {
  PROFESSIONAL_SERVICES_LEAD: ['PROFESSIONAL_SERVICES'],
  GEOTECHNICAL_LEAD: ['GEOTECHNICAL'],
  CONSTRUCTION_MANAGER: ['CONSTRUCTION_MANAGEMENT'],
};
const ALL_DOMAINS = ['PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT'];

/** Money strings behave like the SQL types did: values carry two decimals,
 *  an empty sum is the string "0". */
const sumMoney = (rows, field) => {
  const total = rows.reduce((s, r) => s + (parseFloat(r[field]) || 0), 0);
  return total === 0 ? '0' : total.toFixed(2);
};

const netOf = (c) => (parseFloat(c.gross_value) || 0) - (parseFloat(c.deductions) || 0);

dashboardRouter.get('/', async (req, res, next) => {
  try {
    const data = await withTenant(req.user.tenantId, async (db) => {
      if (isClientRole(req.user.role)) {
        // Client portal dashboard: their projects and pending sign-offs only.
        const projects = req.user.clientOrgId
          ? await db.coll('projects').find(
              { client_org_id: req.user.clientOrgId },
              { projection: { _id: 1, contract_value: 1 } },
            )
          : [];
        const gates = await db.coll('stage_gates').find(
          { status: 'PENDING_CLIENT' },
          { sort: { opened_at: 1 }, projection: { project_id: 1, stage_index: 1 } },
        );
        const scoped = req.user.clientOrgId ? new Set(projects.map((p) => p._id)) : new Set();
        const pendingApprovals = [];
        for (const g of gates) {
          if (!scoped.has(g.project_id)) continue;
          const p = projects.find((x) => x._id === g.project_id);
          if (!p) continue;
          const full = await db.coll('projects').findOne(
            { _id: g.project_id },
            { projection: { _id: 1, name: 1 } },
          );
          pendingApprovals.push({ id: full._id, name: full.name, stage_index: g.stage_index });
        }
        return {
          kind: 'client',
          kpis: {
            clientProjects: projects.length,
            portfolioValue: sumMoney(projects, 'contract_value'),
          },
          pendingApprovals,
        };
      }

      const yearStart = `${new Date().getUTCFullYear()}-01-01`;

      const projects = await db.coll('projects').find(
        {},
        { projection: { _id: 1, status: 1, current_stage_index: 1, contract_value: 1 } },
      );
      const activeProjects = projects.filter((p) => p.status === 'ACTIVE').length;
      const completedProjects = projects.filter((p) => p.status === 'COMPLETE').length;
      const portfolio = sumMoney(projects.filter((p) => p.status !== 'COMPLETE'), 'contract_value');
      const totalContract = sumMoney(projects, 'contract_value');

      const certs = await db.coll('payment_certificates').find(
        { status: 'CERTIFIED' },
        { projection: { gross_value: 1, deductions: 1, certified_at: 1 } },
      );
      const certifiedAll = certs.reduce((s, c) => s + netOf(c), 0);
      const certifiedYtd = certs
        .filter((c) => c.certified_at && c.certified_at.toISOString().slice(0, 10) >= yearStart)
        .reduce((s, c) => s + netOf(c), 0);
      const money = (n) => (n === 0 ? '0' : n.toFixed(2));

      // Gates where one of the requester's assigned domains still owes a fresh
      // endorsement (fresh = newer than any client rejection of the gate).
      const roleDomains = ROLE_DOMAINS[req.user.role] ?? ALL_DOMAINS;
      const assignments = await db.coll('project_domain_assignments').find(
        { user_id: req.user.id },
        { projection: { project_id: 1, domain: 1 } },
      );
      const byProject = new Map();
      for (const a of assignments) {
        if (!byProject.has(a.project_id)) byProject.set(a.project_id, []);
        byProject.get(a.project_id).push(a.domain);
      }
      const openGates = await db.coll('stage_gates').find(
        { status: 'IN_PROGRESS' },
        { projection: { _id: 1, project_id: 1, stage_index: 1, client_reviewed_at: 1 } },
      );
      let pendingEndorsements = 0;
      for (const g of openGates) {
        const mine = byProject.get(g.project_id) ?? [];
        if (!mine.some((d) => roleDomains.includes(d))) continue;
        const fresh = await db.coll('endorsements').find(
          {
            project_id: g.project_id,
            stage_index: g.stage_index,
            decision: 'ENDORSED',
            domain: { $in: mine },
            created_at: { $gt: g.client_reviewed_at ?? new Date(0) },
          },
          { projection: { domain: 1 } },
        );
        const done = new Set(fresh.map((e) => e.domain));
        if (!mine.every((d) => done.has(d))) pendingEndorsements += 1;
      }

      const pendingClientApprovals = await db.coll('stage_gates').countDocuments({ status: 'PENDING_CLIENT' });

      const sixMonthsAgo = new Date(Date.now() - 180 * 86400_000);
      const monthlyCerts = await db.coll('payment_certificates').aggregate([
        { $match: { status: 'CERTIFIED', certified_at: { $gte: sixMonthsAgo } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m', date: '$certified_at' } },
            net: { $sum: { $subtract: [{ $toDecimal: '$gross_value' }, { $toDecimal: '$deductions' }] } },
          },
        },
        { $sort: { _id: 1 } },
      ]);
      const certifiedByMonth = monthlyCerts.map((m) => ({
        month: m._id,
        net_value: Number(m.net) === 0 ? '0' : Number(m.net).toFixed(2),
      }));

      const stageCounts = new Map();
      for (const p of projects) {
        if (p.status === 'COMPLETE') continue;
        stageCounts.set(p.current_stage_index, (stageCounts.get(p.current_stage_index) ?? 0) + 1);
      }
      const stageDistribution = [...stageCounts.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([current_stage_index, n]) => ({ current_stage_index, n }));

      const recent = await db.coll('audit_events').find({}, { sort: { created_at: -1 }, limit: 8 });
      const actorIds = [...new Set(recent.map((a) => a.actor_id).filter(Boolean))];
      const actors = actorIds.length
        ? await db.coll('users').find({ _id: { $in: actorIds } }, { projection: { _id: 1, full_name: 1 } })
        : [];
      const aMap = new Map(actors.map((u) => [u._id, u.full_name]));
      const recentActivity = recent.map((a) => ({
        action: a.action,
        summary: a.summary,
        entity: a.entity,
        created_at: a.created_at,
        actor_name: a.actor_id ? (aMap.get(a.actor_id) ?? null) : null,
      }));

      const openTasks = await db.coll('tasks').find(
        { status: { $ne: 'DONE' }, $or: [{ assignee_id: req.user.id }, { assignee_id: null }] },
      );
      const taskProjectIds = [...new Set(openTasks.map((t) => t.project_id))];
      const taskProjects = taskProjectIds.length
        ? await db.coll('projects').find({ _id: { $in: taskProjectIds } }, { projection: { _id: 1, name: 1 } })
        : [];
      const tpMap = new Map(taskProjects.map((p) => [p._id, p.name]));
      const priorityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      const outstandingTasks = openTasks
        .sort((x, y) => {
          const p = (priorityRank[x.priority] ?? 3) - (priorityRank[y.priority] ?? 3);
          if (p !== 0) return p;
          const dx = x.due_date ?? null;
          const dy = y.due_date ?? null;
          if (dx === dy) return 0;
          if (dx === null) return 1;
          if (dy === null) return -1;
          return dx < dy ? -1 : 1;
        })
        .slice(0, 6)
        .map((t) => ({
          id: t._id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          due_date: t.due_date,
          project_name: tpMap.get(t.project_id) ?? null,
        }));

      return {
        kind: 'firm',
        kpis: {
          activeProjects,
          completedProjects,
          portfolioValue: portfolio,
          totalContractValue: totalContract,
          certifiedAll: money(certifiedAll),
          certifiedYtd: money(certifiedYtd),
          pendingEndorsements,
          pendingClientApprovals,
        },
        certifiedByMonth,
        stageDistribution,
        recentActivity,
        outstandingTasks,
      };
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
});
