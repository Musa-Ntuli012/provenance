import { Router } from 'express';
import { z } from 'zod';
import { withTenant, toRow } from '../db/mongo.js';
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
    const filter = {};
    if (entity) filter.entity = entity;
    if (projectId) filter.entity_id = projectId;

    const rows = await withTenant(req.user.tenantId, async (db) => {
      const events = await db.coll('audit_events').find(filter, { sort: { created_at: -1 }, limit });
      const actorIds = [...new Set(events.map((a) => a.actor_id).filter(Boolean))];
      const actors = actorIds.length
        ? await db.coll('users').find({ _id: { $in: actorIds } }, { projection: { _id: 1, full_name: 1 } })
        : [];
      const uMap = new Map(actors.map((u) => [u._id, u.full_name]));
      return events.map((a) => ({
        ...toRow(a),
        actor_name: a.actor_id ? (uMap.get(a.actor_id) ?? null) : null,
      }));
    });
    res.json({ events: rows });
  } catch (err) {
    next(err);
  }
});
