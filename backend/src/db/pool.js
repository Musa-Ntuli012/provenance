import pg from 'pg';
import { config } from '../config.js';

/**
 * Two pools, two trust levels:
 *
 *  - `adminPool` connects as the schema owner and BYPASSES row-level
 *    security. It is used only for platform bootstrap operations
 *    (tenant registration lookup, login tenant resolution) and by the
 *    migration/seed scripts. It must never touch request-scoped data paths.
 *
 *  - `pool` connects as `provenance_app`, a plain role. Every table carries
 *    `ENABLE ROW LEVEL SECURITY` with a policy of
 *    `tenant_id = current_setting('app.tenant_id')`, so the role physically
 *    cannot read or write another tenant's rows even if application code
 *    made a mistake. Tenant context is set per transaction with
 *    `set_config(..., true)` (transaction-local).
 */

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, ssl: config.dbSsl });
export const adminPool = new pg.Pool({ connectionString: config.databaseUrlAdmin, max: 4, ssl: config.dbSslAdmin });

for (const [name, p] of [['runtime', pool], ['admin', adminPool]]) {
  p.on('error', (err) => {
    // Pool-level background errors (e.g. severed connection). Log and let the
    // pool recover; do not crash the process.
    console.error(`[db:${name}] idle client error`, err.message);
  });
}

/**
 * Run `fn(client)` inside a transaction scoped to a tenant.
 * This is the ONLY sanctioned way for request code to touch tenant data.
 */
export async function withTenant(tenantId, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [String(tenantId)]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already unusable, the release below returns it to be discarded */
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Bootstrap paths only: registration, login tenant resolution, health. */
export async function withAdmin(fn) {
  const client = await adminPool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* as above */
    }
    throw err;
  } finally {
    client.release();
  }
}
