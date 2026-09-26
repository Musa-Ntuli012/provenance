import { config } from './config.js';
import { createApp } from './app.js';
import { connectMongo, closeMongo, mongoDatabase } from './db/mongo.js';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

mkdirSync(path.resolve(config.storageDir), { recursive: true });

try {
  await connectMongo();
  const hello = await mongoDatabase().admin().command({ hello: 1 });
  if (!hello.setName) {
    console.error('');
    console.error('This API requires MongoDB running as a REPLICA SET (every write uses');
    console.error('transactions), but the server at MONGODB_URI is a standalone instance.');
    console.error('Fix it one of three ways:');
    console.error('  1. docker compose up -d                    (from the repo root; starts and');
    console.error('                                              initiates a replica set automatically)');
    console.error('  2. Start mongod with: --replSet rs0        then run once in mongosh:');
    console.error('     rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] })');
    console.error('  3. Use MongoDB Atlas (free tier works out of the box; see README).');
    console.error('Then verify with: npm run db:ping');
    process.exit(1);
  }
  console.log(`mongodb connected (${config.mongodbDbName}, replica set ${hello.setName})`);
} catch (err) {
  console.error(`mongodb connection failed: ${err.message}`);
  console.error('Check MONGODB_URI in backend/.env (see .env.example).');
  process.exit(1);
}

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`provenance-api listening on :${config.port} (${config.env})`);
});

async function shutdown(signal) {
  console.log(`${signal} received, closing server and database connection`);
  server.close(async () => {
    await closeMongo().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
