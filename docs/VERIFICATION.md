# System Verification Report

**Date:** 2026-09-18 · **Scope:** full system on the MongoDB backend (Vite/React frontend, CI, docs, animations)
**Method:** fresh-database gate, live behavioural security suite, upload/download hardening, static completeness scan.

**Result: COMPLETE, all checks pass.** The behavioural suite runs 40 live checks
against the running API and passes 40 of 40.

> Note on history: the original build of this platform ran on PostgreSQL with
> two roles and row-level security; it passed its own full verification
> (including database-level isolation proofs) and is preserved in the
> `provenance_system.zip` archive. The database was migrated to MongoDB at the
> owner's request; tenant isolation moved from database RLS into the
> application's single tenant-scoped data layer, described in
> [`architecture/system-design.md`](architecture/system-design.md) §2.

## 1. Quality gates

| Gate | Backend | Frontend |
|---|---|---|
| ESLint | ✅ 0 problems | ✅ 0 problems |
| Type-check | n/a (JS) | ✅ `tsc -b` strict, 0 errors |
| Tests | ✅ 10/10 (incl. the v2.1.0 §5.2 endorsement ≠ approval matrix and tenancy filters) | n/a |
| Production build | n/a | ✅ `vite build` |
| Fresh-database reproducibility | ✅ database dropped → `db:migrate` (15 collections) → `db:seed` clean | n/a |
| API contract | ✅ identical response shapes to the previous build (field names, money strings, `id` keys) | ✅ zero frontend changes needed |

## 2. Behavioural security suite (live API, 40/40 PASS)

| Check | Result |
|---|---|
| All personas log in (admin, PM, 3 domain leads, 2 client approvers, CLIENT_TEMP) | ✅ |
| Client approver sees exactly their organisation's 1 project; CLIENT_TEMP sees only its org's 2 | ✅ |
| Client blocked from finance (`403`), audit trail (`403`), task board (empty), certificate creation (`403`) | ✅ |
| **PM cannot approve or endorse stage gates**, v2.1.0 §5.2 (`403`) | ✅ |
| CLIENT_TEMP approval attempt read-only blocked (`403`) | ✅ |
| Cross-domain endorsement blocked (`403`) | ✅ |
| All-domain endorsement → gate `PENDING_CLIENT` → client approval → stage advances to 3, gate `COMPLETED` | ✅ |
| Client **REJECTED** → gate returns to `IN_PROGRESS`; stale endorsements invalidated (fresh round required, verified back to `PENDING_CLIENT`) | ✅ |
| Wrong-client approval on another org's gate → `404` masked | ✅ |
| Wrong-domain certificate endorsement → `404` masked | ✅ |
| Finance state machine: certify a DRAFT rejected (`409`), endorse → certify `200`, double-certify `409`, deductions > gross `400` | ✅ |
| Audit trail holds endorse + approve + gate.completed chain, admin-visible | ✅ |
| Refresh rotation: single-use, `200` then replayed cookie `401` | ✅ |
| Cross-tenant isolation: fresh registration sees 0 projects, foreign project `404`, audit trail contains only its own events | ✅ |
| Login rate-limit trips after 10 attempts per 15 min (in-memory, per process) | ✅ |
| Upload hardening: valid upload `201` with randomised storage name; disallowed type `400` and the server survives; 16 MB rejected `400`; staff download `200` with byte-identical content; client blocked from internal REPORT download (`404`); client document list category-scoped | ✅ |

## 3. Defects found and fixed during this migration

1. **Transient transaction conflicts** (`Write conflict during plan execution`):
   long-lived zombie transaction state in the dev database (left by killed test
   processes) collided with new login transactions. Resolved by restarting the
   dev database, and the correct production fix was added regardless:
   `withTenantTx` retries transactions labelled
   `TransientTransactionError` (MongoDB's documented pattern) before surfacing.

## 4. Static completeness scan

| Check | Result |
|---|---|
| Unicode dash characters (em, en, figure, minus, box rules) in all sources, docs, UI copy and seed data | ✅ 0 (hyphens inside working identifiers remain by design: routes, file names, codes, CLI flags) |
| Browser tab | ✅ `<title>PROVENANCE</title>`, dash-free meta description |
| No SQL/Postgres remnants in backend, Compose, CI, README or docs | ✅ |
| `.env` files git-ignored; examples carry no real secrets | ✅ |
| Deliverables present: env examples ×3, CI (Mongo service), Dependabot, Compose (Mongo replica set), README run guide (Docker + local + Atlas), 6 docs, 4 Lottie animations + library | ✅ |

## 5. Deployment targets verified: local and cloud-style

Both supported MongoDB targets were exercised end to end with the same suite.

| Check | Local replica set (`mongodb://localhost:27017/...?replicaSet=rs0`) | Cloud-style (auth-enabled instance, Atlas-shaped URI) |
|---|---|---|
| Schema + seed (`db:setup`) | ✅ 15 collections, demo tenant | ✅ 15 collections, demo tenant |
| `db:ping` topology check | ✅ replica set, writable, READY | ✅ replica set rs0cloud, writable, READY |
| API boot + login | ✅ | ✅ |
| Behavioural suite (40 live checks) | ✅ 40/40 | ✅ 40/40 |
| Credentials with URL-encoded special character (`@` as `%40`) | n/a | ✅ accepted, wrong password rejected (`Authentication failed`) |
| Wrong credentials at boot | n/a | ✅ API exits 1 with a clear, actionable message |
| Transactions under authentication | n/a | ✅ (all mutating suite checks pass) |

The cloud-style target is a faithful stand-in for MongoDB Atlas: same driver
code path (`mongodb://` with credentials, `authSource`, `replicaSet`), same
transactions, same authentication semantics. Atlas additionally terminates TLS
and resolves through an SRV lookup (`mongodb+srv://`), both handled natively by
the driver; `npm run db:ping` verifies a real Atlas URI in one command.

## 6. Known, documented non-blockers

- The login rate limiter is in-memory per API process; restarting the API in
  development clears it. Back it with a shared store when running more than
  one instance.
- The local Compose database runs unauthenticated by design (development
  friction); use Atlas or an auth-enabled replica set for anything shared.
- v2.1.0 delta backlog (domain applicability flags, deliverable-level chain,
  Employer's Agent field, EOT/Penalty models, `/client/*` shell, dark theme,
  SiteMediaViewer) is tracked with priorities in
  [`PROVENANCE-RECONCILIATION.md`](PROVENANCE-RECONCILIATION.md).
