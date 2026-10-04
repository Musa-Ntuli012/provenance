# PROVENANCE, System Design

Private-firm engineering delivery governance. Companion docs:
[database-schema.md](database-schema.md) ·
[EVIDENTIARY-v2.1.0-LOGIC.md](../EVIDENTIARY-v2.1.0-LOGIC.md) ·
[PROVENANCE-RECONCILIATION.md](../PROVENANCE-RECONCILIATION.md) ·
[api.md](../api.md)

## 1. Architecture

```
┌============================┐        ┌==================================┐
│  Vite + React 18 (TS)      │  /api  │  Express 4 (ESM, Node 20)        │
│  = same-origin fetch ======┼=======▶│  helmet · rate-limit · zod · jwt │
│  token in memory only      │ proxy  │                                  │
│  httpOnly refresh cookie   │        │  routes → services (SQL only)    │
└============================┘        │  withTenant() tx wrapper ========┼==┐
                                      └==================================┘  │
                                                                            ▼
                                                            ┌==========================┐
                                                            │  PostgreSQL 17           │
                                                            │  provenance_app (RLS)    │
                                                            │  provenance_owner (DDL)  │
                                                            └==========================┘
```

* **One origin in development**: the browser talks only to Vite (5173); Vite proxies
  `/api` → Express (4000). In production a reverse proxy (or `VITE_API_BASE_URL` for
  split deploys) provides the same shape.
* **No ORM.** Every query is a parameterised SQL statement in a service module,
  reviewable as code (OWASP A04 posture).

## 2. Trust boundaries & tenant isolation

Two database roles with different trust levels:

| Role | Trust | Used for |
|---|---|---|
| `provenance_owner` | Bypasses RLS (owns tables) | Migrations, seed, registration, login tenant lookup |
| `provenance_app` | Bound by RLS on every tenant table | All request traffic |

Request lifecycle for tenant-scoped data:

```
request → authRequired (verify HS256 JWT, re-read user row, expiry checks)
        → withTenant(tenantId, async db => { … })   == BEGIN
        →   set_config('app.tenant_id', $tid, true) == transaction-local context
        →   service SQL (all reads/writes filtered by RLS)
        →   audit(...)                              == same transaction
        → COMMIT / ROLLBACK
```

Defense in depth:

1. **RLS policies** (`tenant_id = current_setting('app.tenant_id')`) make cross-tenant
   reads/writes physically impossible for the runtime role, app bugs cannot leak rows.
