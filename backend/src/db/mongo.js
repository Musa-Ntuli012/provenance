import { MongoClient } from 'mongodb';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

/**
 * MongoDB data layer and the tenant security boundary.
 *
 * MongoDB has no row level security, so the isolation the database used to
 * enforce is enforced HERE, in exactly one place. Request code never touches
 * a raw collection: `withTenant` / `withTenantTx` hand out a scope bound to
 * the caller's tenant and every method below merges the tenant predicate
 * into filters, aggregations and inserted documents. Reaching another
 * tenant's data from route code is structurally impossible, and the
 * behavioural suite proves it end to end (foreign tenant contexts return
 * zero rows, masked 404s).
 *
 * Multi document writes run inside a transaction (`withTenantTx`), so an
 * audit entry can never exist without the change it records, and a failure
 * rolls back both. Transactions require a replica set: docker compose and
 * MongoDB Atlas provide one, and the local setup guide configures it.
 *
 * Field naming: documents deliberately reuse the SQL column names
 * (tenant_id, client_org_id, contract_value...) so every API projection
 * stays byte for byte compatible with the existing frontend contract.
 * Money and coordinates are stored as strings exactly like the SQL types
 * emitted them (contract_value "148500000.00", latitude "26.097").
 */

let client = null;
let database = null;

export async function connectMongo() {
  client = new MongoClient(config.mongodbUri, { maxPoolSize: 10 });
  await client.connect();
  database = client.db(config.mongodbDbName);
  return database;
}

export async function closeMongo() {
  if (client) await client.close();
}

export function mongoDatabase() {
  return database;
}

/** MongoDB duplicate key (unique index violation). The pg code was 23505. */
export function isDuplicateKey(err) {
  return err?.code === 11000 || err?.code === 11001;
}

const newId = () => randomUUID();

/** API contract shape: every resource is exposed with an `id` key (the SQL
 *  rows did); the internal `_id` never appears in a response. */
export const toRow = ({ _id, ...rest }) => ({ id: _id, ...rest });

/**
 * Build a tenant scope. With `tenantId` set, every collection method below
 * injects the tenant predicate (for the tenants collection itself, the
 * predicate is on _id). With `tenantId` null this is the bootstrap scope
 * used only by registration, login tenant resolution and the seed script.
 */
function buildScope(db, tenantId, session) {
  const predicated = (name, filter) => {
    if (!tenantId) return { ...filter };
    return name === 'tenants' ? { _id: tenantId, ...filter } : { tenant_id: tenantId, ...filter };
  };

  function coll(name) {
    const col = () => db.collection(name);
    return {
      async find(filter = {}, { sort, limit, skip, projection } = {}) {
        let c = col().find(predicated(name, filter), { session });
        if (sort) c = c.sort(sort);
        if (skip) c = c.skip(skip);
        if (limit) c = c.limit(limit);
        if (projection) c = c.project(projection);
        return c.toArray();
      },

      async findOne(filter = {}, opts = {}) {
        return col().findOne(predicated(name, filter), { session, ...opts });
      },

      async countDocuments(filter = {}, opts = {}) {
        return col().countDocuments(predicated(name, filter), { session, ...opts });
      },

      /** Inserts return the stored document (uuid _id included), like
       *  INSERT ... RETURNING * did. */
      async insertOne(doc) {
        const d = { _id: newId(), ...doc };
        if (tenantId && name !== 'tenants') d.tenant_id = tenantId;
        await col().insertOne(d, { session });
        return d;
      },

      async insertMany(docs) {
        const ds = docs.map((doc) => {
          const d = { _id: newId(), ...doc };
          if (tenantId && name !== 'tenants') d.tenant_id = tenantId;
          return d;
        });
        if (ds.length > 0) await col().insertMany(ds, { session });
        return ds;
      },

      async updateOne(filter, update, opts = {}) {
        return col().updateOne(predicated(name, filter), prepareUpdate(update, opts), {
          session,
          ...opts,
        });
      },

      async updateMany(filter, update, opts = {}) {
        return col().updateMany(predicated(name, filter), prepareUpdate(update, opts), {
          session,
          ...opts,
        });
      },

      /** Returns the document (or null), like RETURNING did. */
      async findOneAndUpdate(filter, update, opts = {}) {
        const r = await col().findOneAndUpdate(predicated(name, filter), prepareUpdate(update, opts), {
          session,
          ...opts,
        });
        return r ?? null;
      },

      async deleteOne(filter, opts = {}) {
        return col().deleteOne(predicated(name, filter), { session, ...opts });
      },

      async deleteMany(filter, opts = {}) {
        return col().deleteMany(predicated(name, filter), { session, ...opts });
      },

      /** The tenant predicate is always the first pipeline stage. */
      async aggregate(pipeline = [], opts = {}) {
        return col()
          .aggregate([{ $match: predicated(name, {}) }, ...pipeline], { session, ...opts })
          .toArray();
      },
    };
  }

  return { session, tenantId, coll };
}

/** Upserts must never produce an ObjectId _id: every id in this system is a
 *  uuid string, so upsert inserts get one injected. */
function prepareUpdate(update, opts) {
  if (!opts?.upsert) return update;
  return { ...update, $setOnInsert: { _id: newId(), ...(update.$setOnInsert ?? {}) } };
}

/** Read paths. Session gives causal consistency; no transaction needed. */
export async function withTenant(tenantId, fn) {
  const session = client.startSession({ causalConsistency: true });
  try {
    return await fn(buildScope(database, tenantId, session));
  } finally {
    await session.endSession().catch(() => {});
  }
}

/** Write paths. Everything that mutates plus audits runs in one transaction:
 *  the change and its audit entry commit or roll back together.
 *  Transient write conflicts (two writers racing, e.g. two leads endorsing at
 *  once) are retried per the MongoDB transaction guidance, then surface. */
const TX_RETRIES = 3;

export async function withTenantTx(tenantId, fn) {
  for (let attempt = 1; ; attempt += 1) {
    const session = client.startSession({ causalConsistency: true });
    try {
      session.startTransaction();
      const result = await fn(buildScope(database, tenantId, session));
      await session.commitTransaction();
      return result;
    } catch (err) {
      try {
        await session.abortTransaction();
      } catch {
        /* the transaction may already have been ended by the error */
      }
      const transient = err?.hasErrorLabel?.('TransientTransactionError') ?? false;
      if (transient && attempt < TX_RETRIES) continue;
      throw err;
    } finally {
      await session.endSession().catch(() => {});
    }
  }
}

/** Bootstrap only: registration, login tenant resolution, health, seed. */
export async function withRoot(fn) {
  const session = client.startSession({ causalConsistency: true });
  try {
    return await fn(buildScope(database, null, session));
  } finally {
    await session.endSession().catch(() => {});
  }
}

export async function withRootTx(fn) {
  const session = client.startSession({ causalConsistency: true });
  try {
    session.startTransaction();
    const result = await fn(buildScope(database, null, session));
    await session.commitTransaction();
    return result;
  } catch (err) {
    try {
      await session.abortTransaction();
    } catch {
      /* as above */
    }
    throw err;
  } finally {
    await session.endSession().catch(() => {});
  }
}
