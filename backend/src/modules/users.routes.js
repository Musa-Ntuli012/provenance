import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { withTenant } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { emailField, passwordField, uuidField } from '../lib/fields.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const usersRouter = Router();
usersRouter.use(authRequired);

// password_hash is deliberately absent from every projection below.
const SAFE_COLUMNS =
  'id, email, full_name, role, client_org_id, status, access_expires_at, created_at, last_login_at';

usersRouter.get('/', requireRole('ORG_ADMIN', 'PM'), async (req, res, next) => {
  try {
    const rows = await withTenant(req.user.tenantId, (db) =>
      db.query(`SELECT ${SAFE_COLUMNS} FROM users ORDER BY full_name`),
    );
    res.json({ users: rows.rows });
  } catch (err) {
    next(err);
  }
});

const STAFF_ROLES = [
  'ORG_ADMIN',
  'PM',
  'PROFESSIONAL_SERVICES_LEAD',
  'GEOTECHNICAL_LEAD',
  'CONSTRUCTION_MANAGER',
  'MEMBER',
  'VIEWER',
];

const createSchema = z.object({
  body: z.object({
    email: emailField,
    fullName: z.string().trim().min(2).max(120),
    role: z.enum(STAFF_ROLES),
    // Admin sets the first password; the member changes it from Profile.
    temporaryPassword: passwordField,
  }),
});

usersRouter.post('/', requireRole('ORG_ADMIN'), validate(createSchema), async (req, res, next) => {
  const b = req.data.body;
  try {
    const hash = await bcrypt.hash(b.temporaryPassword, 12);
    const created = await withTenant(req.user.tenantId, async (db) => {
      const row = await db.query(
        `INSERT INTO users (email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4)
         RETURNING ${SAFE_COLUMNS}`,
        [b.email, hash, b.fullName, b.role],
      );
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'user.created',
        entity: 'user',
        entityId: row.rows[0].id,
        summary: `${row.rows[0].full_name} joined as ${b.role}`,
      });
      return row.rows[0];
    });
    res.status(201).json({ user: created });
  } catch (err) {
    if (err?.code === '23505') return next(conflict('That email is already registered in this workspace'));
    next(err);
  }
});

const patchSchema = z.object({
  params: z.object({ id: uuidField }),
  body: z
    .object({
      role: z.enum(STAFF_ROLES).optional(),
      status: z.enum(['ACTIVE', 'DISABLED']).optional(),
    })
    .refine((b) => b.role !== undefined || b.status !== undefined, { message: 'Nothing to update' }),
});

usersRouter.patch('/:id', requireRole('ORG_ADMIN'), validate(patchSchema), async (req, res, next) => {
  const { id } = req.data.params;
  const { role, status } = req.data.body;
  try {
    if (id === req.user.id && (role !== undefined || status === 'DISABLED')) {
      throw badRequest('You cannot change your own role or disable your own account');
    }

    const updated = await withTenant(req.user.tenantId, async (db) => {
      const row = await db.query(
        `UPDATE users SET
           role = COALESCE($2, role),
           status = COALESCE($3, status)
         WHERE id = $1
         RETURNING ${SAFE_COLUMNS}`,
        [id, role ?? null, status ?? null],
      );
      if (row.rowCount === 0) throw notFound('User not found');
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: role ? 'user.role_changed' : 'user.status_changed',
        entity: 'user',
        entityId: id,
        summary: `${row.rows[0].full_name}, ${role ? `role set to ${role}` : `status set to ${status}`}`,
        detail: { role, status },
      });
      if (status === 'DISABLED') {
        // Revocation: a disabled account loses live sessions immediately.
        await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [id]);
      }
      return row.rows[0];
    });

    res.json({ user: updated });
  } catch (err) {
    next(err);
  }
});

/** Self-service password change. Revokes every session (including this one):
 *  the caller is expected to sign in again with the new password. */
const passwordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: passwordField,
  }),
});

usersRouter.post('/me/password', authRequired, validate(passwordSchema), async (req, res, next) => {
  try {
    await withTenant(req.user.tenantId, async (db) => {
      const r = await db.query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
      if (r.rowCount === 0) throw notFound('User not found');
      const ok = await bcrypt.compare(req.data.body.currentPassword, r.rows[0].password_hash);
      if (!ok) {
        throw badRequest('Please check the highlighted fields', [
          { field: 'body.currentPassword', message: 'Current password is incorrect' },
        ]);
      }
      const hash = await bcrypt.hash(req.data.body.newPassword, 12);
      await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [req.user.id, hash]);
      await db.query('UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'user.password_changed',
        entity: 'user',
        entityId: req.user.id,
        summary: `${req.user.fullName} changed their password`,
      });
    });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
