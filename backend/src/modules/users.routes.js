import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { withTenant, withTenantTx, isDuplicateKey, toRow } from '../db/mongo.js';
import { audit } from '../lib/audit.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { emailField, passwordField, uuidField } from '../lib/fields.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const usersRouter = Router();
usersRouter.use(authRequired);

// password_hash is deliberately absent from every projection below.
const SAFE_PROJECTION = {
  _id: 1, email: 1, full_name: 1, role: 1, client_org_id: 1,
  status: 1, access_expires_at: 1, created_at: 1, last_login_at: 1,
};

usersRouter.get('/', requireRole('ORG_ADMIN', 'PM'), async (req, res, next) => {
  try {
    const rows = await withTenant(req.user.tenantId, (db) =>
      db.coll('users').find({}, { sort: { full_name: 1 }, projection: SAFE_PROJECTION }),
    );
    res.json({ users: rows.map(toRow) });
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
    const created = await withTenantTx(req.user.tenantId, async (db) => {
      const doc = await db.coll('users').insertOne({
        email: b.email,
        password_hash: hash,
        full_name: b.fullName,
        role: b.role,
        client_org_id: null,
        status: 'ACTIVE',
        access_expires_at: null,
        created_at: new Date(),
        last_login_at: null,
      });
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'user.created',
        entity: 'user',
        entityId: doc._id,
        summary: `${doc.full_name} joined as ${b.role}`,
      });
      return doc;
    });
    res.status(201).json({ user: toRow(created) });
  } catch (err) {
    if (isDuplicateKey(err)) return next(conflict('That email is already registered in this workspace'));
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

    const updated = await withTenantTx(req.user.tenantId, async (db) => {
      const $set = {};
      if (role !== undefined) $set.role = role;
      if (status !== undefined) $set.status = status;
      const row = await db.coll('users').findOneAndUpdate({ _id: id }, { $set }, {
        returnDocument: 'after',
        projection: SAFE_PROJECTION,
      });
      if (!row) throw notFound('User not found');
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: role ? 'user.role_changed' : 'user.status_changed',
        entity: 'user',
        entityId: id,
        summary: `${row.full_name}, ${role ? `role set to ${role}` : `status set to ${status}`}`,
        detail: { role, status },
      });
      if (status === 'DISABLED') {
        // Revocation: a disabled account loses live sessions immediately.
        await db.coll('sessions').updateMany(
          { user_id: id, revoked_at: null },
          { $set: { revoked_at: new Date() } },
        );
      }
      return row;
    });

    res.json({ user: toRow(updated) });
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
    await withTenantTx(req.user.tenantId, async (db) => {
      const u = await db.coll('users').findOne({ _id: req.user.id }, { projection: { password_hash: 1 } });
      if (!u) throw notFound('User not found');
      const ok = await bcrypt.compare(req.data.body.currentPassword, u.password_hash);
      if (!ok) {
        throw badRequest('Please check the highlighted fields', [
          { field: 'body.currentPassword', message: 'Current password is incorrect' },
        ]);
      }
      const hash = await bcrypt.hash(req.data.body.newPassword, 12);
      await db.coll('users').updateOne({ _id: req.user.id }, { $set: { password_hash: hash } });
      await db.coll('sessions').updateMany(
        { user_id: req.user.id, revoked_at: null },
        { $set: { revoked_at: new Date() } },
      );
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
