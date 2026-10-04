import { Router } from 'express';
import { z } from 'zod';
import { withTenant } from '../db/pool.js';
import { audit } from '../lib/audit.js';
import { conflict, notFound } from '../lib/errors.js';
import { uuidField } from '../lib/fields.js';
import { authRequired, requireCapability } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { ROLE_BY_DOMAIN } from '../lib/rbac.js';
import { loadProjectForUser } from './projects.service.js';

export const financeRouter = Router();
financeRouter.use(authRequired);

const DOMAIN_ENUM = ['PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT'];
const money = z.number().finite();
const money2 = (v) => v.toFixed(2);

async function loadProject(db, user, projectId) {
  return loadProjectForUser(db, user, projectId);
}

/* ========================== Payment certificates ========================= */

const certCreateSchema = z.object({
  params: z.object({ id: uuidField }),
  body: z
    .object({
      certificateNo: z.string().trim().min(1).max(40),
      periodStart: z.string().date(),
      periodEnd: z.string().date(),
      grossValue: money.nonnegative(),
      deductions: money.nonnegative().default(0),
      domain: z.enum(DOMAIN_ENUM),
    })
    .refine((b) => b.periodEnd >= b.periodStart, { message: 'Period end must be after period start' })
    .refine((b) => b.deductions <= b.grossValue, { message: 'Deductions cannot exceed the gross value' }),
});

financeRouter.get('/projects/:id/certificates', requireCapability('finance.read'), async (req, res, next) => {
  try {
    const rows = await withTenant(req.user.tenantId, async (db) => {
      await loadProject(db, req.user, req.params.id);
      return db.query(
        `SELECT pc.*, u.full_name AS endorsed_by_name
           FROM payment_certificates pc LEFT JOIN users u ON u.id = pc.endorsed_by
          WHERE pc.project_id = $1 ORDER BY pc.period_end DESC, pc.created_at DESC`,
        [req.params.id],
      );
    });
    res.json({ certificates: rows.rows });
  } catch (err) {
    next(err);
  }
});

