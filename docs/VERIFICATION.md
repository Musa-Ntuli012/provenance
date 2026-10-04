# System Verification Report

**Date:** 2026-09-26 · **Scope:** full system on the Supabase-compatible PostgreSQL backend (Vite/React frontend, CI, docs, animations)
**Method:** fresh-database gate, live behavioural security suite (40 checks), direct-database RLS proofs, static completeness scan.

**Result: COMPLETE, all checks pass.**

> Build history: the platform was first built and verified on PostgreSQL, then
> migrated to MongoDB at the owner's request (also fully verified, 40/40), then
> brought back to PostgreSQL targeting **Supabase** (managed Postgres) when the
> owner asked to stop running a local database server. The Supabase build
> restores the stronger isolation model: row-level security enforced inside the
> database, not just application code.

## 1. Environment and quality gates

| Check | Result |
|---|---|
| PostgreSQL 17 running; roles + database created; runtime role via `npm run db:bootstrap` | ✅ |
| Backend ESLint 0 problems; tests 9/9 (incl. the v2.1.0 §5.2 matrix) | ✅ |
| Frontend ESLint / `tsc -b` strict / production build | ✅ 0 problems |
| Fresh-database reproducibility (migrate → seed from empty) | ✅ |
| `db:ping` reports server version, TLS state, table count and RLS coverage (16 tables, 15 RLS-locked) | ✅ |
| API contract identical to the previous builds; frontend unchanged | ✅ |

## 2. Supabase-specific adaptation

| Check | Result |
|---|---|
| TLS to managed endpoints applied automatically (local hosts stay plaintext) | ✅ (`config.js` `sslFor`, by host) |
| Single-URI operation: `DATABASE_URL_ADMIN` falls back to `DATABASE_URL` | ✅ |
| Runtime role created/reset by `db:bootstrap` (no SQL editor required) | ✅ (verified live, idempotent) |
| Register duplicate race maps to a clean 409 (verified live) | ✅ |
| Startup fails fast with an actionable message when the database is unreachable | ✅ (verified: wrong password → exit 1, Supabase hints printed) |

## 3. Behavioural security suite (live API, 40/40 PASS)

Persona isolation (client sees exactly its organisation's projects), client
walls (finance/audit/tasks/certificates 403 or empty), **PM cannot approve or
endorse** (§5.2), cross-domain endorsement 403, full gate lifecycle (endorse →
PENDING_CLIENT → approve → advance; rejection path with stale endorsement
invalidation verified back to PENDING_CLIENT), finance state machine (certify
DRAFT 409, double-certify 409, deductions ≤ gross), audit chain, refresh
rotation with replay rejection, cross-tenant registration probe (0 projects,
foreign project 404, own audit events only), upload hardening (valid 201 with
randomised name, disallowed type 400 with server surviving, 16 MB 400, download
content match, client category scoping on list and download).

## 4. Row-level security, proven at the database level (as `provenance_app`)

| Proof | Result |
|---|---|
| Foreign tenant context set, `SELECT count(*) FROM projects` | ✅ **0 rows** |
| No tenant context | ✅ query **fails closed** (invalid uuid cast, no rows possible) |
| The real tenant's context | ✅ **6 rows** (its own portfolio) |

## 5. Defects found and fixed during this migration

1. **`db:bootstrap` used a bind parameter in `CREATE ROLE`**, PostgreSQL
   rejects parameters in utility statements. Fixed with proper literal
   escaping; caught by running the script against a real server.

## 6. Static completeness scan

Unicode dash characters across all sources, docs, UI copy and seed data: **0**
(working-identifier hyphens remain by design). Browser tab: plain
`PROVENANCE`. No secrets in tracked files (`.env` files excluded from the
archive). Deliverables present: env examples, Supabase + local-Docker quick
starts, CI (Postgres service), Dependabot, Compose + role init script, README
run guide, docs set, four Lottie animations + library.

## 7. Known, documented non-blockers

- The login rate limiter is in-memory per API process; restart clears it in
  development, back it with a shared store when running multiple instances.
- Supabase free-tier direct connections are IPv6-only; the session pooler URI
  (documented, and the default in `.env.example`) is IPv4-compatible.
- v2.1.0 delta backlog remains tracked in
  [`PROVENANCE-RECONCILIATION.md`](PROVENANCE-RECONCILIATION.md).
