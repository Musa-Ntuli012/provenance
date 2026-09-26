import { connectMongo, closeMongo } from './mongo.js';

/**
 * Schema setup for MongoDB (replaces the SQL migration runner).
 * Idempotent: safe to run on every deploy. Collections and indexes mirror
 * the original relational schema one to one; see docs/database-schema.md.
 *
 * Unique indexes carry the constraints the SQL schema declared (per tenant
 * where the table was tenant scoped):
 *   tenants.slug                          (global)
 *   users          (tenant_id, email)
 *   projects       (tenant_id, code)
 *   project_domain_assignments (project_id, domain)
 *   stage_gates    (project_id, stage_index)
 *   endorsements   (project_id, stage_index, domain)
 *   payment_certificates (project_id, certificate_no)
 *   variation_orders     (project_id, vo_number)
 *
 * sessions.expires_at is a TTL index: expired sessions are removed by the
 * server; freshness is additionally checked on every use.
 */

const INDEXES = {
  tenants: [{ key: { slug: 1 }, unique: true, name: 'tenants_slug_uq' }],

  users: [
    { key: { tenant_id: 1, email: 1 }, unique: true, name: 'users_tenant_email_uq' },
    { key: { tenant_id: 1, full_name: 1 }, name: 'users_tenant_name' },
  ],

  client_organisations: [{ key: { tenant_id: 1, name: 1 }, name: 'clients_tenant_name' }],

  sessions: [
    { key: { user_id: 1, revoked_at: 1 }, name: 'sessions_user_revoked' },
    { key: { expires_at: 1 }, expireAfterSeconds: 0, name: 'sessions_expires_ttl' },
  ],

  projects: [
    { key: { tenant_id: 1, code: 1 }, unique: true, name: 'projects_tenant_code_uq' },
    { key: { tenant_id: 1, status: 1 }, name: 'projects_tenant_status' },
    { key: { tenant_id: 1, client_org_id: 1 }, name: 'projects_tenant_client' },
  ],

  project_domain_assignments: [
    { key: { project_id: 1, domain: 1 }, unique: true, name: 'pda_project_domain_uq' },
    { key: { user_id: 1 }, name: 'pda_user' },
  ],

  stage_gates: [
    { key: { project_id: 1, stage_index: 1 }, unique: true, name: 'gates_project_stage_uq' },
    { key: { tenant_id: 1, status: 1 }, name: 'gates_tenant_status' },
  ],

  endorsements: [
    { key: { project_id: 1, stage_index: 1, domain: 1 }, unique: true, name: 'endorsements_uq' },
    { key: { tenant_id: 1, created_at: 1 }, name: 'endorsements_tenant_time' },
  ],

  stage_approvals: [
    { key: { project_id: 1, stage_index: 1 }, name: 'approvals_project_stage' },
  ],

  documents: [
    { key: { tenant_id: 1, project_id: 1, category: 1 }, name: 'documents_tenant_project_cat' },
    { key: { tenant_id: 1, created_at: -1 }, name: 'documents_tenant_time' },
  ],

  tasks: [
    { key: { tenant_id: 1, status: 1, position: 1 }, name: 'tasks_tenant_board' },
    { key: { assignee_id: 1 }, name: 'tasks_assignee' },
  ],

  payment_certificates: [
    { key: { project_id: 1, certificate_no: 1 }, unique: true, name: 'certificates_project_no_uq' },
    { key: { tenant_id: 1, certified_at: 1 }, name: 'certificates_tenant_certified' },
    { key: { project_id: 1, status: 1 }, name: 'certificates_project_status' },
  ],

  variation_orders: [
    { key: { project_id: 1, vo_number: 1 }, unique: true, name: 'variations_project_no_uq' },
    { key: { project_id: 1 }, name: 'variations_project' },
  ],

  funding_allocations: [{ key: { project_id: 1 }, name: 'funding_project' }],

  audit_events: [
    { key: { tenant_id: 1, created_at: -1 }, name: 'audit_tenant_time' },
    { key: { tenant_id: 1, entity: 1, entity_id: 1 }, name: 'audit_tenant_entity' },
  ],
};

async function setup() {
  const db = await connectMongo();
  console.log('applying schema (collections + indexes)...');
  let created = 0;
  for (const [name, indexes] of Object.entries(INDEXES)) {
    try {
      await db.createCollection(name);
      created += 1;
    } catch (err) {
      if (err?.codeName !== 'NamespaceExists') throw err;
    }
    await db.collection(name).createIndexes(indexes);
  }
  console.log(`collections ready: ${Object.keys(INDEXES).length} (${created} newly created)`);
  await closeMongo();
}

setup().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
