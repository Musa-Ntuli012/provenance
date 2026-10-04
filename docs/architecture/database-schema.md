# Database Schema, PostgreSQL

Migrations live in `backend/src/db/migrations/`, applied in order and recorded in
`schema_migrations`. The seed (`backend/src/db/seed.js`) creates the demo tenant
and is safe to re-run.

## Roles & trust boundaries

| Role | Used by | RLS |
|---|---|---|
| `provenance_owner` | migrations, seed, registration/login tenant lookup | bypasses (table owner) |
| `provenance_app` | all request traffic | **bound by row-level security on every tenant table** |

## Tables

* **tenants**, the firm. `org_type` is a single-valued `CHECK (org_type = 'private_firm')`
  constant (kept for forward compatibility per spec §4.1 open question 1);
  `workflow_profile` is pinned to `EVIDENTIARY_PRIVATE_V11`. No province or
  municipality fields exist.
* **users**, `UNIQUE (tenant_id, email)`; role constrained to the ten-value set;
  `client_org_id` scopes client-portal users; `access_expires_at` time-boxes
  `CLIENT_TEMP`. `password_hash` is never projected in queries.
* **sessions**, refresh-token sessions; referenced by id inside a signed JWT,
  rotated on every refresh, revoked on logout/disable/password change.
* **client_organisations**, the firm's clients. `org_type` intentionally retains
  `municipality` / `government_dept` / `soe` (spec §4.2).
* **projects**, money is `NUMERIC(14,2)`; `UNIQUE (tenant_id, code)`; GPS as
  `NUMERIC(9,6)`; `current_stage_index` 1, 11.
* **project_domain_assignments**, one lead per active domain section
  (`PRIMARY KEY (project_id, domain)`); a project's active domains are exactly its
  rows here.
* **stage_gates**, one row per stage per project; `status ∈ {LOCKED,
  IN_PROGRESS, PENDING_CLIENT, COMPLETED}`; `client_reviewed_at` invalidates
  stale endorsements after a client rejection.
* **endorsements**, one current row per (project, stage, domain), upserted on
  re-endorsement; `decision ∈ {ENDORSED, CHANGES_REQUESTED}`.
* **stage_approvals**, append-only client decisions per gate.
* **documents / tasks**, delivery records; documents store metadata + storage key
  (files live outside the DB, served only through the authorised download route).
* **payment_certificates / variation_orders / funding_allocations**, the finance
  bounded context; certificates carry their own endorse→certify state machine and
  domain attribution so leads endorse only their own section's records.
* **audit_events**, append-only; no UPDATE/DELETE grant pattern in the service
  layer (writes happen only inside the transaction that makes the change).

## Row-level security

Applied by a `DO` block over every tenant-scoped table:

```sql
CREATE POLICY tenant_isolation ON <table>
  USING      (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
```

`tenants` itself gets a read-only self policy (`WITH CHECK (false)`).

Every `tenant_id` column defaults to `current_setting('app.tenant_id', true)::uuid`,
so runtime inserts inherit the transaction's tenant context automatically, a
missing tenant_id cannot silently become NULL. The request transaction wrapper
(`withTenant`) sets the context with `set_config(..., true)` (transaction-local),
so a checked-in pooled connection never carries tenant state between requests.
