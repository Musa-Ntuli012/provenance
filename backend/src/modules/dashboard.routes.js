import { Router } from 'express';
import { withTenant } from '../db/pool.js';
import { authRequired } from '../middleware/auth.js';
import { isClientRole } from '../lib/rbac.js';

export const dashboardRouter = Router();
dashboardRouter.use(authRequired);

dashboardRouter.get('/', async (req, res, next) => {
  try {
    const data = await withTenant(req.user.tenantId, async (db) => {
      if (isClientRole(req.user.role)) {
        // Client portal dashboard: their projects and pending sign-offs only.
        const scope = req.user.clientOrgId
          ? db.query(
              `SELECT COUNT(*)::int AS client_projects,
                      COALESCE(SUM(contract_value), 0)::text AS portfolio_value
                 FROM projects WHERE client_org_id = $1`,
              [req.user.clientOrgId],
            )
          : Promise.resolve({ rows: [{ client_projects: 0, portfolio_value: '0' }] });
        const pending = db.query(
          `SELECT p.id, p.name, g.stage_index
             FROM projects p JOIN stage_gates g ON g.project_id = p.id
            WHERE p.client_org_id = $1 AND g.status = 'PENDING_CLIENT'
            ORDER BY g.opened_at`,
          [req.user.clientOrgId ?? '00000000-0000-0000-0000-000000000000'],
        );
        const [s, p] = await Promise.all([scope, pending]);
        return {
          kind: 'client',
          kpis: { clientProjects: s.rows[0].client_projects, portfolioValue: s.rows[0].portfolio_value },
          pendingApprovals: p.rows,
        };
      }

      const yearStart = `${new Date().getUTCFullYear()}-01-01`;

      const kpis = (
        await db.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'ACTIVE')::int AS active_projects,
             COUNT(*) FILTER (WHERE status = 'COMPLETE')::int AS completed_projects,
             COALESCE(SUM(contract_value) FILTER (WHERE status <> 'COMPLETE'), 0)::text AS portfolio_value,
             COALESCE(SUM(contract_value), 0)::text AS total_contract_value
           FROM projects`,
        )
      ).rows[0];

      const certified = (
        await db.query(
          `SELECT COALESCE(SUM(gross_value - deductions) FILTER (WHERE status = 'CERTIFIED'), 0)::text AS certified_all,
                  COALESCE(SUM(gross_value - deductions) FILTER (WHERE status = 'CERTIFIED' AND certified_at >= $1), 0)::text AS certified_ytd
             FROM payment_certificates`,
          [yearStart],
        )
      ).rows[0];

      const pendingEndorsements = (
        await db.query(
          `SELECT COUNT(*)::int AS n
             FROM stage_gates g
            WHERE g.status = 'IN_PROGRESS'
              AND EXISTS (SELECT 1 FROM project_domain_assignments a
                           WHERE a.project_id = g.project_id AND a.user_id = $1
                             AND a.domain = ANY($2::text[]))
              AND NOT EXISTS (SELECT 1 FROM endorsements e
                               WHERE e.project_id = g.project_id AND e.stage_index = g.stage_index
                                 AND e.domain IN (SELECT domain FROM project_domain_assignments a2
                                                   WHERE a2.project_id = g.project_id AND a2.user_id = $1)
                                 AND e.decision = 'ENDORSED'
                                 AND e.created_at > COALESCE(g.client_reviewed_at, to_timestamp(0)))`,
          [
            req.user.id,
            req.user.role === 'CONSTRUCTION_MANAGER'
              ? ['CONSTRUCTION_MANAGEMENT']
              : req.user.role === 'GEOTECHNICAL_LEAD'
                ? ['GEOTECHNICAL']
                : req.user.role === 'PROFESSIONAL_SERVICES_LEAD'
                  ? ['PROFESSIONAL_SERVICES']
                  : ['PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT'],
          ],
        )
      ).rows[0].n;

      const pendingClient = (
        await db.query(`SELECT COUNT(*)::int AS n FROM stage_gates WHERE status = 'PENDING_CLIENT'`)
      ).rows[0].n;

      const certifiedByMonth = (
        await db.query(
          `SELECT to_char(date_trunc('month', certified_at), 'YYYY-MM') AS month,
                  SUM(gross_value - deductions)::text AS net_value
             FROM payment_certificates
            WHERE status = 'CERTIFIED' AND certified_at >= (now() - interval '6 months')
            GROUP BY 1 ORDER BY 1`,
        )
      ).rows;

      const stageDistribution = (
        await db.query(
          `SELECT current_stage_index, COUNT(*)::int AS n FROM projects
            WHERE status <> 'COMPLETE' GROUP BY 1 ORDER BY 1`,
        )
      ).rows;

      const recentActivity = (
        await db.query(
          `SELECT a.action, a.summary, a.entity, a.created_at, u.full_name AS actor_name
             FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
            ORDER BY a.created_at DESC LIMIT 8`,
        )
      ).rows;

      const outstandingTasks = (
        await db.query(
          `SELECT t.id, t.title, t.status, t.priority, t.due_date, p.name AS project_name
             FROM tasks t JOIN projects p ON p.id = t.project_id
            WHERE t.status <> 'DONE' AND (t.assignee_id = $1 OR t.assignee_id IS NULL)
            ORDER BY CASE t.priority WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 ELSE 2 END, t.due_date NULLS LAST
            LIMIT 6`,
          [req.user.id],
        )
      ).rows;

      return {
        kind: 'firm',
        kpis: {
          activeProjects: kpis.active_projects,
          completedProjects: kpis.completed_projects,
          portfolioValue: kpis.portfolio_value,
          totalContractValue: kpis.total_contract_value,
          certifiedAll: certified.certified_all,
          certifiedYtd: certified.certified_ytd,
          pendingEndorsements,
          pendingClientApprovals: pendingClient,
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
