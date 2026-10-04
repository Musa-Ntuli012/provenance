import { config } from './config.js';
import { createApp } from './app.js';
import { pool, adminPool } from './db/pool.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

mkdirSync(path.resolve(config.storageDir), { recursive: true });

// Fail fast with an actionable message when the database is unreachable,
// the schema is missing, or the runtime role lacks its grants.

try {
  await adminPool.query('SELECT 1');
} catch (err) {
  console.error(`admin database connection failed: ${err.message}`);
  console.error('Check DATABASE_URL_ADMIN in backend/.env (see .env.example).');
  console.error('Supabase: use the Session pooler URI (port 5432) and allow your IP');
  console.error('in the Supabase dashboard (Network access).');
  process.exit(1);
}
const schema = await adminPool.query("SELECT to_regclass('public.tenants') AS t");
if (!schema.rows[0].t) {
  console.error('');
  console.error('The database schema is not initialized (no tables found).');
  console.error('Stop the API and run:  npm run db:setup');
  console.error('Verify afterwards with:  npm run db:ping');
  process.exit(1);
}
const whoAmI = await pool.query('SELECT current_user');
const adminWho = await adminPool.query('SELECT current_user');
if (whoAmI.rows[0].current_user === adminWho.rows[0].current_user) {
  console.error('');
  console.error(`WARNING: DATABASE_URL connects as "${whoAmI.rows[0].current_user}", the same role as`);
  console.error('DATABASE_URL_ADMIN. That role owns the tables and BYPASSES all row-level');
  console.error('security, so tenant isolation is not enforced. Point DATABASE_URL at the');
  console.error('provenance_app role URI printed by:  npm run db:bootstrap');
}
try {
  const grants = await pool.query(
    "SELECT has_table_privilege('tenants', 'INSERT') AS can_insert," +
    "       has_table_privilege('tenants', 'SELECT') AS can_select",
  );
  const g = grants.rows[0];
  if (!g.can_select || !g.can_insert) {
    console.error('');
    console.error(`The runtime role cannot read/write application tables (SELECT=${g.can_select}, INSERT=${g.can_insert}).`);
    console.error('Fix it with:');
    console.error('  APP_ROLE_PASSWORD=<runtime password> npm run db:bootstrap');
    console.error('(bootstrap is idempotent; it also prints the exact DATABASE_URL to use).');
    process.exit(1);
  }
  console.log(`database connected (${config.env}); schema present, runtime role verified`);
} catch (err) {
  console.error(`runtime database connection failed: ${err.message}`);
  console.error('Check DATABASE_URL in backend/.env (it must be the provenance_app URI that');
  console.error('db:bootstrap printed, on the same host and database as the admin URI).');
  process.exit(1);
}

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`provenance-api listening on :${config.port} (${config.env})`);
});

async function shutdown(signal) {
  console.log(`${signal} received, closing server and database pools`);
  server.close(async () => {
    await Promise.allSettled([pool.end(), adminPool.end()]);
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
