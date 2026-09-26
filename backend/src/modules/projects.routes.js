import { Router } from 'express';
import { z } from 'zod';
import { withTenant, withTenantTx, toRow } from '../db/mongo.js';
import { audit } from '../lib/audit.js';
import { uuidField } from '../lib/fields.js';
import { authRequired, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  clientScopeFilter,
  getProjectDetail,
  loadProjectForUser,
  createProject,
  endorseStage,
  clientStageApproval,
} from './projects.service.js';

export const projectsRouter = Router();
projectsRouter.use(authRequired);

const DOMAIN_ENUM = ['PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT'];

const listSchema = z.object({
  query: z.object({
    domain: z.enum(DOMAIN_ENUM).optional(),
    status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETE']).optional(),
    q: z.string().trim().max(120).optional(),
  }),
});

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

projectsRouter.get('/', validate(listSchema), async (req, res, next) => {
  try {
    const { domain, status, q } = req.data.query;
    const rows = await withTenant(req.user.tenantId, async (db) => {
      const filter = { ...clientScopeFilter(req.user) };
      if (domain) {
        const assigned = await db.coll('project_domain_assignments').find(
          { domain },
          { projection: { project_id: 1 } },
        );
        filter._id = { $in: assigned.map((a) => a.project_id) };
      }
      if (status) filter.status = status;
      if (q) {
        const rx = new RegExp(escapeRe(q), 'i');
        filter.$or = [{ name: rx }, { code: rx }, { description: rx }];
      }

      const projects = await db.coll('projects').find(filter, { sort: { created_at: -1 } });
      const clientIds = [...new Set(projects.map((p) => p.client_org_id).filter(Boolean))];
      const projectIds = projects.map((p) => p._id);
      const clients = clientIds.length
        ? await db.coll('client_organisations').find({ _id: { $in: clientIds } }, { projection: { _id: 1, name: 1 } })
        : [];
      const assignments = projectIds.length
        ? await db.coll('project_domain_assignments').find({ project_id: { $in: projectIds } })
        : [];
      const leadIds = [...new Set(assignments.map((a) => a.user_id))];
      const leadUsers = leadIds.length
        ? await db.coll('users').find({ _id: { $in: leadIds } }, { projection: { _id: 1, full_name: 1 } })
        : [];
      const gates = projectIds.length
        ? await db.coll('stage_gates').find(
            { stage_index: { $in: projects.map((p) => p.current_stage_index) }, project_id: { $in: projectIds } },
            { projection: { project_id: 1, stage_index: 1, status: 1 } },
          )
        : [];

      const cMap = new Map(clients.map((c) => [c._id, c.name]));
      const uMap = new Map(leadUsers.map((u) => [u._id, u.full_name]));
      const gateKey = (pid, idx) => `${pid}:${idx}`;
      const gMap = new Map(gates.map((g) => [gateKey(g.project_id, g.stage_index), g.status]));
      const domainOrder = DOMAIN_ENUM;

      return projects.map((p) => ({
        id: p._id,
        code: p.code,
        name: p.name,
        status: p.status,
        current_stage_index: p.current_stage_index,
        contract_value: p.contract_value,
        currency: p.currency,
        start_date: p.start_date,
        target_end_date: p.target_end_date,
        latitude: p.latitude,
        longitude: p.longitude,
        client_name: p.client_org_id ? (cMap.get(p.client_org_id) ?? null) : null,
        leads: assignments
          .filter((a) => a.project_id === p._id)
          .sort((a, b) => domainOrder.indexOf(a.domain) - domainOrder.indexOf(b.domain))
          .map((a) => ({ domain: a.domain, userId: a.user_id, name: uMap.get(a.user_id) ?? null })),
        gate_status: gMap.get(gateKey(p._id, p.current_stage_index)) ?? null,
      }));
    });
    res.json({ projects: rows });
  } catch (err) {
    next(err);
  }
});

/** Gates awaiting the requesting user, feeds the Approvals screen.
 *  (Declared before /:id so "approvals" is never mistaken for an id.) */
