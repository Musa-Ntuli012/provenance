/**
 * Connection check: run `npm run db:ping` to verify DATABASE_URL before
 * starting the API. Prints the resolved target so local vs Supabase problems
 * are obvious at a glance (wrong host/port, missing IP allow-list entry, bad
 * password, SSL). Exits non-zero when anything is off.
 */
import pg from 'pg';
import { config } from '../config.js';

const masked = (uri) => uri.replace(/:\/\/([^:/@]+):[^@]*@/, '://$1:****@');

try {
  const client = new pg.Client({ connectionString: config.databaseUrl, ssl: config.dbSsl });
  await client.connect();
  const { rows } = await client.query('select version(), current_database(), current_user');
  const rls = await client.query(
    `select count(*)::int AS n from pg_tables
      where schemaname = 'public' and rowsecurity = true`,
  );
  const tables = await client.query(
    `select count(*)::int AS n from pg_tables where schemaname = 'public'`,
  );
  console.log(`uri        : ${masked(config.databaseUrl)}`);
  console.log(`server     : ${rows[0].version.split(' ').slice(0, 2).join(' ')} (Postgres 15+ required)`);
  console.log(`database   : ${rows[0].current_database} (connected as ${rows[0].current_user})`);
  console.log(`tls        : ${config.dbSsl ? 'yes' : 'no (local connection)'}`);
  if (tables.rows[0].n === 0) {
    console.log('schema     : none yet (run: npm run db:migrate)');
  } else {
    console.log(`schema     : ${tables.rows[0].n} tables, ${rls.rows[0].n} with row-level security`);
  }
  const ready = rows[0].version.includes('PostgreSQL') && Number(rows[0].version.match(/PostgreSQL (\d+)/)?.[1] ?? 0) >= 15;
  console.log(ready ? '\nREADY: database reachable. If the schema shows 0 tables, run npm run db:setup.' : '\nNOT READY: Postgres 15+ required.');
  process.exitCode = ready ? 0 : 1;
  await client.end();
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  console.error('Checklist: instance running (local) or project active (Supabase)? IP allow-list set');
  console.error('(Supabase Network access)? password correct and URL-encoded? Session pooler URI (port 5432)?');
  process.exit(1);
}
