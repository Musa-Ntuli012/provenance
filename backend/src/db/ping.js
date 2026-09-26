/**
 * Connection check: run `npm run db:ping` to verify MONGODB_URI before
 * starting the API. Prints the resolved topology so local vs Atlas problems
 * are obvious at a glance (wrong IP allow-list, bad credentials, missing
 * replica set, and so on).
 */
import { MongoClient } from 'mongodb';
import { config } from '../config.js';

const masked = config.mongodbUri.replace(/:\/\/([^:/@]+):[^@]*@/, '://$1:****@');

try {
  const client = new MongoClient(config.mongodbUri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const hello = await client.db('admin').command({ hello: 1 });
  console.log(`uri        : ${masked}`);
  console.log(`topology   : ${hello.setName ? `replica set ${hello.setName}` : 'standalone (transactions will NOT work)'}`);
  console.log(`writable   : ${hello.isWritablePrimary ? 'yes' : 'no (not a primary)'}`);
  console.log(`server     : mongod ${hello.maxWireVersion >= 21 ? '7.x' : `wire version ${hello.maxWireVersion}`} (MongoDB 7+ required)`);
  const ok = hello.setName && hello.isWritablePrimary;
  console.log(ok ? '\nREADY: replica set primary reachable, transactions available.' : '\nNOT READY: see above (a replica set is required for transactions).');
  process.exitCode = ok ? 0 : 1;
  await client.close();
} catch (err) {
  console.error(`FAILED: ${err.message}`);
  console.error('Checklist: instance running? IP allow-list (Atlas)? credentials URL-encoded? replicaSet parameter present?');
  process.exit(1);
}