projectsRouter.get('/approvals/pending', async (req, res, next) => {
  try {
    const rows = await withTenant(req.user.tenantId, async (db) => {
      const scope = clientScopeFilter(req.user);

      if (req.user.role === 'CLIENT_APPROVER') {
        return pendingFor(db, scope, ['PENDING_CLIENT']);
      }
      const domainByRole = {
        PROFESSIONAL_SERVICES_LEAD: 'PROFESSIONAL_SERVICES',
        GEOTECHNICAL_LEAD: 'GEOTECHNICAL',
        CONSTRUCTION_MANAGER: 'CONSTRUCTION_MANAGEMENT',
      };
      const domain = domainByRole[req.user.role];
      if (req.user.role === 'ORG_ADMIN' || req.user.role === 'PM') {
        return pendingFor(db, scope, ['IN_PROGRESS', 'PENDING_CLIENT']);
      }
      if (domain) {
        // Their assigned projects, current gate open, still owed a fresh
        // endorsement from their domain.
        const mine = await db.coll('project_domain_assignments').find(
          { domain, user_id: req.user.id },
          { projection: { project_id: 1 } },
        );
        const projects = mine.length
          ? await db.coll('projects').find({ ...scope, _id: { $in: mine.map((a) => a.project_id) } }, { projection: { _id: 1, code: 1, name: 1, client_org_id: 1, current_stage_index: 1 } })
          : [];
        const clientIds = [...new Set(projects.map((p) => p.client_org_id).filter(Boolean))];
        const clients = clientIds.length
          ? await db.coll('client_organisations').find({ _id: { $in: clientIds } }, { projection: { _id: 1, name: 1 } })
          : [];
        const cMap = new Map(clients.map((c) => [c._id, c.name]));
        const out = [];
        for (const p of projects) {
          const gate = await db.coll('stage_gates').findOne(
            { project_id: p._id, stage_index: p.current_stage_index, status: 'IN_PROGRESS' },
            { sort: { opened_at: 1 } },
          );
          if (!gate) continue;
          const fresh = await db.coll('endorsements').countDocuments({
            project_id: p._id,
            stage_index: gate.stage_index,
            domain,
            decision: 'ENDORSED',
            created_at: { $gt: gate.client_reviewed_at ?? new Date(0) },
          });
          if (fresh > 0) continue;
          out.push({
            id: p._id,
            code: p.code,
            name: p.name,
            client_name: p.client_org_id ? (cMap.get(p.client_org_id) ?? null) : null,
            current_stage_index: p.current_stage_index,
            pending_stage: gate.stage_index,
            status: gate.status,
          });
        }
        return out;
      }
      return [];
    });
    res.json({ pending: rows });
  } catch (err) {
    next(err);
  }
});

/** Shared shape for admin/PM and client pending lists. */
async function pendingFor(db, scope, statuses) {
  const projects = await db.coll('projects').find(scope, {
    projection: { _id: 1, code: 1, name: 1, client_org_id: 1, current_stage_index: 1 },
  });
  const projectIds = projects.map((p) => p._id);
  const gates = projectIds.length
    ? await db.coll('stage_gates').find(
        { project_id: { $in: projectIds }, status: { $in: statuses } },
        { sort: { opened_at: 1 } },
      )
    : [];
  const clientIds = [...new Set(projects.map((p) => p.client_org_id).filter(Boolean))];
  const clients = clientIds.length
    ? await db.coll('client_organisations').find({ _id: { $in: clientIds } }, { projection: { _id: 1, name: 1 } })
    : [];
  const pMap = new Map(projects.map((p) => [p._id, p]));
  const cMap = new Map(clients.map((c) => [c._id, c.name]));
  return gates
    .map((g) => {
      const p = pMap.get(g.project_id);
      if (!p || g.stage_index !== p.current_stage_index) return null;
      return {
        id: p._id,
        code: p.code,
        name: p.name,
        client_name: p.client_org_id ? (cMap.get(p.client_org_id) ?? null) : null,
        current_stage_index: p.current_stage_index,
        pending_stage: g.stage_index,
        status: g.status,
      };
    })
    .filter(Boolean);
}

