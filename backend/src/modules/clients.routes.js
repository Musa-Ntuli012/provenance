import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { withTenant, withTenantTx, isDuplicateKey, toRow } from '../db/mongo.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { emailField, passwordField, uuidField } from '../lib/fields.js';
import { authRequired, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const clientsRouter = Router();
clientsRouter.use(authRequired);

const CLIENT_PROJECTION = {
  _id: 1, name: 1, org_type: 1, contact_name: 1, contact_email: 1, created_at: 1,
};

clientsRouter.get('/', async (req, res, next) => {
  try {
    const rows = await withTenant(req.user.tenantId, async (db) => {
      const clients = await db.coll('client_organisations').find({}, { sort: { name: 1 }, projection: CLIENT_PROJECTION });
      // Project counts and contract value totals per client (LEFT JOIN
      // semantics: clients without projects show zero / "0").
      const totals = await db.coll('projects').aggregate([
        { $group: { _id: '$client_org_id', n: { $sum: 1 }, total: { $sum: { $toDecimal: '$contract_value' } } } },
      ]);
      const byClient = new Map(totals.map((t) => [t._id, t]));
      return clients.map((c) => {
        const t = byClient.get(c._id);
        const total = t?.total ? Number(t.total) : 0;
        return {
          ...toRow(c),
          project_count: t?.n ?? 0,
          total_value: total === 0 ? '0' : total.toFixed(2),
        };
      });
    });
    res.json({ clients: rows });
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
    const row = await withTenantTx(req.user.tenantId, async (db) => {
      const doc = await db.coll('client_organisations').insertOne({
        name: b.name,
        org_type: b.orgType,
        contact_name: b.contactName ?? null,
        contact_email: b.contactEmail ?? null,
        created_at: new Date(),
      });
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'client.created',
        entity: 'client',
        entityId: doc._id,
        summary: `Client added, ${b.name}`,
      });
      return doc;
    });
    res.status(201).json({ client: toRow(row) });
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
    const row = await withTenantTx(req.user.tenantId, async (db) => {
      const client = await db.coll('client_organisations').findOne({ _id: b.clientId }, { projection: { _id: 1, name: 1 } });
      if (!client) throw notFound('Client not found');
      const doc = await db.coll('users').insertOne({
        email: b.email,
        password_hash: hash,
        full_name: b.fullName,
        role: b.kind,
        client_org_id: b.clientId,
        status: 'ACTIVE',
        access_expires_at: expires,
        created_at: new Date(),
        last_login_at: null,
      });
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'client.access_granted',
        entity: 'user',
        entityId: doc._id,
        summary: `${b.fullName} granted ${b.kind === 'CLIENT_TEMP' ? 'temporary' : 'standing'} access for ${client.name}`,
        detail: { clientId: b.clientId, kind: b.kind, expires },
      });
      return doc;
    });
    res.status(201).json({
      user: toRow({
        _id: row._id,
        email: row.email,
        full_name: row.full_name,
        role: row.role,
        client_org_id: row.client_org_id,
        status: row.status,
        access_expires_at: row.access_expires_at,
        created_at: row.created_at,
      }),
    });
  } catch (err) {
    if (isDuplicateKey(err)) return next(conflict('That email already has portal access'));
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
    const row = await withTenantTx(req.user.tenantId, async (db) => {
      const $set = {};
      if (b.name !== undefined) $set.name = b.name;
      if (b.orgType !== undefined) $set.org_type = b.orgType;
      if (b.contactName !== undefined) $set.contact_name = b.contactName;
      if (b.contactEmail !== undefined) $set.contact_email = b.contactEmail;
      const doc = await db.coll('client_organisations').findOneAndUpdate({ _id: id }, { $set }, {
        returnDocument: 'after',
        projection: CLIENT_PROJECTION,
      });
      if (!doc) throw notFound('Client not found');
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'client.updated',
        entity: 'client',
        entityId: id,
        summary: `Client updated, ${b.name ?? doc.name}`,
        detail: b,
      });
      return doc;
    });
    res.json({ client: toRow(row) });
  } catch (err) {
    next(err);
  }
});
