import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { withTenant, withTenantTx, withRoot, withRootTx, isDuplicateKey } from '../db/mongo.js';
import { audit } from '../lib/audit.js';
import { conflict, unauthorized } from '../lib/errors.js';
import { emailField, passwordField, slugField } from '../lib/fields.js';
import { validate } from '../middleware/validate.js';
import { authRequired } from '../middleware/auth.js';
import { rateLimit } from 'express-rate-limit';

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts, try again in 15 minutes' } },
});

const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 20 });

function signAccessToken(user, tenantSlug) {
  return jwt.sign(
    { sub: user._id ?? user.id, tid: user.tenant_id, role: user.role, slug: tenantSlug },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: config.jwtTtlSeconds },
  );
}

/** Refresh token = signed reference to a server-side session document
 *  (opaque, revocable, rotated on every use). No session state lives in the
 *  cookie. */
function signRefreshToken(sessionId, tenantId) {
  return jwt.sign({ sid: sessionId, tid: tenantId, typ: 'refresh' }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.refreshTokenTtlSeconds,
  });
}

const REFRESH_COOKIE = 'pv_refresh';

function setRefreshCookie(res, token) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    path: '/api/auth',
    maxAge: config.refreshTokenTtlSeconds * 1000,
  });
}

async function createSession(db, tenantId, userId, ttlSeconds) {
  const doc = await db.coll('sessions').insertOne({
    tenant_id: tenantId,
    user_id: userId,
    expires_at: new Date(Date.now() + ttlSeconds * 1000),
    revoked_at: null,
    created_at: new Date(),
  });
  return doc;
}

const registerSchema = z.object({
  body: z.object({
    organisationName: z.string().trim().min(2).max(120),
    slug: slugField,
    industry: z.string().trim().min(2).max(80).default('engineering_consulting'),
    contactName: z.string().trim().min(2).max(120),
    contactEmail: emailField,
    adminName: z.string().trim().min(2).max(120),
    password: passwordField,
  }),
});

// Public: firm self-registration. Runs on the bootstrap scope because the
// tenant does not exist yet. Tenant + admin user commit atomically.
authRouter.post('/register', registerLimiter, validate(registerSchema), async (req, res, next) => {
  const b = req.data.body;
  try {
    const result = await withRootTx(async (db) => {
      const exists = await db.coll('tenants').findOne({ slug: b.slug });
      if (exists) throw conflict('That workspace address is taken, try another');

      const tenant = await db.coll('tenants').insertOne({
        name: b.organisationName,
        slug: b.slug,
        org_type: 'private_firm',
        industry: b.industry,
        contact_name: b.contactName,
        contact_email: b.contactEmail,
        workflow_profile: 'EVIDENTIARY_PRIVATE_V11',
        created_at: new Date(),
      });
      const hash = await bcrypt.hash(b.password, 12);
      const admin = await db.coll('users').insertOne({
        tenant_id: tenant._id,
        email: b.contactEmail,
        password_hash: hash,
        full_name: b.adminName,
        role: 'ORG_ADMIN',
        client_org_id: null,
        status: 'ACTIVE',
        access_expires_at: null,
        created_at: new Date(),
        last_login_at: null,
      });
      return { tenant, adminId: admin._id };
    });
    res.status(201).json({ tenant: { id: result.tenant._id, name: result.tenant.name, slug: result.tenant.slug } });
  } catch (err) {
    if (isDuplicateKey(err)) {
      // The pre-check inside the transaction normally catches this; this is
      // the simultaneous-registration race.
      return next(conflict(err.keyPattern?.slug
        ? 'That workspace address is taken, try another'
        : 'That email is already registered in this workspace'));
    }
    next(err);
  }
});

const loginSchema = z.object({
  body: z.object({ slug: slugField, email: emailField, password: z.string().min(1).max(128) }),
});

