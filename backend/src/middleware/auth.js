import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { withTenant } from '../db/pool.js';
import { unauthorized, forbidden } from '../lib/errors.js';
import { can } from '../lib/rbac.js';

/** Attaches `req.user` = { id, tenantId, role, slug, clientOrgId, fullName, email }.
 *  Re-reads the user row each request so disabled accounts and expired
 *  client-temporary access take effect immediately (no stale token window). */
export async function authRequired(req, res, next) {
  try {
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
    } catch {
      throw unauthorized('Session expired, please sign in again');
    }

    const rows = await withTenant(payload.tid, (db) =>
      db.query(
        `SELECT id, tenant_id, email, full_name, role, client_org_id, status, access_expires_at
           FROM users WHERE id = $1`,
        [payload.sub],
      ),
    );
    const user = rows.rows[0];
    if (!user || user.status !== 'ACTIVE') throw forbidden('Account is not active');

    if (user.role === 'CLIENT_TEMP' && user.access_expires_at && new Date(user.access_expires_at) < new Date()) {
      throw forbidden('This temporary client access has expired');
    }

    req.user = {
      id: user.id,
      tenantId: user.tenant_id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      clientOrgId: user.client_org_id,
      slug: payload.slug,
    };
    next();
  } catch (err) {
    next(err);
  }
}

/** Role gate. Client roles pass only where explicitly listed. */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(forbidden());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

/** Capability gate (see lib/rbac.js). */
export function requireCapability(capability) {
  return (req, _res, next) => {
    if (!req.user || !can(req.user.role, capability)) return next(forbidden());
    next();
  };
}
