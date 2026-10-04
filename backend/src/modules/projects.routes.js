import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { uuidField } from '../lib/fields.js';
import { authRequired, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import {
  clientScopePredicate,
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

projectsRouter.get('/', validate(listSchema), async (req, res, next) => {
  try {
    const { domain, status, q } = req.data.query;
    const scope = clientScopePredicate(req.user, 'p', 1);
    const params = [...scope.params];
    const where = [scope.clause];

    if (domain) {
      params.push(domain);
      where.push(
        `EXISTS (SELECT 1 FROM project_domain_assignments a WHERE a.project_id = p.id AND a.domain = $${params.length})`,
      );
    }
    if (status) {
      params.push(status);
      where.push(`p.status = $${params.length}`);
    }
    if (q) {
      params.push(`%${q}%`);
      where.push(
        `(p.name ILIKE $${params.length} OR p.code ILIKE $${params.length} OR p.description ILIKE $${params.length})`,
      );
    }

    const rows = await withTenant(req.user.tenantId, (db) =>
      db.query(
        `SELECT p.id, p.code, p.name, p.status, p.current_stage_index, p.contract_value, p.currency,
                p.start_date, p.target_end_date, p.latitude, p.longitude,
                c.name AS client_name,
                (SELECT json_agg(json_build_object('domain', a.domain, 'userId', u.id, 'name', u.full_name))
                   FROM project_domain_assignments a JOIN users u ON u.id = a.user_id
                  WHERE a.project_id = p.id) AS leads,
                (SELECT g.status FROM stage_gates g
                  WHERE g.project_id = p.id AND g.stage_index = p.current_stage_index) AS gate_status
           FROM projects p
           LEFT JOIN client_organisations c ON c.id = p.client_org_id
          WHERE ${where.join(' AND ')}
          ORDER BY p.created_at DESC`,
        params,
      ),
    );
    res.json({ projects: rows.rows });
  } catch (err) {
    next(err);
  }
});

/** Gates awaiting the requesting user, feeds the Approvals screen.
 *  (Declared before /:id so “approvals” is never mistaken for an id.) */
projectsRouter.get('/approvals/pending', async (req, res, next) => {
  try {
    const rows = await withTenant(req.user.tenantId, (db) => {
      const scope = clientScopePredicate(req.user, 'p', 1);
      const params = [...scope.params];
      let sql;
      if (req.user.role === 'CLIENT_APPROVER') {
        sql = `SELECT p.id, p.code, p.name, c.name AS client_name, p.current_stage_index,
                      g.stage_index AS pending_stage, g.status
                 FROM projects p
                 JOIN stage_gates g ON g.project_id = p.id
                       AND g.stage_index = p.current_stage_index AND g.status = 'PENDING_CLIENT'
                 LEFT JOIN client_organisations c ON c.id = p.client_org_id
                WHERE ${scope.clause} ORDER BY g.opened_at`;
        return db.query(sql, params);
      }
      const domainByRole = {
        PROFESSIONAL_SERVICES_LEAD: 'PROFESSIONAL_SERVICES',
        GEOTECHNICAL_LEAD: 'GEOTECHNICAL',
        CONSTRUCTION_MANAGER: 'CONSTRUCTION_MANAGEMENT',
      };
      const domain = domainByRole[req.user.role];
      if (req.user.role === 'ORG_ADMIN' || req.user.role === 'PM') {
        sql = `SELECT p.id, p.code, p.name, c.name AS client_name, p.current_stage_index,
                      g.stage_index AS pending_stage, g.status
                 FROM projects p
                 JOIN stage_gates g ON g.project_id = p.id
                       AND g.stage_index = p.current_stage_index AND g.status IN ('IN_PROGRESS','PENDING_CLIENT')
                 LEFT JOIN client_organisations c ON c.id = p.client_org_id
                WHERE ${scope.clause} ORDER BY g.opened_at`;
        return db.query(sql, params);
      }
      if (domain) {
        params.push(domain);
        sql = `SELECT p.id, p.code, p.name, c.name AS client_name, p.current_stage_index,
                      g.stage_index AS pending_stage, g.status
                 FROM projects p
                 JOIN stage_gates g ON g.project_id = p.id
                       AND g.stage_index = p.current_stage_index AND g.status = 'IN_PROGRESS'
                 LEFT JOIN client_organisations c ON c.id = p.client_org_id
                WHERE ${scope.clause}
                  AND EXISTS (SELECT 1 FROM project_domain_assignments a
                               WHERE a.project_id = p.id AND a.domain = $${params.length}
                                 AND a.user_id = $${params.length + 1})
                  AND NOT EXISTS (SELECT 1 FROM endorsements e
                                   WHERE e.project_id = p.id AND e.stage_index = g.stage_index
                                     AND e.domain = $${params.length} AND e.decision = 'ENDORSED'
                                     AND e.created_at > COALESCE(g.client_reviewed_at, to_timestamp(0)))
                ORDER BY g.opened_at`;
        params.push(req.user.id);
        return db.query(sql, params);
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    });
    res.json({ pending: rows.rows });
  } catch (err) {
    next(err);
  }
});

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
    const project = await withTenant(req.user.tenantId, (db) => createProject(db, req.user, req.data.body));
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
    const row = await withTenant(req.user.tenantId, async (db) => {
      await loadProjectForUser(db, req.user, id);
      const r = await db.query(
        `UPDATE projects SET
           description = COALESCE($2, description),
           status = COALESCE($3, status),
           target_end_date = CASE WHEN $4 THEN $5 ELSE target_end_date END
         WHERE id = $1 RETURNING *`,
        [id, b.description ?? null, b.status ?? null, b.targetEndDate !== undefined, b.targetEndDate ?? null],
      );
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'project.updated',
        entity: 'project',
        entityId: id,
        summary: `Project updated, ${r.rows[0].code}`,
        detail: b,
      });
      return r.rows[0];
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
      const gate = await withTenant(req.user.tenantId, (db) =>
        endorseStage(db, req.user, id, stageIndex, domain, decision, note),
      );
      res.json({ gate });
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
      const result = await withTenant(req.user.tenantId, (db) =>
        clientStageApproval(db, req.user, id, stageIndex, decision, note),
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);
