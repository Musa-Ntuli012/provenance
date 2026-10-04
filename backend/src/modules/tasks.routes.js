import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { uuidField } from '../lib/fields.js';
import { authRequired, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { isClientRole } from '../lib/rbac.js';

export const tasksRouter = Router();
tasksRouter.use(authRequired);

const DOMAIN_ENUM = ['PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT'];

tasksRouter.get('/', async (req, res, next) => {
  try {
    const rows = await withTenant(req.user.tenantId, async (db) => {
      if (isClientRole(req.user.role)) {
        // Client portal users have no task board.
        return db.query('SELECT * FROM tasks WHERE false');
      }
      return db.query(
        `SELECT t.*, p.name AS project_name, p.code AS project_code, u.full_name AS assignee_name
           FROM tasks t JOIN projects p ON p.id = t.project_id
           LEFT JOIN users u ON u.id = t.assignee_id
          ORDER BY t.position, t.created_at`,
      );
    });
    res.json({ tasks: rows.rows });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  body: z.object({
    projectId: uuidField,
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(2000).optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
    assigneeId: uuidField.optional(),
    dueDate: z.string().date().optional(),
    domain: z.enum(DOMAIN_ENUM).optional(),
  }),
});

tasksRouter.post('/', requireCapability('tasks.write'), validate(createSchema), async (req, res, next) => {
  const b = req.data.body;
  try {
    const row = await withTenant(req.user.tenantId, async (db) => {
      const p = await db.query('SELECT id FROM projects WHERE id = $1', [b.projectId]);
      if (p.rowCount === 0) throw notFound('Project not found');
      const pos = await db.query(
        `SELECT COALESCE(MIN(position), 0) - 1 AS p FROM tasks WHERE project_id = $1 AND status = 'BACKLOG'`,
        [b.projectId],
      );
      const r = await db.query(
        `INSERT INTO tasks (project_id, title, description, priority, assignee_id, due_date, domain, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          b.projectId, b.title, b.description ?? null, b.priority,
          b.assigneeId ?? null, b.dueDate ?? null, b.domain ?? null, pos.rows[0].p,
        ],
      );
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'task.created',
        entity: 'task',
        entityId: r.rows[0].id,
        summary: `Task created, ${b.title}`,
      });
      return r.rows[0];
    });
    res.status(201).json({ task: row });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  params: z.object({ id: uuidField }),
  body: z.object({
    status: z.enum(['BACKLOG', 'IN_PROGRESS', 'REVIEW', 'DONE']).optional(),
    position: z.number().int().optional(),
    assigneeId: uuidField.nullable().optional(),
    priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    dueDate: z.string().date().nullable().optional(),
  }),
});

tasksRouter.patch('/:id', requireCapability('tasks.write'), validate(patchSchema), async (req, res, next) => {
  const { id } = req.data.params;
  const b = req.data.body;
  try {
    const row = await withTenant(req.user.tenantId, async (db) => {
      const r = await db.query(
        `UPDATE tasks SET
           status = COALESCE($2, status),
           position = COALESCE($3, position),
           assignee_id = CASE WHEN $4 THEN $5 ELSE assignee_id END,
           priority = COALESCE($6, priority),
           due_date = CASE WHEN $7 THEN $8 ELSE due_date END
         WHERE id = $1 RETURNING *`,
        [
          id,
          b.status ?? null,
          b.position ?? null,
          b.assigneeId !== undefined, b.assigneeId ?? null,
          b.priority ?? null,
          b.dueDate !== undefined, b.dueDate ?? null,
        ],
      );
      if (r.rowCount === 0) throw notFound('Task not found');
      if (b.status) {
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'task.moved',
          entity: 'task',
          entityId: id,
          summary: `Task “${r.rows[0].title}” moved to ${b.status.replaceAll('_', ' ').toLowerCase()}`,
        });
      }
      return r.rows[0];
    });
    res.json({ task: row });
  } catch (err) {
    next(err);
  }
});
