import { Router } from 'express';
import { z } from 'zod';
import { withTenant, withTenantTx, toRow } from '../db/mongo.js';
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
        return [];
      }
      const tasks = await db.coll('tasks').find({}, { sort: { position: 1, created_at: 1 } });
      const projectIds = [...new Set(tasks.map((t) => t.project_id))];
      const assigneeIds = [...new Set(tasks.map((t) => t.assignee_id).filter(Boolean))];
      const projects = projectIds.length
        ? await db.coll('projects').find({ _id: { $in: projectIds } }, { projection: { _id: 1, name: 1, code: 1 } })
        : [];
      const users = assigneeIds.length
        ? await db.coll('users').find({ _id: { $in: assigneeIds } }, { projection: { _id: 1, full_name: 1 } })
        : [];
      const pMap = new Map(projects.map((p) => [p._id, p]));
      const uMap = new Map(users.map((u) => [u._id, u]));
      return tasks.map((t) => ({
        ...toRow(t),
        project_name: pMap.get(t.project_id)?.name ?? null,
        project_code: pMap.get(t.project_id)?.code ?? null,
        assignee_name: t.assignee_id ? (uMap.get(t.assignee_id)?.full_name ?? null) : null,
      }));
    });
    res.json({ tasks: rows });
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
    const row = await withTenantTx(req.user.tenantId, async (db) => {
      const p = await db.coll('projects').findOne({ _id: b.projectId }, { projection: { _id: 1 } });
      if (!p) throw notFound('Project not found');
      const agg = await db.coll('tasks').aggregate([
        { $match: { project_id: b.projectId, status: 'BACKLOG' } },
        { $group: { _id: null, minPos: { $min: '$position' } } },
      ]);
      const position = (agg[0]?.minPos ?? 0) - 1;
      const doc = await db.coll('tasks').insertOne({
        project_id: b.projectId,
        title: b.title,
        description: b.description ?? null,
        status: 'BACKLOG',
        priority: b.priority,
        assignee_id: b.assigneeId ?? null,
        due_date: b.dueDate ?? null,
        position,
        domain: b.domain ?? null,
        created_at: new Date(),
      });
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'task.created',
        entity: 'task',
        entityId: doc._id,
        summary: `Task created, ${b.title}`,
      });
      return doc;
    });
    res.status(201).json({ task: toRow(row) });
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
    const row = await withTenantTx(req.user.tenantId, async (db) => {
      const $set = {};
      if (b.status !== undefined) $set.status = b.status;
      if (b.position !== undefined) $set.position = b.position;
      if (b.assigneeId !== undefined) $set.assignee_id = b.assigneeId;
      if (b.priority !== undefined) $set.priority = b.priority;
      if (b.dueDate !== undefined) $set.due_date = b.dueDate;
      const doc = await db.coll('tasks').findOneAndUpdate({ _id: id }, { $set }, { returnDocument: 'after' });
      if (!doc) throw notFound('Task not found');
      if (b.status) {
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'task.moved',
          entity: 'task',
          entityId: id,
          summary: `Task "${doc.title}" moved to ${b.status.replaceAll('_', ' ').toLowerCase()}`,
        });
      }
      return doc;
    });
    res.json({ task: toRow(row) });
  } catch (err) {
    next(err);
  }
});