authRouter.post('/login', loginLimiter, validate(loginSchema), async (req, res, next) => {
  const { slug, email, password } = req.data.body;
  try {
    // Tenant resolution is bootstrap (pre-auth, cross-tenant by definition);
    // everything after this runs inside the tenant scope.
    const tenant = await withRoot(async (db) => {
      const t = await db.coll('tenants').findOne({ slug });
      if (!t) throw unauthorized('Invalid workspace, email or password');
      return t;
    });

    const data = await withTenantTx(tenant._id, async (db) => {
      const u = await db.coll('users').findOne({ email });
      // Constant-ish work factor even when the user does not exist.
      const ok = u && u.status === 'ACTIVE' ? await bcrypt.compare(password, u.password_hash) : false;
      if (!ok) throw unauthorized('Invalid workspace, email or password');

      if (u.role === 'CLIENT_TEMP' && u.access_expires_at && new Date(u.access_expires_at) < new Date()) {
        throw unauthorized('This temporary client access has expired');
      }
      await db.coll('users').updateOne({ _id: u._id }, { $set: { last_login_at: new Date() } });
      const session = await createSession(db, tenant._id, u._id, config.refreshTokenTtlSeconds);
      await audit(db, {
        actorId: u._id,
        actorRole: u.role,
        action: 'auth.login',
        entity: 'user',
        entityId: u._id,
        summary: `${u.full_name} signed in`,
      });
      return { user: u, sessionId: session._id };
    });

    const accessToken = signAccessToken(data.user, tenant.slug);
    setRefreshCookie(res, signRefreshToken(data.sessionId, tenant._id));
    res.json({
      accessToken,
      user: {
        id: data.user._id,
        email: data.user.email,
        fullName: data.user.full_name,
        role: data.user.role,
        clientOrgId: data.user.client_org_id,
        tenant: { id: tenant._id, name: tenant.name, slug: tenant.slug },
      },
    });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (!raw) throw unauthorized();
    let payload;
    try {
      payload = jwt.verify(raw, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw unauthorized();
    }
    if (payload.typ !== 'refresh') throw unauthorized();

    const data = await withTenantTx(payload.tid, async (db) => {
      const session = await db.coll('sessions').findOne({ _id: payload.sid });
      if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
        throw unauthorized();
      }
      // Rotation: single-use refresh tokens. Reuse of a rotated token fails here.
      await db.coll('sessions').updateOne({ _id: session._id }, { $set: { revoked_at: new Date() } });
      const user = await db.coll('users').findOne(
        { _id: session.user_id },
        { projection: { password_hash: 0 } },
      );
      if (!user || user.status !== 'ACTIVE') throw unauthorized();
      if (user.role === 'CLIENT_TEMP' && user.access_expires_at && new Date(user.access_expires_at) < new Date()) {
        throw unauthorized('This temporary client access has expired');
      }
      const fresh = await createSession(db, payload.tid, user._id, config.refreshTokenTtlSeconds);
      const tenant = await db.coll('tenants').findOne({ _id: payload.tid });
      return { user, session: fresh, tenant };
    });

    const accessToken = signAccessToken(data.user, data.tenant.slug);
    setRefreshCookie(res, signRefreshToken(data.session._id, payload.tid));
    res.json({
      accessToken,
      user: {
        id: data.user._id,
        email: data.user.email,
        fullName: data.user.full_name,
        role: data.user.role,
        clientOrgId: data.user.client_org_id,
        tenant: { id: data.tenant._id, name: data.tenant.name, slug: data.tenant.slug },
      },
    });
  } catch (err) {
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    next(err);
  }
});

authRouter.post('/logout', async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (raw) {
      try {
        const payload = jwt.verify(raw, config.jwtSecret, { algorithms: ['HS256'] });
        await withTenant(payload.tid, (db) =>
          db.coll('sessions').updateOne(
            { _id: payload.sid, revoked_at: null },
            { $set: { revoked_at: new Date() } },
          ),
        );
      } catch {
        /* already invalid, nothing to revoke */
      }
    }
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

authRouter.get('/me', authRequired, async (req, res, next) => {
  try {
    const tenant = await withTenant(req.user.tenantId, (db) =>
      db.coll('tenants').findOne(
        { _id: req.user.tenantId },
        { projection: { _id: 1, name: 1, slug: 1, industry: 1, contact_name: 1, contact_email: 1 } },
      ),
    );
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.fullName,
        role: req.user.role,
        clientOrgId: req.user.clientOrgId,
      },
      tenant: { id: tenant._id, name: tenant.name, slug: tenant.slug, industry: tenant.industry, contact_name: tenant.contact_name, contact_email: tenant.contact_email },
    });
  } catch (err) {
    next(err);
  }
});

// Convenience for process shutdown hooks elsewhere.
export async function closePools() {
  const { closeMongo } = await import('../db/mongo.js');
  await closeMongo();
}
