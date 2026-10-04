import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../db/pool.js';
import { authRequired, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const auditRouter = Router();
auditRouter.use(authRequired, requireCapability('audit.read'));

const listSchema = z.object({
  query: z.object({
    entity: z.string().trim().max(40).optional(),
    projectId: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  }),
});

/** Append-only trail, reads only; there is no write or delete route here.
 *  Writes happen inside the transactions that make the change. */
auditRouter.get('/', validate(listSchema), async (req, res, next) => {
  try {
    const { entity, projectId, limit } = req.data.query;
    const params = [];
    const where = ['true'];
    if (entity) {
      params.push(entity);
      where.push(`a.entity = $${params.length}`);
    }
    if (projectId) {
      params.push(projectId);
      where.push(`a.entity_id = $${params.length}`);
    }
    params.push(limit);
    const rows = await withTenant(req.user.tenantId, (db) =>
      db.query(
        `SELECT a.id, a.action, a.entity, a.entity_id, a.summary, a.detail, a.created_at,
                u.full_name AS actor_name, a.actor_role
           FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
          WHERE ${where.join(' AND ')}
          ORDER BY a.created_at DESC
          LIMIT $${params.length}`,
        params,
      ),
    );
    res.json({ events: rows.rows });
  } catch (err) {
    next(err);
  }
});
