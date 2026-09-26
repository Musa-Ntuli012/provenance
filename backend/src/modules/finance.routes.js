import { Router } from 'express';
import { z } from 'zod';
import { withTenant, withTenantTx, isDuplicateKey, toRow } from '../db/mongo.js';
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
      const certs = await db.coll('payment_certificates').find(
        { project_id: req.params.id },
        { sort: { period_end: -1, created_at: -1 } },
      );
      const endorserIds = [...new Set(certs.map((c) => c.endorsed_by).filter(Boolean))];
      const endorsers = endorserIds.length
        ? await db.coll('users').find({ _id: { $in: endorserIds } }, { projection: { _id: 1, full_name: 1 } })
        : [];
      const uMap = new Map(endorsers.map((u) => [u._id, u.full_name]));
      return certs.map((c) => ({ ...toRow(c), endorsed_by_name: c.endorsed_by ? (uMap.get(c.endorsed_by) ?? null) : null }));
    });
    res.json({ certificates: rows });
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
      const row = await withTenantTx(req.user.tenantId, async (db) => {
        await loadProject(db, req.user, id);
        const doc = await db.coll('payment_certificates').insertOne({
          project_id: id,
          certificate_no: b.certificateNo,
          period_start: b.periodStart,
          period_end: b.periodEnd,
          gross_value: money2(b.grossValue),
          deductions: money2(b.deductions),
          status: 'DRAFT',
          domain: b.domain,
          endorsed_by: null,
          endorsed_at: null,
          certified_at: null,
          created_by: req.user.id,
          created_at: new Date(),
        });
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'certificate.created',
          entity: 'payment_certificate',
          entityId: doc._id,
          summary: `Payment certificate ${b.certificateNo} raised (${b.grossValue.toFixed(2)} gross)`,
          detail: b,
        });
        return doc;
      });
      res.status(201).json({ certificate: toRow(row) });
    } catch (err) {
      if (isDuplicateKey(err)) return next(conflict('That certificate number already exists on this project'));
      next(err);
    }
  },
);

async function loadCertificate(db, certificateId) {
  const cert = await db.coll('payment_certificates').findOne({ _id: certificateId });
  if (!cert) throw notFound('Certificate not found');
  return cert;
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
      const row = await withTenantTx(req.user.tenantId, async (db) => {
        const cert = await loadCertificate(db, req.data.params.id);
        if (cert.status !== 'DRAFT') throw conflict(`Certificate is already ${cert.status.toLowerCase()}`);
        // Domain-scoped: leads endorse only their own domain's records.
        if (req.user.role !== 'ORG_ADMIN' && ROLE_BY_DOMAIN[cert.domain] !== req.user.role) {
          throw notFound('Certificate not found');
        }
        const status = req.data.body.decision === 'ENDORSED' ? 'ENDORSED' : 'REJECTED';
        const doc = await db.coll('payment_certificates').findOneAndUpdate(
          { _id: cert._id },
          { $set: { status, endorsed_by: req.user.id, endorsed_at: new Date() } },
          { returnDocument: 'after' },
        );
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: status === 'ENDORSED' ? 'certificate.endorsed' : 'certificate.rejected',
          entity: 'payment_certificate',
          entityId: cert._id,
          summary: `Payment certificate ${cert.certificate_no} ${status.toLowerCase()}`,
        });
        return doc;
      });
      res.json({ certificate: toRow(row) });
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
      const row = await withTenantTx(req.user.tenantId, async (db) => {
        const cert = await loadCertificate(db, req.data.params.id);
        if (cert.status !== 'ENDORSED') throw conflict('Only an endorsed certificate can be certified');
        const doc = await db.coll('payment_certificates').findOneAndUpdate(
          { _id: cert._id },
          { $set: { status: 'CERTIFIED', certified_at: new Date() } },
          { returnDocument: 'after' },
        );
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'certificate.certified',
          entity: 'payment_certificate',
          entityId: cert._id,
          summary: `Payment certificate ${cert.certificate_no} certified`,
        });
        return doc;
      });
      res.json({ certificate: toRow(row) });
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
      const vos = await db.coll('variation_orders').find(
        { project_id: req.params.id },
        { sort: { created_at: -1 } },
      );
      const endorserIds = [...new Set(vos.map((v) => v.endorsed_by).filter(Boolean))];
      const endorsers = endorserIds.length
        ? await db.coll('users').find({ _id: { $in: endorserIds } }, { projection: { _id: 1, full_name: 1 } })
        : [];
      const uMap = new Map(endorsers.map((u) => [u._id, u.full_name]));
      return vos.map((v) => ({ ...toRow(v), endorsed_by_name: v.endorsed_by ? (uMap.get(v.endorsed_by) ?? null) : null }));
    });
    res.json({ variationOrders: rows });
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
      const row = await withTenantTx(req.user.tenantId, async (db) => {
        await loadProject(db, req.user, id);
        const doc = await db.coll('variation_orders').insertOne({
          project_id: id,
          vo_number: b.voNumber,
          description: b.description,
          value: money2(b.value),
          time_impact_days: b.timeImpactDays,
          status: 'PROPOSED',
          endorsed_by: null,
          approved_at: null,
          created_at: new Date(),
        });
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'variation.created',
          entity: 'variation_order',
          entityId: doc._id,
          summary: `Variation order ${b.voNumber} proposed (${b.value.toFixed(2)})`,
          detail: b,
        });
        return doc;
      });
      res.status(201).json({ variationOrder: toRow(row) });
    } catch (err) {
      if (isDuplicateKey(err)) return next(conflict('That variation number already exists on this project'));
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
      const row = await withTenantTx(req.user.tenantId, async (db) => {
        const vo = await db.coll('variation_orders').findOne({ _id: req.data.params.id });
        if (!vo) throw notFound('Variation order not found');
        if (vo.status !== 'PROPOSED') throw conflict(`Variation is already ${vo.status.toLowerCase()}`);
        const doc = await db.coll('variation_orders').findOneAndUpdate(
          { _id: vo._id },
          { $set: { status: 'ENDORSED', endorsed_by: req.user.id } },
          { returnDocument: 'after' },
        );
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'variation.endorsed',
          entity: 'variation_order',
          entityId: vo._id,
          summary: `Variation order ${vo.vo_number} endorsed`,
        });
        return doc;
      });
      res.json({ variationOrder: toRow(row) });
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
      const row = await withTenantTx(req.user.tenantId, async (db) => {
        const vo = await db.coll('variation_orders').findOne({ _id: req.data.params.id });
        if (!vo) throw notFound('Variation order not found');
        if (vo.status !== 'ENDORSED') throw conflict('Only an endorsed variation can be decided');
        const decision = req.data.body.decision;
        const doc = await db.coll('variation_orders').findOneAndUpdate(
          { _id: vo._id },
          {
            $set: {
              status: decision,
              approved_at: decision === 'APPROVED' ? new Date() : null,
            },
          },
          { returnDocument: 'after' },
        );
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: `variation.${decision.toLowerCase()}`,
          entity: 'variation_order',
          entityId: vo._id,
          summary: `Variation order ${vo.vo_number} ${decision.toLowerCase()}`,
        });
        return doc;
      });
      res.json({ variationOrder: toRow(row) });
    } catch (err) {
      next(err);
    }
  },
);

