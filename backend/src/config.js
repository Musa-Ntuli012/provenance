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

  // Single MongoDB connection. MongoDB has no row level security, so tenant
  // isolation is enforced in the data layer (src/db/mongo.js) with every
  // query scoped to the caller's tenant, and proven by regression tests.
  mongodbUri: required('MONGODB_URI'),
  mongodbDbName: process.env.MONGODB_DB_NAME ?? 'provenance',

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

if (config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET must be at least 32 characters (openssl rand -hex 48)');
}
