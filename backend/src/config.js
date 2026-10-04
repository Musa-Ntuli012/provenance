import 'dotenv/config';

function required(name, { fallback } = {}) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === '' || value.startsWith('YOUR_')) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    if (value === undefined) {
      throw new Error(`Missing required environment variable: ${name} (see .env.example)`);
    }
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 4000),

  // Runtime role, every query constrained by row-level security.
  databaseUrl: required('DATABASE_URL'),
  // Owner role, migrations and seed only. Must never serve request traffic.
  databaseUrlAdmin: process.env.DATABASE_URL_ADMIN ?? required('DATABASE_URL'),

  jwtSecret: required('JWT_SECRET'),
  jwtTtlSeconds: 15 * 60,
  refreshTokenTtlSeconds: 7 * 24 * 60 * 60,

  storageDir: process.env.STORAGE_DIR ?? './storage',
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  uploadMaxBytes: 15 * 1024 * 1024,
};

function sslFor(uri) {
  let host = '';
  try { host = new URL(uri).hostname; } catch { /* validated elsewhere */ }
  if (!host || host === 'localhost' || host === '127.0.0.1') return undefined;
  // Managed Postgres (Supabase, pooler endpoints) terminates TLS. Set
  // PGSSL_ROOT_CERT and tighten this for strict certificate pinning in prod.
  if (process.env.PGSSL_DISABLE === '1') return undefined;
  return { rejectUnauthorized: false };
}

config.dbSsl = sslFor(config.databaseUrl);
config.dbSslAdmin = sslFor(config.databaseUrlAdmin);

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters (openssl rand -hex 48)');
}