/* ============================= Funding allocations ======================== */

const fundingSchema = z.object({
  params: z.object({ id: uuidField }),
  body: z.object({
    sourceName: z.string().trim().min(1).max(160),
    funderType: z.enum(['client', 'internal', 'lender', 'other']).default('client'),
    amount: money.nonnegative(),
  }),
});

financeRouter.get('/projects/:id/funding', requireCapability('finance.read'), async (req, res, next) => {
  try {
    const rows = await withTenant(req.user.tenantId, async (db) => {
      await loadProject(db, req.user, req.params.id);
      return (await db.coll('funding_allocations').find(
        { project_id: req.params.id },
        { sort: { created_at: 1 } },
      )).map(toRow);
    });
    res.json({ allocations: rows });
  } catch (err) {
    next(err);
  }
});

financeRouter.post(
  '/projects/:id/funding',
  requireCapability('finance.write'),
  validate(fundingSchema),
  async (req, res, next) => {
    const { id } = req.data.params;
    const b = req.data.body;
    try {
      const row = await withTenantTx(req.user.tenantId, async (db) => {
        await loadProject(db, req.user, id);
        const doc = await db.coll('funding_allocations').insertOne({
          project_id: id,
          source_name: b.sourceName,
          funder_type: b.funderType,
          amount: money2(b.amount),
          created_at: new Date(),
        });
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'funding.created',
          entity: 'funding_allocation',
          entityId: doc._id,
          summary: `Funding source "${b.sourceName}" allocated (${b.amount.toFixed(2)})`,
        });
        return doc;
      });
      res.status(201).json({ allocation: toRow(row) });
    } catch (err) {
      next(err);
    }
  },
);

financeRouter.delete(
  '/funding/:id',
  requireCapability('finance.write'),
  validate(z.object({ params: z.object({ id: uuidField }) })),
  async (req, res, next) => {
    try {
      await withTenantTx(req.user.tenantId, async (db) => {
        const doc = await db.coll('funding_allocations').findOneAndDelete({ _id: req.data.params.id });
        if (!doc) throw notFound('Allocation not found');
        await audit(db, {
          actorId: req.user.id,
          actorRole: req.user.role,
          action: 'funding.removed',
          entity: 'funding_allocation',
          entityId: req.data.params.id,
          summary: `Funding allocation "${doc.source_name}" removed`,
        });
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