financeRouter.post(
  '/projects/:id/certificates',
  requireCapability('finance.write'),
  validate(certCreateSchema),
  async (req, res, next) => {
    const { id } = req.data.params;
    const b = req.data.body;
    try {
      const row = await withTenant(req.user.tenantId, async (db) => {
        await loadProject(db, req.user, id);
        const r = await db.query(
          `INSERT INTO payment_certificates
             (project_id, certificate_no, period_start, period_end, gross_value, deductions, domain, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [id, b.certificateNo, b.periodStart, b.periodEnd, money2(b.grossValue), money2(b.deductions), b.domain, req.user.id],
        );
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'certificate.created',
          entity: 'payment_certificate',
          entityId: r.rows[0].id,
          summary: `Payment certificate ${b.certificateNo} raised (${b.grossValue.toFixed(2)} gross)`,
          detail: b,
        });
        return r.rows[0];
      });
      res.status(201).json({ certificate: row });
    } catch (err) {
      if (err?.code === '23505') return next(conflict('That certificate number already exists on this project'));
      next(err);
    }
  },
);

async function loadCertificate(db, certificateId) {
  const r = await db.query('SELECT * FROM payment_certificates WHERE id = $1', [certificateId]);
  if (r.rowCount === 0) throw notFound('Certificate not found');
  return r.rows[0];
}

const endorseCertSchema = z.object({
  params: z.object({ id: uuidField }),
  body: z.object({ decision: z.enum(['ENDORSED', 'REJECTED']) }),
});

financeRouter.post(
  '/certificates/:id/endorse',
  requireCapability('finance.endorse'),
  validate(endorseCertSchema),
  async (req, res, next) => {
    try {
      const row = await withTenant(req.user.tenantId, async (db) => {
        const cert = await loadCertificate(db, req.data.params.id);
        if (cert.status !== 'DRAFT') throw conflict(`Certificate is already ${cert.status.toLowerCase()}`);
        // Domain-scoped: leads endorse only their own domain's records.
        if (req.user.role !== 'ORG_ADMIN' && ROLE_BY_DOMAIN[cert.domain] !== req.user.role) {
          throw notFound('Certificate not found');
        }
        const status = req.data.body.decision === 'ENDORSED' ? 'ENDORSED' : 'REJECTED';
        const r = await db.query(
          `UPDATE payment_certificates SET status = $2, endorsed_by = $3, endorsed_at = now()
            WHERE id = $1 RETURNING *`,
          [cert.id, status, req.user.id],
        );
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: status === 'ENDORSED' ? 'certificate.endorsed' : 'certificate.rejected',
          entity: 'payment_certificate',
          entityId: cert.id,
          summary: `Payment certificate ${cert.certificate_no} ${status.toLowerCase()}`,
        });
        return r.rows[0];
      });
      res.json({ certificate: row });
    } catch (err) {
      next(err);
    }
  },
);

financeRouter.post(
  '/certificates/:id/certify',
  requireCapability('finance.certify'),
  validate(z.object({ params: z.object({ id: uuidField }) })),
  async (req, res, next) => {
    try {
      const row = await withTenant(req.user.tenantId, async (db) => {
        const cert = await loadCertificate(db, req.data.params.id);
        if (cert.status !== 'ENDORSED') throw conflict('Only an endorsed certificate can be certified');
        const r = await db.query(
          `UPDATE payment_certificates SET status = 'CERTIFIED', certified_at = now() WHERE id = $1 RETURNING *`,
          [cert.id],
        );
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'certificate.certified',
          entity: 'payment_certificate',
          entityId: cert.id,
          summary: `Payment certificate ${cert.certificate_no} certified`,
        });
        return r.rows[0];
      });
      res.json({ certificate: row });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================= Variation orders =========================== */

const voCreateSchema = z.object({
  params: z.object({ id: uuidField }),
  body: z.object({
    voNumber: z.string().trim().min(1).max(40),
    description: z.string().trim().min(3).max(2000),
    value: money.refine((v) => v !== 0, { message: 'Value cannot be zero' }),
    timeImpactDays: z.number().int().min(-365).max(3650).default(0),
  }),
});

financeRouter.get('/projects/:id/variation-orders', requireCapability('finance.read'), async (req, res, next) => {
  try {
    const rows = await withTenant(req.user.tenantId, async (db) => {
      await loadProject(db, req.user, req.params.id);
      return db.query(
        `SELECT vo.*, u.full_name AS endorsed_by_name FROM variation_orders vo
           LEFT JOIN users u ON u.id = vo.endorsed_by
          WHERE vo.project_id = $1 ORDER BY vo.created_at DESC`,
        [req.params.id],
      );
    });
    res.json({ variationOrders: rows.rows });
  } catch (err) {
    next(err);
  }
});

financeRouter.post(
  '/projects/:id/variation-orders',
  requireCapability('finance.write'),
  validate(voCreateSchema),
  async (req, res, next) => {
    const { id } = req.data.params;
    const b = req.data.body;
    try {
      const row = await withTenant(req.user.tenantId, async (db) => {
        await loadProject(db, req.user, id);
        const r = await db.query(
          `INSERT INTO variation_orders (project_id, vo_number, description, value, time_impact_days)
           VALUES ($1,$2,$3,$4,$5) RETURNING *`,
          [id, b.voNumber, b.description, money2(b.value), b.timeImpactDays],
        );
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'variation.created',
          entity: 'variation_order',
          entityId: r.rows[0].id,
          summary: `Variation order ${b.voNumber} proposed (${b.value.toFixed(2)})`,
          detail: b,
        });
        return r.rows[0];
      });
      res.status(201).json({ variationOrder: row });
    } catch (err) {
      if (err?.code === '23505') return next(conflict('That variation number already exists on this project'));
      next(err);
    }
  },
);

financeRouter.post(
  '/variation-orders/:id/endorse',
  requireCapability('finance.endorse'),
  validate(z.object({ params: z.object({ id: uuidField }) })),
  async (req, res, next) => {
    try {
      const row = await withTenant(req.user.tenantId, async (db) => {
        const vo = (
          await db.query('SELECT * FROM variation_orders WHERE id = $1', [req.data.params.id])
        ).rows[0];
        if (!vo) throw notFound('Variation order not found');
        if (vo.status !== 'PROPOSED') throw conflict(`Variation is already ${vo.status.toLowerCase()}`);
        const r = await db.query(
          `UPDATE variation_orders SET status = 'ENDORSED', endorsed_by = $2 WHERE id = $1 RETURNING *`,
          [vo.id, req.user.id],
        );
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'variation.endorsed',
          entity: 'variation_order',
          entityId: vo.id,
          summary: `Variation order ${vo.vo_number} endorsed`,
        });
        return r.rows[0];
      });
      res.json({ variationOrder: row });
    } catch (err) {
      next(err);
    }
  },
);

financeRouter.post(
  '/variation-orders/:id/decision',
  requireCapability('finance.write'),
  validate(z.object({ params: z.object({ id: uuidField }), body: z.object({ decision: z.enum(['APPROVED', 'REJECTED']) }) })),
  async (req, res, next) => {
    try {
      const row = await withTenant(req.user.tenantId, async (db) => {
        const vo = (
          await db.query('SELECT * FROM variation_orders WHERE id = $1', [req.data.params.id])
        ).rows[0];
        if (!vo) throw notFound('Variation order not found');
        if (vo.status !== 'ENDORSED') throw conflict('Only an endorsed variation can be decided');
        const r = await db.query(
          `UPDATE variation_orders SET status = $2, approved_at = CASE WHEN $2 = 'APPROVED' THEN now() END
            WHERE id = $1 RETURNING *`,
          [vo.id, req.data.body.decision],
        );
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: `variation.${req.data.body.decision.toLowerCase()}`,
          entity: 'variation_order',
          entityId: vo.id,
          summary: `Variation order ${vo.vo_number} ${req.data.body.decision.toLowerCase()}`,
        });
        return r.rows[0];
      });
      res.json({ variationOrder: row });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================= Funding allocations ======================== */

const fundingSchema = z.object({
  params: z.object({ id: uuidField }),
  body: z.object({
    sourceName: z.string().trim().min(1).max(120),
    funderType: z.enum(['client', 'internal', 'lender', 'other']).default('client'),
    amount: money.nonnegative(),
  }),
});

financeRouter.get('/projects/:id/funding', requireCapability('finance.read'), async (req, res, next) => {
  try {
    const rows = await withTenant(req.user.tenantId, async (db) => {
      await loadProject(db, req.user, req.params.id);
      return db.query(`SELECT * FROM funding_allocations WHERE project_id = $1 ORDER BY created_at`, [req.params.id]);
    });
    res.json({ funding: rows.rows });
  } catch (err) {
    next(err);
  }
});

financeRouter.post('/projects/:id/funding', requireCapability('finance.write'), validate(fundingSchema), async (req, res, next) => {
  const { id } = req.data.params;
  const b = req.data.body;
  try {
    const row = await withTenant(req.user.tenantId, async (db) => {
      await loadProject(db, req.user, id);
      const r = await db.query(
        `INSERT INTO funding_allocations (project_id, source_name, funder_type, amount)
         VALUES ($1,$2,$3,$4) RETURNING *`,
        [id, b.sourceName, b.funderType, money2(b.amount)],
      );
      await audit(db, {
        actorId: req.user.id,
        actorRole: req.user.role,
        action: 'funding.created',
        entity: 'funding_allocation',
        entityId: r.rows[0].id,
        summary: `Funding source "${b.sourceName}" allocated (${b.amount.toFixed(2)})`,
      });
      return r.rows[0];
    });
    res.status(201).json({ allocation: row });
  } catch (err) {
    next(err);
  }
});

financeRouter.delete(
  '/funding/:id',
  requireCapability('finance.write'),
  validate(z.object({ params: z.object({ id: uuidField }) })),
  async (req, res, next) => {
    try {
      await withTenant(req.user.tenantId, async (db) => {
        const r = await db.query('DELETE FROM funding_allocations WHERE id = $1 RETURNING source_name', [
          req.data.params.id,
        ]);
        if (r.rowCount === 0) throw notFound('Allocation not found');
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'funding.removed',
          entity: 'funding_allocation',
          entityId: req.data.params.id,
          summary: `Funding allocation "${r.rows[0].source_name}" removed`,
        });
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
