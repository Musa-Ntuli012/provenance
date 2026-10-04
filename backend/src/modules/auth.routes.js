import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { pool, withTenant, withAdmin } from '../db/pool.js';
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
    { sub: user.id, tid: user.tenant_id, role: user.role, slug: tenantSlug },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: config.jwtTtlSeconds },
  );
}

/** Refresh token = signed reference to a server-side session row (opaque,
 *  revocable, rotated on every use). No session state lives in the cookie. */
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
  const expires = new Date(Date.now() + ttlSeconds * 1000);
  const row = await db.query(
    `INSERT INTO sessions (tenant_id, user_id, expires_at) VALUES ($1, $2, $3) RETURNING id, expires_at`,
    [tenantId, userId, expires],
  );
  return row.rows[0];
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

// Public: firm self-registration. Runs on the admin connection because the
// tenant (and its RLS context) does not exist yet, this is bootstrap.
authRouter.post('/register', registerLimiter, validate(registerSchema), async (req, res, next) => {
  const b = req.data.body;
  try {
    const result = await withAdmin(async (db) => {
      const exists = await db.query('SELECT 1 FROM tenants WHERE slug = $1', [b.slug]);
      if (exists.rowCount > 0) throw conflict('That workspace address is taken, try another');

      const tenant = await db.query(
        `INSERT INTO tenants (name, slug, industry, contact_name, contact_email)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, name, slug`,
        [b.organisationName, b.slug, b.industry, b.contactName, b.contactEmail],
      );
      const t = tenant.rows[0];
      const hash = await bcrypt.hash(b.password, 12);
      const admin = await db.query(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, role)
         VALUES ($1, $2, $3, $4, 'ORG_ADMIN') RETURNING id`,
        [t.id, b.contactEmail, hash, b.adminName],
      );
      return { tenant: t, adminId: admin.rows[0].id };
    });
    res.status(201).json({ tenant: { id: result.tenant.id, name: result.tenant.name, slug: result.tenant.slug } });
  } catch (err) {
    if (err?.code === '23505') {
      // The pre-check inside the transaction normally catches this; this is
      // the simultaneous-registration race.
      return next(conflict('That workspace address or email is already registered'));
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
    // everything after this runs inside the tenant's RLS context.
    const tenant = await withAdmin(async (db) => {
      const r = await db.query('SELECT id, name, slug FROM tenants WHERE slug = $1', [slug]);
      if (r.rowCount === 0) throw unauthorized('Invalid workspace, email or password');
      return r.rows[0];
    });

    const user = await withTenant(tenant.id, async (db) => {
      const r = await db.query(
        `SELECT id, tenant_id, email, full_name, role, client_org_id, password_hash, status, access_expires_at
           FROM users WHERE email = $1`,
        [email],
      );
      const u = r.rows[0];
      // Constant-ish work factor even when the user does not exist.
      const ok = u && u.status === 'ACTIVE' ? await bcrypt.compare(password, u.password_hash) : false;
      if (!ok) throw unauthorized('Invalid workspace, email or password');

      if (u.role === 'CLIENT_TEMP' && u.access_expires_at && new Date(u.access_expires_at) < new Date()) {
        throw unauthorized('This temporary client access has expired');
      }
      await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [u.id]);
      const session = await createSession(db, tenant.id, u.id, config.refreshTokenTtlSeconds);
      await audit(db, {
        actorId: u.id,
        actorRole: u.role,
        action: 'auth.login',
        entity: 'user',
        entityId: u.id,
        summary: `${u.full_name} signed in`,
      });
      return { ...u, sessionId: session.id };
    });

    const accessToken = signAccessToken(user, tenant.slug);
    setRefreshCookie(res, signRefreshToken(user.sessionId, tenant.id));
    res.json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        clientOrgId: user.client_org_id,
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
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

    const data = await withTenant(payload.tid, async (db) => {
      const s = await db.query(
        `SELECT id, user_id, expires_at, revoked_at FROM sessions WHERE id = $1`,
        [payload.sid],
      );
      const session = s.rows[0];
      if (!session || session.revoked_at || new Date(session.expires_at) < new Date()) {
        throw unauthorized();
      }
      // Rotation: single-use refresh tokens. Reuse of a rotated token fails here.
      await db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [session.id]);
      const u = await db.query(
        `SELECT id, tenant_id, email, full_name, role, client_org_id, status, access_expires_at
           FROM users WHERE id = $1`,
        [session.user_id],
      );
      const user = u.rows[0];
      if (!user || user.status !== 'ACTIVE') throw unauthorized();
      if (user.role === 'CLIENT_TEMP' && user.access_expires_at && new Date(user.access_expires_at) < new Date()) {
        throw unauthorized('This temporary client access has expired');
      }
      const fresh = await createSession(db, payload.tid, user.id, config.refreshTokenTtlSeconds);
      const t = await db.query('SELECT id, name, slug FROM tenants WHERE id = $1', [payload.tid]);
      return { user, session: fresh, tenant: t.rows[0] };
    });

    const accessToken = signAccessToken(data.user, data.tenant.slug);
    setRefreshCookie(res, signRefreshToken(data.session.id, payload.tid));
    res.json({
      accessToken,
      user: {
        id: data.user.id,
        email: data.user.email,
        fullName: data.user.full_name,
        role: data.user.role,
        clientOrgId: data.user.client_org_id,
        tenant: { id: data.tenant.id, name: data.tenant.name, slug: data.tenant.slug },
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
          db.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [payload.sid]),
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
      db.query('SELECT id, name, slug, industry, contact_name, contact_email FROM tenants WHERE id = $1', [
        req.user.tenantId,
      ]),
    );
    res.json({
      user: {
        id: req.user.id,
        email: req.user.email,
        fullName: req.user.fullName,
        role: req.user.role,
        clientOrgId: req.user.clientOrgId,
      },
      tenant: tenant.rows[0],
    });
  } catch (err) {
    next(err);
  }
});

// Convenience for pool cleanup on shutdown.
export async function closePools() {
  await Promise.all([pool.end(), globalThis.__adminPoolEnd?.()]);
}
