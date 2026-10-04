-- PROVENANCE, initial schema (Postgres 15+)
--
-- Design notes
-- ------------
-- * Every tenant-scoped table carries tenant_id and has row-level security
--   enabled with a `tenant_id = current_setting('app.tenant_id')` policy.
--   The runtime role (provenance_app) is not the table owner, so these
--   policies are hard isolation, not application-level convention.
-- * Money is NUMERIC(14,2), never float.
-- * The tenant model is private-firm-only (spec §4.1): org_type is kept as a
--   single-valued constant for forward compatibility, and the government-only
--   province/municipality/workflow-profile fields do not exist.

-- =========================== Tenancy & identity ===========================

CREATE TABLE tenants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name             text NOT NULL,
  slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  -- Collapsed to a single value per the private-only migration (spec §4.1):
  -- kept as a field so a second tenant kind can be reintroduced explicitly.
  org_type         text NOT NULL DEFAULT 'private_firm' CHECK (org_type = 'private_firm'),
  industry         text NOT NULL DEFAULT 'engineering_consulting',
  contact_name     text,
  contact_email    text,
  workflow_profile text NOT NULL DEFAULT 'EVIDENTIARY_PRIVATE_V11'
                   CHECK (workflow_profile = 'EVIDENTIARY_PRIVATE_V11'),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- The firm's clients. org_type here models the *client* organisation and
-- legitimately includes government entities (spec §4.2), do not remove.
CREATE TABLE client_organisations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid      REFERENCES tenants (id) ON DELETE CASCADE,
  name          text NOT NULL,
  org_type      text NOT NULL CHECK (org_type IN
                ('municipality', 'government_dept', 'private_entity', 'soe', 'other')),
  contact_name  text,
  contact_email text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid          REFERENCES tenants (id) ON DELETE CASCADE,
  email             text NOT NULL,
  password_hash     text NOT NULL,
  full_name         text NOT NULL,
  role              text NOT NULL CHECK (role IN (
                    'SUPER_ADMIN', 'ORG_ADMIN', 'PM',
                    'PROFESSIONAL_SERVICES_LEAD', 'GEOTECHNICAL_LEAD', 'CONSTRUCTION_MANAGER',
                    'MEMBER', 'CLIENT_APPROVER', 'VIEWER', 'CLIENT_TEMP')),
  client_org_id     uuid REFERENCES client_organisations (id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'DISABLED')),
  access_expires_at timestamptz,          -- CLIENT_TEMP time-boxed access
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_login_at     timestamptz,
  UNIQUE (tenant_id, email)
);

