import { Router } from 'express';
import { z } from 'zod';
import { withTenant, withTenantTx, toRow } from '../db/mongo.js';
import { audit } from '../lib/audit.js';
import { emailField } from '../lib/fields.js';
import { authRequired, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const tenantsRouter = Router();
tenantsRouter.use(authRequired);

tenantsRouter.get('/current', async (req, res, next) => {
  try {
    const t = await withTenant(req.user.tenantId, (db) =>
      db.coll('tenants').findOne(
        { _id: req.user.tenantId },
        { projection: { _id: 1, name: 1, slug: 1, industry: 1, contact_name: 1, contact_email: 1, workflow_profile: 1, created_at: 1 } },
      ),
    );
    res.json({ tenant: { ...t, id: t._id } });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(120).optional(),
    industry: z.string().trim().min(2).max(80).optional(),
    contactName: z.string().trim().min(2).max(120).optional(),
    contactEmail: emailField.optional(),
  }),
});

tenantsRouter.patch('/current', requireCapability('tenant.write'), validate(patchSchema), async (req, res, next) => {
  const b = req.data.body;
  try {
    const row = await withTenantTx(req.user.tenantId, async (db) => {
      const $set = {};
      if (b.name !== undefined) $set.name = b.name;
      if (b.industry !== undefined) $set.industry = b.industry;
      if (b.contactName !== undefined) $set.contact_name = b.contactName;
      if (b.contactEmail !== undefined) $set.contact_email = b.contactEmail;
      const r = await db.coll('tenants').findOneAndUpdate(
        { _id: req.user.tenantId },
        { $set },
        { returnDocument: 'after', projection: { _id: 1, name: 1, slug: 1, industry: 1, contact_name: 1, contact_email: 1, workflow_profile: 1 } },
      );
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'tenant.updated',
        entity: 'tenant',
        entityId: req.user.tenantId,
        summary: 'Organisation settings updated',
        detail: b,
      });
      return toRow(r);
    });
    res.json({ tenant: row });
  } catch (err) {
    next(err);
  }
});
