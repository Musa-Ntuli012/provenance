import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

async function migrate() {
  const admin = new pg.Client({ connectionString: config.databaseUrlAdmin });
  await admin.connect();

  await admin.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const applied = new Set(
    (await admin.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    try {
      await admin.query('BEGIN');
      await admin.query(sql);
      await admin.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await admin.query('COMMIT');
      console.log(`applied  ${file}`);
    } catch (err) {
      await admin.query('ROLLBACK');
      console.error(`FAILED   ${file}: ${err.message}`);
      process.exitCode = 1;
      break;
    }
  }

  await admin.end();
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
