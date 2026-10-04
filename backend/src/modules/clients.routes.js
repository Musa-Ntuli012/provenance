import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { withTenant } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { emailField, passwordField, uuidField } from '../lib/fields.js';
import { authRequired, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const clientsRouter = Router();
clientsRouter.use(authRequired);

const READ_COLUMNS = `id, name, org_type, contact_name, contact_email, created_at`;

clientsRouter.get('/', async (req, res, next) => {
  try {
    const rows = await withTenant(req.user.tenantId, (db) =>
      db.query(
        `SELECT c.id, c.name, c.org_type, c.contact_name, c.contact_email, c.created_at,
                COUNT(p.id)::int AS project_count,
                COALESCE(SUM(p.contract_value), 0)::text AS total_value
           FROM client_organisations c
           LEFT JOIN projects p ON p.client_org_id = c.id
          GROUP BY c.id
          ORDER BY c.name`,
      ),
    );
    res.json({ clients: rows.rows });
  } catch (err) {
    next(err);
  }
});

const createSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(160),
    orgType: z.enum(['municipality', 'government_dept', 'private_entity', 'soe', 'other']),
    contactName: z.string().trim().min(2).max(120).optional(),
    contactEmail: emailField.optional(),
  }),
});

clientsRouter.post('/', requireCapability('clients.write'), validate(createSchema), async (req, res, next) => {
  const b = req.data.body;
  try {
    const row = await withTenant(req.user.tenantId, async (db) => {
      const r = await db.query(
        `INSERT INTO client_organisations (name, org_type, contact_name, contact_email)
         VALUES ($1, $2, $3, $4) RETURNING ${READ_COLUMNS}`,
        [b.name, b.orgType, b.contactName ?? null, b.contactEmail ?? null],
      );
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'client.created',
        entity: 'client',
        entityId: r.rows[0].id,
        summary: `Client added, ${b.name}`,
      });
      return r.rows[0];
    });
    res.status(201).json({ client: row });
  } catch (err) {
    next(err);
  }
});

/** Grant a client contact portal access to their organisation's projects.
 *  CLIENT_APPROVER = standing sign-off rights; CLIENT_TEMP = time-boxed. */
const accessSchema = z.object({
  body: z.object({
    clientId: uuidField,
    email: emailField,
    fullName: z.string().trim().min(2).max(120),
    kind: z.enum(['CLIENT_APPROVER', 'CLIENT_TEMP']),
    expiresInDays: z.number().int().min(1).max(90).optional(),
    temporaryPassword: passwordField,
  }),
});

clientsRouter.post('/access', requireCapability('clients.write'), validate(accessSchema), async (req, res, next) => {
  const b = req.data.body;
  try {
    const hash = await bcrypt.hash(b.temporaryPassword, 12);
    const expires = b.kind === 'CLIENT_TEMP' ? new Date(Date.now() + (b.expiresInDays ?? 14) * 86400_000) : null;
    const row = await withTenant(req.user.tenantId, async (db) => {
      const client = await db.query('SELECT id, name FROM client_organisations WHERE id = $1', [b.clientId]);
      if (client.rowCount === 0) throw notFound('Client not found');
      const r = await db.query(
        `INSERT INTO users (email, password_hash, full_name, role, client_org_id, access_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, full_name, role, client_org_id, status, access_expires_at, created_at`,
        [b.email, hash, b.fullName, b.kind, b.clientId, expires],
      );
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'client.access_granted',
        entity: 'user',
        entityId: r.rows[0].id,
        summary: `${b.fullName} granted ${b.kind === 'CLIENT_TEMP' ? 'temporary' : 'standing'} access for ${client.rows[0].name}`,
        detail: { clientId: b.clientId, kind: b.kind, expires },
      });
      return r.rows[0];
    });
    res.status(201).json({ user: row });
  } catch (err) {
    if (err?.code === '23505') return next(conflict('That email already has portal access'));
    next(err);
  }
});

const patchSchema = z.object({
  params: z.object({ id: uuidField }),
  body: z.object({
    name: z.string().trim().min(2).max(160).optional(),
    orgType: z.enum(['municipality', 'government_dept', 'private_entity', 'soe', 'other']).optional(),
    contactName: z.string().trim().min(2).max(120).optional(),
    contactEmail: emailField.optional(),
  }),
});

clientsRouter.patch('/:id', requireCapability('clients.write'), validate(patchSchema), async (req, res, next) => {
  const { id } = req.data.params;
  const b = req.data.body;
  try {
    const row = await withTenant(req.user.tenantId, async (db) => {
      const r = await db.query(
        `UPDATE client_organisations SET
           name = COALESCE($2, name),
           org_type = COALESCE($3, org_type),
           contact_name = COALESCE($4, contact_name),
           contact_email = COALESCE($5, contact_email)
         WHERE id = $1
         RETURNING ${READ_COLUMNS}`,
        [id, b.name ?? null, b.orgType ?? null, b.contactName ?? null, b.contactEmail ?? null],
      );
      if (r.rowCount === 0) throw notFound('Client not found');
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'client.updated',
        entity: 'client',
        entityId: id,
        summary: `Client updated, ${b.name ?? r.rows[0].name}`,
        detail: b,
      });
      return r.rows[0];
    });
    res.json({ client: row });
  } catch (err) {
    next(err);
  }
});
