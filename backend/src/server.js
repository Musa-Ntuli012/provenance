import { config } from './config.js';
import { createApp } from './app.js';
import { pool, adminPool } from './db/pool.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

mkdirSync(path.resolve(config.storageDir), { recursive: true });

// Fail fast with an actionable message when the database is unreachable.
try {
  const probe = await import('./db/pool.js');
  await probe.adminPool.query('SELECT 1');
  console.log(`database connected (${config.env})`);
} catch (err) {
  console.error(`database connection failed: ${err.message}`);
  console.error('Check DATABASE_URL in backend/.env (see .env.example).');
  console.error('Supabase: use the Session pooler URI (port 5432) and allow your IP');
  console.error('in the Supabase dashboard (Network access).');
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
