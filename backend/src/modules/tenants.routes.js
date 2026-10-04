import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { emailField } from '../lib/fields.js';
import { authRequired, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';

export const tenantsRouter = Router();
tenantsRouter.use(authRequired);

tenantsRouter.get('/current', async (req, res, next) => {
  try {
    const row = await withTenant(req.user.tenantId, (db) =>
      db.query(
        `SELECT id, name, slug, industry, contact_name, contact_email, workflow_profile, created_at
           FROM tenants WHERE id = $1`,
        [req.user.tenantId],
      ),
    );
    res.json({ tenant: row.rows[0] });
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
    const row = await withTenant(req.user.tenantId, async (db) => {
      const r = await db.query(
        `UPDATE tenants SET
           name = COALESCE($2, name),
           industry = COALESCE($3, industry),
           contact_name = COALESCE($4, contact_name),
           contact_email = COALESCE($5, contact_email)
         WHERE id = $1
         RETURNING id, name, slug, industry, contact_name, contact_email, workflow_profile`,
        [req.user.tenantId, b.name ?? null, b.industry ?? null, b.contactName ?? null, b.contactEmail ?? null],
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
      return r.rows[0];
    });
    res.json({ tenant: row });
  } catch (err) {
    next(err);
  }
});