2. `tenant_id` columns default to the session context, so an insert cannot "forget" it.
3. Services additionally scope by resource (e.g. client-organisation users are
   constrained to their client's projects via explicit predicates).
4. Bootstrap paths (register/login) use the owner connection explicitly and touch no
   request-scoped data.

## 3. Authorisation model

Three layers, all server-side (`lib/rbac.js` is the source of truth; the UI mirrors it
for convenience only):

1. **Role gates** (`requireRole`), coarse, per-route.
2. **Capability gates** (`requireCapability`), the role→capability matrix decides
   whether the role can perform the *class* of action (`finance.certify`, `documents.delete`, …).
3. **Resource scoping**, service code verifies the *specific record*: domain leads may
   endorse only their assigned domain; CLIENT_APPROVERs only their organisation's
   projects; CLIENT_TEMP is read-only everywhere.

**Endorsement vs. approval (EVIDENTIARY v2.1.0 §5.2, adopted):** `approvals.client` is
held **only** by `CLIENT_APPROVER` and `ORG_ADMIN`. PMs and Domain Leads endorse, they
never approve. Enforced by test (`tests/unit.test.js`).

## 4. Stage-gate state machine

```
            ┌==========┐  all assigned domains   ┌================┐  client APPROVED  ┌===========┐
  stage i   │ IN_      │  ENDORSED (current)     │ PENDING_CLIENT │ ================▶ │ COMPLETED │==▶ stage i+1 opens
  opens     │ PROGRESS │ ======================▶ │                │                   └===========┘    (stage 11 → project COMPLETE)
            └==========┘                         └=======┬========┘
                         ▲   any endorsement             │ client REJECTED
                         │   withdrawn/stale             ▼
                         └====================================
                            status → IN_PROGRESS, client_reviewed_at = now()
                            (endorsements older than this instant no longer count)
```

* Which domains must endorse = the project's `project_domain_assignments` rows.
* "Current" endorsement = newer than the gate's `client_reviewed_at`.
* `client_approval_required = false` short-circuits PENDING_CLIENT (auto-complete).
* Every transition writes an `audit_events` row **inside the same transaction**.

## 5. Finance bounded context

Payment certificates (DRAFT → ENDORSED → CERTIFIED | REJECTED), variation orders
(PROPOSED → ENDORSED → APPROVED | REJECTED), and funding allocations live behind
`/api/finance/*` with their own capability set (`finance.read/write/endorse/certify`).
Certificate endorsement is **domain-checked** (a lead endorses only their domain's
certificates; ORG_ADMIN may act on any). The stage engine never reads finance,
when the Final Account gate arrives (reconciliation backlog §4.5/4.6) it will be the
single documented exception. Money is `NUMERIC(14,2)`; amounts arrive as JSON numbers,
range-checked by Zod, rendered through DM Mono tabular figures.

## 6. Frontend architecture

* **State**: TanStack Query (server state) + a tiny auth context (session). No global
  client-state library, the app is read/write over an API, not a local-document editor.
* **Shell**: translucent sidebar + topbar (backdrop-filter materials), route-level
  `screen` transitions, press-on-`:active` feedback, reduced-motion/transparency
  fallbacks (see `docs/DESIGN.md`).
* **Client portal**: client-organisation roles receive a scoped surface (their projects,
  pending approvals, read-only detail), the full `/client/*` shell is the next
  iteration (reconciliation §4.7).
* **Error handling**: `ApiError` carries code + field-level details; user-facing messages
  are generic; 401 triggers one silent refresh attempt then redirects to login.

## 7. Module map (backend)

```
src/
├== config.js               env parsing, fail-fast (prod requires real values)
├== app.js                  helmet · cors allow-list · rate-limit · routes · errors
├== server.js               listen + graceful shutdown (pools closed)
├== db/
│   ├== pool.js             two pools + withTenant()/withAdmin() transaction wrappers
│   ├== migrate.js          ordered SQL migrations in schema_migrations
│   ├== seed.js             demo tenant (idempotent, dev passwords only)
│   └== migrations/001_init.sql
├== lib/  rbac.js · errors.js · fields.js · audit.js
├== middleware/  auth.js · validate.js (zod) · error.js (generic-out, detailed-log)
└== modules/
    ├== auth.routes.js          register · login · refresh(rotation) · logout · me
    ├== tenants.routes.js       org settings
    ├== users.routes.js         team CRUD · disable(revokes sessions) · password change
    ├== clients.routes.js       client orgs + portal access grants (approver/temporary)
    ├== projects.routes.js      portfolio CRUD · endorse · client-approval · pending queue
    ├== projects.service.js     gate state machine · resource scoping
    ├== finance.routes.js       certificates · variations · funding
    ├== documents.routes.js     upload (allow-listed) · authorised download · register
    ├== tasks.routes.js         kanban CRUD
    ├== dashboard.routes.js     firm + client KPIs
    └== audit.routes.js         append-only trail reads (ORG_ADMIN)
```

## 8. CI/CD

GitHub Actions (`.github/workflows/ci.yml`): backend job runs **on a real Postgres 17
service** with the same two-role model, lint → migrate → seed → tests; frontend job
lints, type-checks and builds; plus SCA (`npm audit`), secrets (gitleaks), SAST
(semgrep). Dependabot covers both npm projects, the actions, and the Docker image.
See the workflow header for which jobs are currently advisory vs blocking.