-- Server-side sessions (refresh tokens). Rows are referenced by an opaque
-- session id inside a signed refresh JWT; tokens are never stored verbatim.
CREATE TABLE sessions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid   REFERENCES tenants (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================== Projects & lifecycle =========================

CREATE TABLE projects (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid            REFERENCES tenants (id) ON DELETE CASCADE,
  code                text NOT NULL,
  name                text NOT NULL,
  description         text,
  client_org_id       uuid REFERENCES client_organisations (id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'ON_HOLD', 'COMPLETE')),
  current_stage_index int NOT NULL DEFAULT 1 CHECK (current_stage_index BETWEEN 1 AND 11),
  contract_value      numeric(14, 2),
  currency            text NOT NULL DEFAULT 'ZAR',
  start_date          date,
  target_end_date     date,
  latitude            numeric(9, 6),
  longitude           numeric(9, 6),
  created_by          uuid REFERENCES users (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

-- The three domain sections. A project's active domains are exactly the rows
-- present here; each row names the accountable domain lead.
CREATE TABLE project_domain_assignments (
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  domain     text NOT NULL CHECK (domain IN
             ('PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT')),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id  uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid   REFERENCES tenants (id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, domain)
);

-- One gate per stage. Requirements are derived from the domain assignments
-- (each assigned domain must endorse) plus client approval.
CREATE TABLE stage_gates (
  project_id               uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  stage_index              int  NOT NULL CHECK (stage_index BETWEEN 1 AND 11),
  tenant_id                uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid                 REFERENCES tenants (id) ON DELETE CASCADE,
  status                   text NOT NULL DEFAULT 'LOCKED' CHECK (status IN
                           ('LOCKED', 'IN_PROGRESS', 'PENDING_CLIENT', 'COMPLETED')),
  client_approval_required boolean NOT NULL DEFAULT true,
  opened_at                timestamptz,
  completed_at             timestamptz,
  -- Set when the client rejects a gate: endorsements older than this instant
  -- no longer satisfy the gate, forcing a fresh round of domain endorsements.
  client_reviewed_at       timestamptz,
  PRIMARY KEY (project_id, stage_index)
);

CREATE TABLE endorsements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid    REFERENCES tenants (id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  stage_index int  NOT NULL CHECK (stage_index BETWEEN 1 AND 11),
  domain      text NOT NULL CHECK (domain IN
              ('PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT')),
  user_id     uuid NOT NULL REFERENCES users (id),
  decision    text NOT NULL CHECK (decision IN ('ENDORSED', 'CHANGES_REQUESTED')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, stage_index, domain)
);

CREATE TABLE stage_approvals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid    REFERENCES tenants (id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  stage_index int  NOT NULL CHECK (stage_index BETWEEN 1 AND 11),
  user_id     uuid NOT NULL REFERENCES users (id),
  decision    text NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- =========================== Delivery records =============================

CREATE TABLE documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid    REFERENCES tenants (id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  category    text NOT NULL CHECK (category IN
              ('REPORT', 'DRAWING', 'GEOTECH', 'CONTRACT', 'CERTIFICATE', 'APPROVAL',
               'CLIENT_DELIVERABLE', 'PHOTO', 'OTHER')),
  title       text NOT NULL,
  file_name   text NOT NULL,
  storage_key text,                      -- null ⇒ metadata-only record (seed data)
  mime_type   text,
  size_bytes  bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  stage_index int CHECK (stage_index BETWEEN 1 AND 11),
  uploaded_by uuid REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid    REFERENCES tenants (id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  title       text NOT NULL,
  description text,
  status      text NOT NULL DEFAULT 'BACKLOG' CHECK (status IN ('BACKLOG', 'IN_PROGRESS', 'REVIEW', 'DONE')),
  priority    text NOT NULL DEFAULT 'MEDIUM' CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH')),
  assignee_id uuid REFERENCES users (id) ON DELETE SET NULL,
  due_date    date,
  position    int NOT NULL DEFAULT 0,
  domain      text CHECK (domain IN
              ('PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Finance bounded context. Domain-scoped records must be endorsed by the
-- accountable domain lead before certification/approval.
CREATE TABLE payment_certificates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid    REFERENCES tenants (id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  certificate_no text NOT NULL,
  period_start   date NOT NULL,
  period_end     date NOT NULL,
  gross_value    numeric(14, 2) NOT NULL CHECK (gross_value >= 0),
  deductions     numeric(14, 2) NOT NULL DEFAULT 0 CHECK (deductions >= 0),
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ENDORSED', 'CERTIFIED', 'REJECTED')),
  domain         text CHECK (domain IN
                 ('PROFESSIONAL_SERVICES', 'GEOTECHNICAL', 'CONSTRUCTION_MANAGEMENT')),
  endorsed_by    uuid REFERENCES users (id),
  endorsed_at    timestamptz,
  certified_at   timestamptz,
  created_by     uuid REFERENCES users (id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, certificate_no),
  CHECK (period_end >= period_start)
);

CREATE TABLE variation_orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid         REFERENCES tenants (id) ON DELETE CASCADE,
  project_id       uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  vo_number        text NOT NULL,
  description      text NOT NULL,
  value            numeric(14, 2) NOT NULL,
  time_impact_days int NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'PROPOSED' CHECK (status IN ('PROPOSED', 'ENDORSED', 'APPROVED', 'REJECTED')),
  endorsed_by      uuid REFERENCES users (id),
  approved_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, vo_number)
);

-- Private-firm funding / client billing allocations (spec §7.2: retained,
-- used for client funding tracking, not a grant-instrument concept).
CREATE TABLE funding_allocations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid    REFERENCES tenants (id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  source_name text NOT NULL,
  funder_type text NOT NULL DEFAULT 'client' CHECK (funder_type IN ('client', 'internal', 'lender', 'other')),
  amount      numeric(14, 2) NOT NULL CHECK (amount > 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Who did what, when, append-only. Nothing updates or deletes rows here.
CREATE TABLE audit_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL DEFAULT current_setting('app.tenant_id', true)::uuid   REFERENCES tenants (id) ON DELETE CASCADE,
  actor_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  actor_role text,
  action     text NOT NULL,
  entity     text NOT NULL,
  entity_id  uuid,
  summary    text NOT NULL,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- =========================== Indexes ======================================

CREATE INDEX projects_tenant_status_idx   ON projects (tenant_id, status);
CREATE INDEX projects_tenant_client_idx   ON projects (tenant_id, client_org_id);
CREATE INDEX pda_user_idx                 ON project_domain_assignments (user_id);
CREATE INDEX endorsements_project_idx     ON endorsements (project_id, stage_index);
CREATE INDEX stage_approvals_project_idx  ON stage_approvals (project_id, stage_index);
CREATE INDEX documents_tenant_project_idx ON documents (tenant_id, project_id, category);
CREATE INDEX tasks_tenant_board_idx       ON tasks (tenant_id, status, position);
CREATE INDEX tasks_assignee_idx           ON tasks (assignee_id) WHERE assignee_id IS NOT NULL;
CREATE INDEX certificates_project_idx     ON payment_certificates (project_id, status);
CREATE INDEX certificates_certified_idx   ON payment_certificates (tenant_id, certified_at);
CREATE INDEX variations_project_idx       ON variation_orders (project_id);
CREATE INDEX funding_project_idx          ON funding_allocations (project_id);
CREATE INDEX audit_tenant_time_idx        ON audit_events (tenant_id, created_at DESC);
CREATE INDEX audit_entity_idx             ON audit_events (tenant_id, entity, entity_id);
CREATE INDEX sessions_user_idx            ON sessions (user_id, revoked_at);

-- =========================== Row-level security ===========================
-- The runtime role `provenance_app` is subject to these policies. The owner
-- role (migrations/seed/bootstrap) bypasses RLS by ownership.

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'client_organisations', 'users', 'sessions', 'projects',
    'project_domain_assignments', 'stage_gates', 'endorsements', 'stage_approvals',
    'documents', 'tasks', 'payment_certificates', 'variation_orders',
    'funding_allocations', 'audit_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I
         USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid)
         WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t);
  END LOOP;
END $$;

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_self_read ON tenants
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (false);  -- runtime may read its own tenant, never create/modify rows here

-- Grants: the runtime role may never alter schema or drop tables.
GRANT USAGE ON SCHEMA public TO provenance_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO provenance_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM provenance_app;
