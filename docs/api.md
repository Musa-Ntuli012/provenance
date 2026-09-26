# PROVENANCE, API Endpoint Catalogue

All routes are prefixed `/api`. JSON bodies; errors shaped
`{ error: { code, message, details? } }`. Auth = `Authorization: Bearer <access token>`;
the refresh cookie is `httpOnly`, `path=/api/auth`. Capability checks are noted per
route, every route is also subject to the role matrix (`lib/rbac.js`) and the
tenant-scoped data layer (every query is bound to the caller's tenant).

## Auth (`/api/auth`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/register` | public (rate-limited) | Creates tenant + ORG_ADMIN. Private-firm only; no province/org-type fields (v2.1.0 §12). |
| POST | `/login` | public (rate-limited) | `{ slug, email, password }` → access token + refresh cookie. Audited. |
| POST | `/refresh` | cookie | Single-use rotation; replayed tokens are rejected. |
| POST | `/logout` | cookie | Revokes the session row. |
| GET | `/me` | any | Current user + tenant. |

## Tenant & team

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/tenant/current` | any | Org profile. |
| PATCH | `/tenant/current` | `tenant.write` | ORG_ADMIN. Audited. |
| GET | `/users` | role gate (ORG_ADMIN, PM) | Never returns `password_hash`. |
| POST | `/users` | `users.write` | ORG_ADMIN; staff roles only; audited. |
| PATCH | `/users/:id` | `users.write` | Role/status changes audited; self-role-change blocked; **disable revokes live sessions**. |
| POST | `/users/me/password` | self | Revokes all sessions. |

## Clients (`/api/clients`)

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/` | any staff | Roster + project counts + value. |
| POST | `/` | `clients.write` | `org_type` ∈ municipality/government_dept/private_entity/soe/other, legitimate client types (v2.1.0 §0.1). |
| PATCH | `/:id` | `clients.write` | |
| POST | `/access` | `clients.write` | Grants `CLIENT_APPROVER` (standing) or `CLIENT_TEMP` (time-boxed, read-only) portal access scoped to that client org. Audited. |

## Projects (`/api/projects`)

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/` | any | Filters: `domain`, `status`, `q`. Client roles scoped to their org. |
| GET | `/approvals/pending` | any | Role-aware queue: client → gates awaiting them; leads → gates needing their domain; PM/ORG_ADMIN → all in-flight. |
| GET | `/:id` | any (scoped) | Detail: gates + endorsements + approvals; finance summary staff-only. |
| POST | `/` | `projects.write` | Creates 11-gate ladder; domain leads validated against lead roles. |
| PATCH | `/:id` | `projects.write` | |
| POST | `/:id/stages/:stage/endorse` | `endorse` + **assignment check** | `domain` ∈ PS/Geo/CM; non-assigned leads and cross-domain attempts → 403. |
| POST | `/:id/stages/:stage/client-approval` | `approvals.client` | **ORG_ADMIN + CLIENT_APPROVER only** (v2.1.0 §5.2). APPROVED completes the gate and opens the next stage; REJECTED returns it for fresh endorsements. Audited. |

## Finance (`/api/finance`)

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/projects/:id/certificates` | `finance.read` | |
| POST | `/projects/:id/certificates` | `finance.write` | Gross ≥ deductions; unique per project. Audited. |
| POST | `/certificates/:id/endorse` | `finance.endorse` + **domain check** | Lead endorses only their domain's certs (ORG_ADMIN excepted); 404 (not 403) for foreign-domain records. |
| POST | `/certificates/:id/certify` | `finance.certify` | Only from ENDORSED. |
| GET/POST | `/projects/:id/variation-orders` | `finance.read` / `finance.write` | |
| POST | `/variation-orders/:id/endorse` | `finance.endorse` | *Domain-checking on VOs lands with the v2.1.0 backlog (reconciliation §4.5).* |
| POST | `/variation-orders/:id/decision` | `finance.write` | APPROVED/REJECTED from ENDORSED. |
| GET/POST | `/projects/:id/funding` | `finance.read` / `finance.write` | |
| DELETE | `/funding/:id` | `finance.write` | Audited. |

## Documents (`/api/documents`)

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/` | any (scoped) | Register; client roles see only their categories. |
| GET | `/projects/:id/documents` | any (scoped) | Per-project, category-filterable client-side. |
| POST | `/` | `documents.write` | Multipart. Extension allow-list (pdf/img/office/csv/txt/zip/dwg/ifc), 15 MB cap, randomised storage names, never client filenames. |
| GET | `/:id/download` | any (scoped) | Authorised stream; `basename()` storage resolution (no traversal); client category check. |
| DELETE | `/:id` | `documents.delete` | Removes row + file; audited. |

## Tasks (`/api/tasks`)

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/` | staff | Client roles get an empty set (no task board in the portal). |
| POST | `/` | `tasks.write` | |
| PATCH | `/:id` | `tasks.write` | Status moves audited. |

## Dashboard & audit

| Method | Path | Capability | Notes |
|---|---|---|---|
| GET | `/dashboard` | any | Firm KPIs (staff) or scoped client KPIs + pending approvals (client roles). |
| GET | `/audit` | `audit.read` (ORG_ADMIN) | Filters: `entity`, `projectId`, `limit`. Read-only, **no write/delete route exists**; writes happen only inside the transactions that make each change. |

## Health

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | public | Liveness. |

## Planned (v2.1.0 backlog, see reconciliation §4)

`PATCH /projects/:id/domains/:domain` (applicability + N/A reason) ·
`POST/DELETE /projects/:id/domains/:domain/assignments` (lead|member) ·
`POST /projects/:id/deliverables/:key/endorse` (deliverable-level chain) ·
EOT + Penalty resources · `/finances` portfolio aggregation · client queue/decisions
endpoints for the `/client/*` shell.
