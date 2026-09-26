# Database Schema, MongoDB

The schema lives in `backend/src/db/indexes.js`: one idempotent setup script that
creates the 15 collections and their indexes (`npm run db:migrate`, safe on every
deploy). Collections mirror the original relational schema one to one and keep
the same field names, so every API projection is unchanged from the frontend's
point of view.

## Tenancy model

There are no database roles to configure. Tenant isolation is enforced in the
data layer (`backend/src/db/mongo.js`):

* Every request runs inside a scope bound to its tenant. The scope injects
  `{ tenant_id }` into every filter, stamps every insert, and prepends the
  match stage to every aggregation. Route code cannot obtain a raw collection.
* The `tenants` collection is predicated on `_id` instead (a tenant reads only
  its own row).
* Bootstrap operations (registration, login tenant resolution, the seed) use an
  explicit unscoped root scope, the only code that can cross tenants.
* Multi-document writes run in a transaction (`withTenantTx`), so a change and
  its audit entry commit or roll back together. Transactions are why MongoDB
  must run as a replica set (Compose, Atlas and the local guide all provide
  one). Transient write conflicts are retried per the MongoDB guidance.

## Collections

* **tenants**, the firm. `org_type` is the single-valued `private_firm` constant
  (kept for forward compatibility per spec §4.1 open question 1);
  `workflow_profile` is pinned to `EVIDENTIARY_PRIVATE_V11`. No province or
  municipality fields exist. Unique: `slug`.
* **users**, unique `(tenant_id, email)`; role constrained to the ten-value set
  in `lib/rbac.js`; `client_org_id` scopes client-portal users;
  `access_expires_at` time-boxes `CLIENT_TEMP`. `password_hash` is never
  projected in queries.
* **sessions**, refresh-token sessions; referenced by id inside a signed JWT,
  rotated on every refresh, revoked on logout/disable/password change. TTL
  index on `expires_at`; freshness is additionally checked on every use.
* **client_organisations**, the firm's clients. `org_type` intentionally retains
  `municipality` / `government_dept` / `soe` (spec §4.2).
* **projects**, money and coordinates as strings exactly as the SQL types
  emitted them (`contract_value` "148500000.00", `latitude` "26.097");
  unique `(tenant_id, code)`; `current_stage_index` 1 to 11.
* **project_domain_assignments**, one lead per active domain section, unique
  `(project_id, domain)`; a project's active domains are exactly its documents.
* **stage_gates**, one document per stage per project, unique
  `(project_id, stage_index)`; `status` in LOCKED, IN_PROGRESS, PENDING_CLIENT,
  COMPLETED; `client_reviewed_at` invalidates stale endorsements after a client
  rejection.
* **endorsements**, one current document per (project, stage, domain), upserted
  on re-endorsement (upserts always get a uuid `_id`); `decision` in ENDORSED,
  CHANGES_REQUESTED.
* **stage_approvals**, append-only client decisions per gate.
* **documents / tasks**, delivery records; documents store metadata plus
  `storage_key` (files live outside the database, served only through the
  authorised download route; storage names are randomised server-side).
* **payment_certificates / variation_orders / funding_allocations**, the finance
  bounded context; certificates carry their own endorse to certify state machine
  and domain attribution so leads endorse only their own section's records.
  Unique: `(project_id, certificate_no)` and `(project_id, vo_number)`.
* **audit_events**, append-only; there is no update or delete path in the code.
  Writes happen only inside the transaction that makes the change.

## Index summary

| Collection | Index | Purpose |
|---|---|---|
| tenants | `slug` unique | workspace addresses |
| users | `(tenant_id, email)` unique | one account per email per workspace |
| projects | `(tenant_id, code)` unique · `(tenant_id, status)` · `(tenant_id, client_org_id)` | portfolio queries |
| sessions | `(user_id, revoked_at)` · TTL `expires_at` | revocation + expiry |
| project_domain_assignments | `(project_id, domain)` unique · `user_id` | gate requirements, my-endorsements |
| stage_gates | `(project_id, stage_index)` unique · `(tenant_id, status)` | gate machine, approvals queue |
| endorsements | `(project_id, stage_index, domain)` unique | one current decision per domain |
| documents | `(tenant_id, project_id, category)` · `(tenant_id, created_at)` | files register |
| tasks | `(tenant_id, status, position)` · `assignee_id` | kanban board |
| payment_certificates | `(project_id, certificate_no)` unique · `(tenant_id, certified_at)` | finance context, YTD charts |
| variation_orders | `(project_id, vo_number)` unique | finance context |
| funding_allocations | `project_id` | finance context |
| audit_events | `(tenant_id, created_at)` · `(tenant_id, entity, entity_id)` | trail reads |

## Value types (API compatibility)

* ids are uuid strings (also the `_id`), every response exposes `id`, never `_id`.
* money is a string with two decimals (`"148500000.00"`); an empty sum is `"0"`.
* dates (`start_date`, `due_date`, `period_end`, …) are `YYYY-MM-DD` strings.
* timestamps are BSON dates, serialised as ISO-8601.