projectsRouter.get('/:id', validate(z.object({ params: z.object({ id: uuidField }) })), async (req, res, next) => {
  try {
    const detail = await withTenant(req.user.tenantId, (db) =>
      getProjectDetail(db, req.user, req.data.params.id),
    );
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

const domainAssignment = z.object({ domain: z.enum(DOMAIN_ENUM), userId: uuidField });
const money = z.number().finite();

const createSchema = z.object({
  body: z.object({
    name: z.string().trim().min(3).max(160),
    description: z.string().trim().max(4000).optional(),
    clientOrgId: uuidField.optional(),
    contractValue: money.nonnegative().optional(),
    currency: z.enum(['ZAR', 'USD', 'EUR', 'GBP']).default('ZAR'),
    startDate: z.string().date().optional(),
    targetEndDate: z.string().date().optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    domains: z.array(domainAssignment).max(3).default([]),
    funding: z
      .array(
        z.object({
          sourceName: z.string().trim().min(1).max(120),
          funderType: z.enum(['client', 'internal', 'lender', 'other']).default('client'),
          amount: money.nonnegative(),
        }),
      )
      .default([]),
  }),
});

projectsRouter.post('/', requireCapability('projects.write'), validate(createSchema), async (req, res, next) => {
  try {
    const project = await withTenantTx(req.user.tenantId, (db) => createProject(db, req.user, req.data.body));
    res.status(201).json({ project });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  params: z.object({ id: uuidField }),
  body: z.object({
    description: z.string().trim().max(4000).optional(),
    status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETE']).optional(),
    targetEndDate: z.string().date().nullable().optional(),
  }),
});

projectsRouter.patch('/:id', requireCapability('projects.write'), validate(patchSchema), async (req, res, next) => {
  const { id } = req.data.params;
  const b = req.data.body;
  try {
    const row = await withTenantTx(req.user.tenantId, async (db) => {
      await loadProjectForUser(db, req.user, id);
      const $set = {};
      if (b.description !== undefined) $set.description = b.description;
      if (b.status !== undefined) $set.status = b.status;
      if (b.targetEndDate !== undefined) $set.target_end_date = b.targetEndDate;
      const doc = await db.coll('projects').findOneAndUpdate({ _id: id }, { $set }, { returnDocument: 'after' });
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'project.updated',
        entity: 'project',
        entityId: id,
        summary: `Project updated, ${doc.code}`,
        detail: b,
      });
      return toRow(doc);
    });
    res.json({ project: row });
  } catch (err) {
    next(err);
  }
});

const endorseSchema = z.object({
  params: z.object({ id: uuidField, stageIndex: z.coerce.number().int().min(1).max(11) }),
  body: z.object({
    domain: z.enum(DOMAIN_ENUM),
    decision: z.enum(['ENDORSED', 'CHANGES_REQUESTED']),
    note: z.string().trim().max(2000).optional(),
  }),
});

projectsRouter.post(
  '/:id/stages/:stageIndex/endorse',
  requireCapability('endorse'),
  validate(endorseSchema),
  async (req, res, next) => {
    const { id, stageIndex } = req.data.params;
    const { domain, decision, note } = req.data.body;
    try {
      const gate = await withTenantTx(req.user.tenantId, (db) =>
        endorseStage(db, req.user, id, stageIndex, domain, decision, note),
      );
      res.json({ gate: gate ? toRow(gate) : gate });
    } catch (err) {
      next(err);
    }
  },
);

const approvalSchema = z.object({
  params: z.object({ id: uuidField, stageIndex: z.coerce.number().int().min(1).max(11) }),
  body: z.object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    note: z.string().trim().max(2000).optional(),
  }),
});

projectsRouter.post(
  '/:id/stages/:stageIndex/client-approval',
  requireCapability('approvals.client'),
  validate(approvalSchema),
  async (req, res, next) => {
    const { id, stageIndex } = req.data.params;
    const { decision, note } = req.data.body;
    try {
      const result = await withTenantTx(req.user.tenantId, (db) =>
        clientStageApproval(db, req.user, id, stageIndex, decision, note),
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
