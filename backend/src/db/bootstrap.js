/**
 * One-time runtime role bootstrap: creates `provenance_app` (the row-level
 * security-constrained role every request runs as) and grants it exactly the
 * DML rights it needs. Idempotent; safe to run again (e.g. to reset just the
 * password). Run against the admin connection (Supabase `postgres` user):
 *
 *   DATABASE_URL=<your Supabase session pooler URI> \
 *   APP_ROLE_PASSWORD=<choose-a-runtime-password> \
 *   npm run db:bootstrap
 *
 * Then put both values in backend/.env:
 *   DATABASE_URL_ADMIN=<same Supabase URI>          (migrations, seed)
 *   DATABASE_URL=postgresql://provenance_app:<APP_ROLE_PASSWORD>@<host>/<db>
 *
 * On a local Postgres this also works, replacing the manual SQL in the README.
 */
import pg from 'pg';
import { config } from '../config.js';

const role = 'provenance_app';
const password = process.env.APP_ROLE_PASSWORD;

if (!password || password.length < 8) {
  console.error('Set APP_ROLE_PASSWORD to a password for the provenance_app runtime role (8+ characters).');
  process.exit(1);
}

const client = new pg.Client({ connectionString: config.databaseUrlAdmin, ssl: config.dbSslAdmin });
await client.connect();

try {
  // Utility statements (CREATE/ALTER ROLE) cannot take bind parameters, so
  // the literal is escaped instead (single quotes doubled).
  const pw = password.replaceAll("'", "''");
  const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
  if (exists.rowCount === 0) {
    await client.query(`CREATE ROLE ${role} LOGIN PASSWORD '${pw}'`);
    console.log(`created role ${role}`);
  } else {
    await client.query(`ALTER ROLE ${role} LOGIN PASSWORD '${pw}'`);
    console.log(`role ${role} already existed, password reset`);
  }
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
  await client.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM ${role}`);
  console.log('grants applied: USAGE on schema public + SELECT/INSERT/UPDATE/DELETE on all tables');
  console.log('\nNext: backend/.env needs');
  console.log(`  DATABASE_URL_ADMIN=<your admin URI>`);
  console.log(`  DATABASE_URL=postgresql://${role}:${encodeURIComponent(password)}@<same host and db>`);
  console.log('then: npm run db:setup');
} finally {
  await client.end();
}
