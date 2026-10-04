# PROVENANCE

*The chain of custody for engineering delivery.*

A private-firm engineering project management platform: an **11-stage stage-gated
lifecycle**, three domain sections (**Professional Services, Geotechnical,
Construction Management**), **finance as a first-class bounded context** (payment
certificates, variation orders, funding), a **scoped client portal**, and an
**append-only audit trail**.

Private-firm only by design, the dual-tenant government mode described in the
original EVIDENTIARY spec was removed, not ported. The operative EVIDENTIARY
v2.1.0 logic (domains, endorsement chains, the Employer's Agent rule) is codified
in [`docs/EVIDENTIARY-v2.1.0-LOGIC.md`](docs/EVIDENTIARY-v2.1.0-LOGIC.md).

***

## Contents

1. [Tech stack](#tech-stack)
2. [Quick start: Supabase](#quick-start-supabase)
3. [Quick start: local PostgreSQL (Docker)](#quick-start-local-postgresql-docker)
4. [Running the system](#running-the-system)
5. [Demo accounts](#demo-accounts)
6. [Environment variables](#environment-variables)
7. [Database schema & seed](#database-schema--seed)
8. [Tests, lint, build](#tests-lint-build)
9. [CI (GitHub Actions)](#ci-github-actions)
10. [Project structure](#project-structure)
11. [Troubleshooting](#troubleshooting)
12. [Production notes](#production-notes)
13. [Documentation map](#documentation-map)

***

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Vite 5 + React 18 + TypeScript** (strict) | Hand-rolled CSS design system (Atlas Sahara), TanStack Query, `lottie-web` feedback animations |
| Backend | Node 20 + Express 4 (ESM) | Helmet, rate limiting, Zod validation, JWT auth |
| Database | **PostgreSQL 15+**, Supabase or local | Plain parameterised SQL (no ORM), `NUMERIC` money, **row-level security for tenant isolation**: the database itself refuses cross-tenant rows |
| Auth | Short-lived HS256 access JWT (algorithm allow-listed) + single-use rotating refresh sessions in `httpOnly` cookies | Tokens never stored in localStorage |

**Two database roles:** the **admin** connection (Supabase `postgres` user, or
`provenance_owner` locally) runs migrations, seed and bootstrap and bypasses
row-level security. The **runtime** connection (role `provenance_app`, created by
`npm run db:bootstrap`) serves every request and is constrained by RLS on every
table: even a bug in application code cannot read or write another tenant's rows.

## Quick start: Supabase

1. Create a free project at **supabase.com** (keep the database password handy).
2. Project Settings → Database → Connection string → URI, select the
   **Session pooler** (port 5432). It looks like
   `postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`
   URL-encode special characters in the password (`@` becomes `%40`).
3. Network access: add your current IP (and your server's IP for deployments).
4. From `backend/`, create the runtime role once (against the admin URI):

   ```bash
   DATABASE_URL_ADMIN="<the session pooler URI>" \
   APP_ROLE_PASSWORD="choose-a-runtime-password" \
   npm run db:bootstrap
   ```

5. Create `backend/.env` (see `.env.example`; the two URLs use the same host
   and database, the admin one as `postgres.<ref>`, the runtime one as
   `provenance_app`):

   ```
   DATABASE_URL_ADMIN=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   DATABASE_URL=postgresql://provenance_app:<runtime-password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   JWT_SECRET=<openssl rand -hex 48>
   ```

6. Verify, set up, run:

   ```bash
   npm run db:ping      # READY + schema summary
   npm run db:setup     # migrations + demo seed
   npm run dev          # API on :4000
   ```

7. In a second terminal, the frontend (`cd frontend && npm install && npm run dev`)
   and open **http://localhost:5173**.

## Quick start: local PostgreSQL (Docker)

```bash
# 1. database
cp .env.example .env               # edit the two passwords
docker compose up -d               # Postgres 17 + both roles, healthchecked

# 2. backend
cd backend
cp .env.example .env               # same two passwords + your own JWT_SECRET
npm install
npm run db:setup                   # migrations + demo seed
npm run dev                        # API on :4000

# 3. frontend (new terminal)
cd frontend
npm install
npm run dev                        # app on :5173 (proxies /api → :4000)
```

## Running the system

| Command | Where | What it does |
|---|---|---|
| `npm run dev` | `backend/` | API on **:4000** with watch-reload |
| `npm run dev` | `frontend/` | App on **:5173**, proxying `/api/*` to :4000 |
| `npm run db:ping` | `backend/` | Connection check: server version, TLS, tables, RLS coverage |
| `npm run db:bootstrap` | `backend/` | Creates/resets the `provenance_app` runtime role + grants (needs `APP_ROLE_PASSWORD`) |
| `npm run db:migrate` | `backend/` | Applies pending SQL migrations (tracked in `schema_migrations`) |
| `npm run db:seed` | `backend/` | Seeds/refreshes the demo workspace (idempotent) |
| `npm run db:setup` | `backend/` | `db:migrate` + `db:seed` |
| `npm test` | `backend/` | Unit tests (RBAC matrix, gate rules, validation) |
| `npm run lint` | either | ESLint |
| `npm run build` | `frontend/` | Type-checks and builds to `frontend/dist/` |

## Demo accounts

Seeded by `npm run db:seed`, workspace **`mbe-demo`**, password
**`Provenance!Demo1`** for all (development only, never seed real passwords):

| Persona | Email | Sees |
|---|---|---|
| Org admin | `amara@molamobosman.co.za` | Everything, including the audit trail |
| Project manager | `thabiso@molamobosman.co.za` | Portfolio, finance certification (cannot approve gates) |
| Construction lead | `carel@molamobosman.co.za` | Only Construction Management endorsements |
| Geotechnical lead | `sipho@molamobosman.co.za` | Only Geotechnical endorsements |
| Client approver | `dineo@bluekruger.co.za` | **Only** Blue Kruger's project + gate sign-offs |

Try the full loop: sign in as Carel → endorse PRJ-001's current stage → the gate
moves to *awaiting client* → sign in as Gugu Mahlangu
(`g.mahlangu@tshwane.gov.za`) → approve it → the project advances a stage, and
the whole chain lands in the audit trail.

## Environment variables

| File | Variable | Purpose |
|---|---|---|
| `.env` (root, local Docker only) | `POSTGRES_PASSWORD` | Owner role password |
| | `APP_ROLE_PASSWORD` | Runtime (RLS-bound) role password |
| | `POSTGRES_HOST_PORT` | Host port (default 5432) |
| `backend/.env` | `DATABASE_URL_ADMIN` | Admin URI (migrations, seed, bootstrap). Supabase: the `postgres.<ref>` session pooler URI |
| | `DATABASE_URL` | Runtime URI as `provenance_app` (every request, RLS-bound) |
| | `JWT_SECRET` | ≥32 chars, `openssl rand -hex 48` |
| | `STORAGE_DIR` | Upload directory (default `./storage`) |
| | `CORS_ORIGINS` | Comma-separated allow-list (empty = same-origin only) |
| `frontend/.env` | `VITE_API_BASE_URL` | **Optional.** Empty = same-origin `/api`. Set only for split deployments |

`.env.example` files exist in all three locations. Never commit a real `.env`.
Special characters in a Supabase password must be URL-encoded inside the URI
(`@` becomes `%40`). TLS to managed endpoints is automatic; local connections
stay plaintext.

## Database schema & seed

Migrations are ordered SQL files in `backend/src/db/migrations/`, applied inside
transactions and recorded in `schema_migrations`. Reset everything with:

```bash
dropdb -h localhost -U provenance_owner provenance && createdb -h localhost -U provenance_owner provenance   # local
# Supabase: use the SQL editor: DROP SCHEMA public CASCADE; CREATE SCHEMA public;
cd backend && npm run db:setup
```

The seed creates *Molamo Bosman Consulting Engineers*: 6 projects spread across
the 11-stage ladder, certificates, variations, tasks, documents, endorsements,
a pending client approval, and the accounts above.

## Tests, lint, build

```bash
cd backend  && npm run lint && npm test
cd frontend && npm run lint && npx tsc -b && npm run build
```

The backend suite includes the **endorsement ≠ approval** regression test
(EVIDENTIARY v2.1.0 §5.2): approval is reserved for `CLIENT_APPROVER` +
`ORG_ADMIN`; PMs and domain leads endorse only.

There is also a live integration suite, `backend/tests/behavioural-suite.sh`
(40 checks over running HTTP: persona isolation, the client walls, the full
gate lifecycle including rejection and stale endorsements, the finance state
machine, cross-tenant isolation, session rotation, upload hardening). Run it
against a freshly seeded database and a freshly started API:

```bash
cd backend && npm run db:seed   # then restart the API, then:
bash tests/behavioural-suite.sh
```

## CI (GitHub Actions)

`.github/workflows/ci.yml` on every push/PR:

| Job | Runs |
|---|---|
| **backend** | Postgres 17 service → lint → migrate → seed → tests (two-role model included) |
| **frontend** | lint → type-check → build (artifact uploaded) |
| **dependencies** | `npm audit` (advisory until triaged, flip to blocking) |
| **secrets** | gitleaks over full history |
| **sast** | Semgrep OWASP rules (advisory until triaged) |

Dependabot (`.github/dependabot.yml`) updates npm packages, Actions and the
Postgres image weekly.

## Project structure

```
provenance/
├== docker-compose.yml          local Postgres 17 + both roles
├== docker/init/01-roles.sh     creates provenance_app on first container boot
├== .github/workflows/ci.yml    the CI gate
├== backend/
│   └== src/
│       ├== app.js / server.js  Express app, fail-fast startup, graceful shutdown
│       ├== config.js           env parsing, TLS policy for managed Postgres
│       ├== db/                 two pools (admin + runtime) with withTenant(),
│       │                       migrations, bootstrap (runtime role), ping, seed
│       ├== lib/                rbac.js (capability matrix) · audit · errors · fields
│       ├== middleware/         auth (JWT) · validate (zod) · error (generic-out)
│       └== modules/            auth · tenants · users · clients · projects(+service)
│                               finance · documents · tasks · dashboard · audit
└== frontend/
    └== src/
        ├== assets/animations/  the four Lottie states (loading/empty/failed/success)
        ├== components/         AppShell · ui kit · charts · icons · animations
        ├== features/           auth · dashboard · projects · clients · approvals
        │                       kanban · calendar · reports · maps · files · settings
        ├== styles/             tokens.css · ui.css · app.css (Atlas Sahara)
        └== api/                fetch client (in-memory token, silent refresh)
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| `password authentication failed` | Check the URI's role and password; on Supabase the admin URI is `postgres.<ref>`, the runtime URI is `provenance_app` (create it with `npm run db:bootstrap`) |
| `no pg_hba.conf entry ... no encryption` | TLS required: use the Supabase **session pooler** URI; TLS is applied automatically for non-localhost hosts |
| Supabase connection times out | Network access: allow your IP in the dashboard; prefer the session pooler URI (IPv4-compatible) over the direct one (IPv6-only on free plans) |
| `relation "tenants" does not exist` | Run `npm run db:migrate` |
| `role "provenance_app" does not exist` at migrate | Run `APP_ROLE_PASSWORD=... npm run db:bootstrap` first (or create the role in the Supabase SQL editor) |
| Login returns *Invalid workspace, email or password* | Workspace is `mbe-demo`; reseed with `npm run db:seed` |
| `JWT_SECRET must be at least 32 characters` | Set a real secret: `openssl rand -hex 48` |
| Port 4000/5173 busy | `PORT=4001 npm run dev` (backend) / `npm run dev -- --port 5174` (frontend) |
| Forgot passwords / want fresh data | Drop + recreate the schema or database, then `npm run db:setup` |
| Uploads fail | Check `STORAGE_DIR` exists and is writable; max 15 MB; allow-listed types only |
| *Too many attempts, try again in 15 minutes* | The login rate limiter is in-memory per API process; restart the API in development to clear it |

## Production notes

* Build the frontend (`npm run build`) and serve `dist/` behind a reverse proxy that
  forwards `/api` to the backend; or set `VITE_API_BASE_URL` and enable CORS.
* `NODE_ENV=production` makes the backend fail-fast on missing secrets and sends
  `Secure` cookies, serve over HTTPS.
* Only the runtime (`provenance_app`) credential belongs in app pods; the admin
  credential stays in the migration/ops environment. For strict TLS verification,
  pin Supabase's CA instead of the default permissive mode (see `config.js`).
* Uploads live on disk under `STORAGE_DIR`; swap for object storage before scaling out.
* Sessions are server-side rows: disabling a user or rotating a password revokes
  them immediately.
* After pointing at a new database: `npm run db:ping`, `npm run db:bootstrap`,
  `npm run db:setup`, then run `bash tests/behavioural-suite.sh` once as an
  acceptance test.
* Flip CI's advisory `dependencies`/`sast` jobs to blocking once the baseline is triaged.

## Documentation map

| Doc | Contents |
|---|---|
| [`docs/EVIDENTIARY-v2.1.0-LOGIC.md`](docs/EVIDENTIARY-v2.1.0-LOGIC.md) | The operative v2.1.0 rules: domains, scoping, approval chains, Employer's Agent, portal, design deltas |
| [`docs/PROVENANCE-RECONCILIATION.md`](docs/PROVENANCE-RECONCILIATION.md) | What's implemented vs. pending + prioritised backlog |
| [`docs/architecture/system-design.md`](docs/architecture/system-design.md) | Architecture, trust boundaries, gate state machine |
| [`docs/architecture/database-schema.md`](docs/architecture/database-schema.md) | Tables, constraints, RLS policies |
| [`docs/api.md`](docs/api.md) | Endpoint catalogue |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Design system (Atlas Sahara + Apple-material behaviour) |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | Full system verification report: gates, behavioural suite, defects found and fixed |

***

PROVENANCE · Kyvrex (Pty) Ltd · private-firm platform
