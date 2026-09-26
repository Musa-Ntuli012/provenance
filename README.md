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
2. [Prerequisites](#prerequisites)
3. [Quick start (Docker)](#quick-start-docker)
4. [Local MongoDB (Windows / macOS / Linux)](#local-mongodb-windows-macos-linux)
5. [MongoDB Atlas](#mongodb-atlas)
6. [Running the system](#running-the-system)
7. [Demo accounts](#demo-accounts)
8. [Environment variables](#environment-variables)
9. [Database schema & seed](#database-schema--seed)
10. [Tests, lint, build](#tests-lint-build)
11. [CI (GitHub Actions)](#ci-github-actions)
12. [Project structure](#project-structure)
13. [Troubleshooting](#troubleshooting)
14. [Production notes](#production-notes)
15. [Documentation map](#documentation-map)

***

## Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Frontend | **Vite 5 + React 18 + TypeScript** (strict) | Hand-rolled CSS design system (Atlas Sahara), TanStack Query, `lottie-web` feedback animations |
| Backend | Node 20 + Express 4 (ESM) | Helmet, rate limiting, Zod validation, JWT auth |
| Database | **MongoDB 7+** (replica set) | Native driver (no ODM), fixed two-decimal money strings, **tenant isolation enforced in one data layer** (see below) |
| Auth | Short-lived HS256 access JWT (algorithm allow-listed) + single-use rotating refresh sessions in `httpOnly` cookies | Tokens never stored in localStorage |

**How tenant isolation works:** MongoDB has no row-level security, so every
request receives a database scope bound to its tenant and every query, insert
and aggregation through that scope carries the tenant predicate automatically.
Route code cannot reach a raw collection. Multi-document writes (a change plus
its audit entry) commit in one transaction, which is why a replica set is
required everywhere (Compose, Atlas and the local guide below all provide one).

## Prerequisites

* **Node.js 20+** (`node -v` to check)
* **MongoDB 7+ running as a replica set**, via one of:
  Docker Compose (recommended), a local install (Section 4), or Atlas (Section 5)
* **Docker** (only if using the Compose route)

## Quick start (Docker)

```bash
# 0. clone and enter
cd provenance

# 1. database: boot MongoDB 7 as a single-node replica set
docker compose up -d               # waits healthy: initiates rs0 itself

# 2. backend
cd backend
cp .env.example .env               # default URI works; set your own JWT_SECRET
npm install
npm run db:setup                   # collections + indexes + demo seed
npm run dev                        # API → http://localhost:4000

# 3. frontend (new terminal)
cd frontend
npm install
npm run dev                        # app → http://localhost:5173  (proxies /api → :4000)
```

Open **http://localhost:5173**, sign in with a demo account below.

## Local MongoDB (Windows / macOS / Linux)

If you prefer a local service without Docker:

1. Install **MongoDB Community Server 7+** (on Windows: the MSI installs it as a
   Windows service).
2. Configure a **single-node replica set**, once. Add these two lines to the
   mongod config file, then restart the service:

   ```yaml
   replication:
     replSetName: rs0
   ```

   * Windows: config is `C:\Program Files\MongoDB\Server\7.0\bin\mongod.cfg`,
     restart with `net stop MongoDB` then `net start MongoDB`.
   * macOS (brew): config is `/opt/homebrew/etc/mongod.conf`.
   * Linux: config is `/etc/mongod.conf` (`systemctl restart mongod`).
3. Initiate it, once, from `mongosh`:
   ```js
   rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "localhost:27017" }] })
   ```
4. Point `backend/.env` at it:
   `MONGODB_URI=mongodb://localhost:27017/provenance?replicaSet=rs0`

The replica set is required, not optional: the API writes changes and their
audit entries inside multi-document transactions.

## MongoDB Atlas

1. Create a free **M0 cluster**, then a database user (Database Access) and a
   `provenance` database.
2. Allow your IP in Network Access.
3. Copy the connection string (Connect → Drivers) into `backend/.env`:
   `MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/provenance`
   Atlas clusters are replica sets already, so transactions work out of the box
   (this includes the free M0 tier). URL-encode special characters in the
   password (`@` becomes `%40`).
4. Verify before starting anything:
   `cd backend && npm run db:ping`, it should print
   `READY: replica set primary reachable, transactions available.`

## Running the system

| Command | Where | What it does |
|---|---|---|
| `npm run dev` | `backend/` | API on **:4000** with watch-reload |
| `npm run dev` | `frontend/` | App on **:5173**, proxying `/api/*` to :4000 |
| `npm run db:migrate` | `backend/` | Creates collections and indexes (idempotent, safe on every deploy) |
| `npm run db:seed` | `backend/` | Seeds/refreshes the demo workspace (idempotent) |
| `npm run db:setup` | `backend/` | `db:migrate` + `db:seed` |
| `npm run db:ping` | `backend/` | Connection check: verifies `MONGODB_URI` and prints the topology (use it for Atlas or a local service before starting the API) |
| `npm test` | `backend/` | Unit tests (RBAC matrix, gate rules, tenancy filters, validation) |
| `npm run lint` | either | ESLint |
| `npm run build` | `frontend/` | Type-checks and builds to `frontend/dist/` |
| `npm start` | `backend/` | API without watch (production-style) |

The app is a **multi-workspace** system: registration (`/register`) creates a new
firm workspace; every route is namespaced `/:slug/…`; tenants are isolated by
the data layer described above and proven by the behavioural test suite.

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
| `.env` (root, Compose) | `MONGO_HOST_PORT` | Host port (default 27017), optional |
| `backend/.env` | `MONGODB_URI` | Local: `mongodb://localhost:27017/provenance?replicaSet=rs0` · Atlas: `mongodb+srv://…` |
| | `MONGODB_DB_NAME` | Database name (default `provenance`) |
| | `JWT_SECRET` | ≥32 chars, `openssl rand -hex 48` |
| | `STORAGE_DIR` | Upload directory (default `./storage`) |
| | `CORS_ORIGINS` | Comma-separated allow-list (empty = same-origin only) |
| `frontend/.env` | `VITE_API_BASE_URL` | **Optional.** Empty = same-origin `/api`. Set only for split deployments |

`.env.example` files exist in all three locations. Never commit a real `.env`.
Special characters in an Atlas password must be URL-encoded inside the URI
(`@` becomes `%40`).

## Database schema & seed

There is no SQL migration runner: `npm run db:migrate` creates the 15
collections with their indexes (unique constraints, the sessions TTL,
compound query indexes). It is idempotent. Collections mirror the original
relational schema one to one and documents keep the same field names, so the
API contract is unchanged; see
[`docs/architecture/database-schema.md`](docs/architecture/database-schema.md).

Reset everything with:

```bash
docker compose down -v               # or drop the database/cluster
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
`ORG_ADMIN`; PMs and domain leads endorse only. CI runs the same gate against a
real MongoDB replica set.

There is also a live integration suite, `backend/tests/behavioural-suite.sh`
(40 checks over running HTTP: persona isolation, the client walls, the full
gate lifecycle including rejection and stale endorsements, the finance state
machine, cross-tenant isolation, session rotation, upload hardening). Run it
against a freshly seeded database and a freshly started API:

```bash
cd backend && npm run db:seed   # then restart the API, then:
bash tests/behavioural-suite.sh
```

It runs unchanged against any deployment the API is pointed at, local or Atlas:
export `WORKSPACE=mbe-demo` and it only needs `http://localhost:4000` (override
with `API_BASE` if the API lives elsewhere).

## CI (GitHub Actions)

`.github/workflows/ci.yml` on every push/PR:

| Job | Runs |
|---|---|
| **backend** | MongoDB 7 replica set → lint → migrate → seed → tests |
| **frontend** | lint → type-check → build (artifact uploaded) |
| **dependencies** | `npm audit` (advisory until triaged, flip to blocking) |
| **secrets** | gitleaks over full history |
| **sast** | Semgrep OWASP rules (advisory until triaged) |

Dependabot (`.github/dependabot.yml`) updates npm packages, Actions and the
Mongo image weekly.

## Project structure

```
provenance/
├== docker-compose.yml          local MongoDB 7 replica set
├== .github/workflows/ci.yml    the CI gate
├== backend/
│   └== src/
│       ├== app.js / server.js  Express app, graceful shutdown
│       ├== config.js           fail-fast env parsing
│       ├== db/                 mongo client, tenant-scoped data layer,
│       │                       collections/indexes (db:migrate), seed
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
| `ECONNREFUSED 127.0.0.1:27017` | MongoDB isn't running: `docker compose up -d` or start your local service |
| Anything connection-related, local or Atlas | `npm run db:ping` and read what it says (topology, writability, credentials) |
| `Transaction numbers are only allowed on a replica set member`, or register/seed fails with 500 INTERNAL | Your mongod is a standalone; the API refuses to start with guidance (check its console): see the local setup section (replSetName + `rs.initiate()`) |
| `MONGODB_URI` works locally but not in Atlas | Check Network Access (your IP) and the database user; URL-encode special characters in the password |
| `index ... duplicate key` on seed | A previous tenant already used a slug or code; reseed (`npm run db:seed` drops and recreates the demo workspace) |
| Login returns *Invalid workspace, email or password* | Workspace is `mbe-demo`; reseed with `npm run db:seed` |
| `JWT_SECRET must be at least 32 characters` | Set a real secret: `openssl rand -hex 48` |
| Port 4000/5173 busy | `PORT=4001 npm run dev` (backend) / `npm run dev -- --port 5174` (frontend) |
| Forgot passwords / want fresh data | Drop the database (Compose: `docker compose down -v`), then `npm run db:setup` |
| Uploads fail | Check `STORAGE_DIR` exists and is writable; max 15 MB; allow-listed types only |
| *Too many attempts, try again in 15 minutes* | The login rate limiter is in-memory per API process; restart the API in development to clear it |

## Production notes

* Build the frontend (`npm run build`) and serve `dist/` behind a reverse proxy that
  forwards `/api` to the backend; or set `VITE_API_BASE_URL` and enable CORS.
* `NODE_ENV=production` makes the backend fail-fast on missing secrets and sends
  `Secure` cookies, serve over HTTPS.
* Run MongoDB as a **real replica set** (Atlas or self-hosted, three nodes for
  production): transactions and durability depend on it. The Compose database is
  unauthenticated and for local development only; anything shared needs auth and
  a private network.
* Uploads live on disk under `STORAGE_DIR`; swap for object storage before scaling out.
* Sessions are server-side documents with a TTL index: disabling a user or
  rotating a password revokes them immediately.
* After deploying against a new cluster, `npm run db:ping`, `npm run db:setup`, and run
  `bash tests/behavioural-suite.sh` once as an acceptance test.
* Flip CI's advisory `dependencies`/`sast` jobs to blocking once the baseline is triaged.

## Documentation map

| Doc | Contents |
|---|---|
| [`docs/EVIDENTIARY-v2.1.0-LOGIC.md`](docs/EVIDENTIARY-v2.1.0-LOGIC.md) | The operative v2.1.0 rules: domains, scoping, approval chains, Employer's Agent, portal, design deltas |
| [`docs/PROVENANCE-RECONCILIATION.md`](docs/PROVENANCE-RECONCILIATION.md) | What's implemented vs. pending + prioritised backlog |
| [`docs/architecture/system-design.md`](docs/architecture/system-design.md) | Architecture, trust boundaries, gate state machine |
| [`docs/architecture/database-schema.md`](docs/architecture/database-schema.md) | Collections, indexes, tenancy model |
| [`docs/api.md`](docs/api.md) | Endpoint catalogue |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Design system (Atlas Sahara + Apple-material behaviour) |
| [`docs/VERIFICATION.md`](docs/VERIFICATION.md) | Full system verification report: gates, behavioural suite, defects found and fixed |

***

PROVENANCE · Kyvrex (Pty) Ltd · private-firm platform
