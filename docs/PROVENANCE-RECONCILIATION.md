# PROVENANCE ⇄ EVIDENTIARY v2.1.0, Reconciliation Register

How the logic in [EVIDENTIARY-v2.1.0-LOGIC.md](EVIDENTIARY-v2.1.0-LOGIC.md) maps onto
the PROVENANCE build in this repository (MongoDB + Vite). Status as of the date of
this commit. "Partial" means the principle is live in code but narrower than the rule.

***

## 1. Status register

| # | v2.1.0 logic | Status in PROVENANCE | Where |
|---|---|---|---|
| 1 | Three domains as project properties, one project | ✅ Implemented | `stage_gates`/`project_domain_assignments`, Projects UI tabs |
| 2 | Domain applicability flag + N/A reason (audited) | ❌ Not yet, activity is currently inferred from assignment existence | backlog §4.1 |
| 3 | `ProjectDomainAssignment` with `domainRole: lead \| member` | ⚠️ Partial, leads only; member-scoped writes not modelled | backlog §4.2 |
| 4 | Strict scoping: no domain write without an assignment (PM included) | ⚠️ Partial, endorsement and finance endorsement are assignment/role-checked; document/task uploads are project-scoped, not yet domain-scoped | `projects.service.js`, backlog §4.2 |
| 5 | Endorsement ≠ approval; `canApproveDocuments` = ORG_ADMIN + CLIENT_APPROVER only | ✅ Implemented (this revision), PM's `approvals.client` removed; explicit test added | `lib/rbac.js`, `tests/unit.test.js` |
| 6 | Domain-gated three-step chain on stage gates | ✅ Implemented for stage gates (endorse per domain → PENDING_CLIENT → client approve) | `projects.service.js` |
| 7 | Three-step chain on **individual deliverables/documents/VOs/EOTs/Penalties** | ⚠️ Partial, certificates and VOs carry their own endorse→approve states; per-deliverable chain not yet modelled | backlog §4.3 |
| 8 | `domain: null` two-step pattern for administrative items | ⚠️ Partial, documents with no domain use a simple upload (no client step yet) | backlog §4.3 |
| 9 | Employer's Agent field + wording rules for exports | ❌ Not yet | backlog §4.4 |
| 10 | Finance as decoupled bounded context; stage engine never reads finance | ✅ Implemented (no finance→gate coupling exists at all) | `finance.routes.js`, schema |
| 11 | Domain tag on VOs, EOTs, Penalties; domain-checked endorsement routing | ⚠️ Partial, certificates have `domain`; **VOs don't yet**, and VO endorsement is capability-scoped but not domain-checked; EOT and Penalty models don't exist yet | backlog §4.5 |
| 12 | Fee tracking (invoiced/received/outstanding/balance) | ❌ Not yet, certified-value aggregates exist; client fee ledger doesn't | backlog §4.6 |
| 13 | Cert readiness checks (4 checks, override with reason, audited) | ❌ Not yet | backlog §4.6 |
| 14 | Append-only audit incl. **distinct admin-override entries** | ⚠️ Partial, append-only trail live; a dedicated override action type arrives with domain scoping (§4.2) | `lib/audit.js` |
| 15 | Single dashboard; Fees Outstanding sourced from ledger | ⚠️ Partial, one dashboard; fee KPIs pending item 12 | `dashboard.routes.js` |
| 16 | Client portal as separate shell (Queue / Decisions / Projects) | ⚠️ Partial, client roles get a scoped dashboard/projects/approvals surface and landing redirect is on the roadmap; not yet a separate `/client/*` shell | `AppShell.tsx`, backlog §4.7 |
| 17 | Reports removed as nav item; Finances screen added | ❌ Current build keeps a portfolio Reports screen (per the PROVENANCE rename-spec nav). v2.1.0's Finances screen supersedes it, decision logged, change queued | backlog §4.6 |
| 18 | Domain tabs in Project Detail with read-only `DomainScopeGuard` notice | ⚠️ Partial, Domains tab exists; per-domain work tabs + notice arrive with items 2, 3 | backlog §4.3 |
| 19 | Radius token scale (soft corners, no ad-hoc values) | ✅ Implemented, `--r-xl 20 / --r-lg 14 / --r-md 10 / --r-sm 8` (slightly softer than v2.1.0's 6/10/14 to match the Apple-materials direction; scale is still closed, no ad-hoc radii) | `styles/tokens.css` |
| 20 | Dark theme tokens, crosshatch, domain colours | ❌ Current build is light-theme only (paper/bone); dark tokens spec'd in the logic doc §11 | backlog §4.8 |
| 21 | DocumentViewer / SiteMediaViewer | ⚠️ Partial, authorised download route + browser-native viewing; pan/zoom/markup viewer not yet built | backlog §4.9 |
| 22 | Registration simplified (no org-type, no province; municipality stays a location field) | ✅ Implemented (single fixed org type; location field not yet added to projects, arrives with the Employer's Agent/setup pass) | `Register.tsx` |
| 23 | Government everything deleted | ✅ Implemented, no gov modules, fields, routes, or roles anywhere | repo-wide |

## 2. Lifecycle decision: five stages ⇄ the 11-stage ladder

The PROVENANCE rename-spec pins the 11-stage ladder; EVIDENTIARY v2.1.0 specifies five
ISO-style phases. **Decision: keep the 11-stage ladder as the atomic gate sequence, and
treat the five v2.1.0 stages as phase groupings over it.** Gates stay per-stage; domain
readiness rules from v2.1.0 §5 attach to the phase boundaries as below.

| v2.1.0 phase | PROVENANCE stages (1, 11) | Domain readiness rule attached |
|---|---|---|
| Initiation (sub-consultant procurement trail) | 1 Multi-Year Planning · 2 Inception | PS + Geotech (if applicable) procurement/appointment complete |
| Project Planning | 3 Feasibility & Concept · 4 Preliminary Design · 5 Detailed Design | PS planning deliverables approved; geotech investigation approved (if applicable) |
| Project Execution (site handover) | 6 Procurement & Tender · 7 Construction (start) | CM Site Handover bundle approved |
| Monitoring & Control | 7 Construction (cycles) · 8 Handover · 9 Close-Out | All three domains concurrently; monthly cert/report cycles |
| Project Closure | 9 Close-Out · 10 Defects Liability · 11 Complete | CM close-out + Final Account (the single finance→gate exception); PS/Geotech close-out reports where applicable |

If product later prefers the literal five-stage ladder, it is a renumbering of
`stage_gates` + `STAGES` constant, the gate mechanics don't change.

## 3. Changes made in this revision (traceability)

1. **PM approval capability removed** (logic §1 / SPEC §5.2): `approvals.client`
   stripped from PM in `backend/src/lib/rbac.js` and the frontend mirror
   (`AuthContext.tsx`); regression test added asserting the full
   endorsement-vs-approval matrix (logic §15.2).
2. **`requireCapability` middleware actually enforces now**, it had been reverted to a
   no-op by an editing accident; restored to a real RBAC check (found by the new ESLint
   gate, which is part of why the standards require lint in CI).
3. Hook-order violation in `AppShell.tsx` fixed (conditional `useQuery`).
4. Final-scan fixes (see [`VERIFICATION.md`](VERIFICATION.md)): upload-type filter no
   longer crashes the process (factory called without `new`); document download uses an
   absolute path (`sendFile` requirement), traversal guard retained.

## 4. Delta backlog (priority order)

### 4.1 Domain applicability (quick, unlocks tabs & guards)
* `projects` → new table `project_domains (project_id, domain, applicable, not_applicable_reason, set_by, set_at)`.
* Project create/update: N/A requires reason; audit `domain.applicability_set`.
* Detail API + UI: tabs and readiness render only applicable domains.

### 4.2 `domainRole: lead|member` + strict domain writes
* Add `role` to `project_domain_assignments`; members upload, leads endorse.
* Domain-check document/task writes against assignments; **PM included** (needs own
  assignment); `ORG_ADMIN` override allowed with a **distinct `admin.override` audit
  action**; `DomainScopeGuard` read-only notice in the UI.

### 4.3 Deliverable-level three-step chain
* Deliverables/documents as first-class records with `status: pending_domain_endorsement
  → pending_client_approval → approved/rejected`, `domain` tag (`null` = two-step),
  endorsement + approval fields; UI `DomainEndorsementDrawer` + domain work tabs.

### 4.4 Employer's Agent
* `projects.employers_agent` (text, role-linked later); render beside ref code; wording
  rules in any generated/exported certificate (client sign-off = internal governance).

### 4.5 EOT + Penalty models; domain tag on VOs
* `extensions_of_time`, `penalties` tables mirroring the VO shape + `domain` column on
  all three; endorsement routed by domain (same rule as certificates); contract
  adjustment history from approved VOs/EOTs.

### 4.6 Finances screen + fee tracking + readiness checks
* Portfolio `Finances` (Overview / Payment Certificates / VOs & EOTs / Fee Tracker);
  fee ledger (invoiced/received/outstanding per client); cert readiness panel with
  audited overrides; dashboard Fees Outstanding switches to the ledger source; retire
  the standalone Reports route per v2.1.0 §3.1.

### 4.7 Client portal shell
* `/client/*` feature module: Queue (landing), Decisions, Projects; `ClientPortalGuard`
  redirect at login; inline approve/reject from the queue.

### 4.8 Dark theme + domain colours
* Token sets for both themes, crosshatch canvas, `--domain-*` colours, `DomainBadge`
  (text + colour, never colour alone), theme toggle persisted per user.

### 4.9 Viewers
* `SiteMediaViewer` (pan/zoom, billing-period comparison, GPS overlay, plan pins);
  `DocumentViewer` wrapper for in-browser PDFs.

## 5. Deliberate deviations (and why)

| Deviation | Reason |
|---|---|
| 11-stage ladder retained (vs. five phases) | Pinned by the PROVENANCE system spec §2.2; mapped as phases in §2 above |
| Radius scale 8/10/14/20 vs. v2.1.0's 6/10/14 | One step softer to match the Apple-materials direction the build follows; still a closed token scale |
| Tech stack: plain CSS token system instead of Tailwind/Zustand/Recharts/dnd-kit | Leaner dependency surface per the security standards; token-per-component parity with the v2.1.0 component spec is kept in CSS custom properties; the logic itself (optimistic board, server-enforced guards) is unchanged |
| No `/client` subdomain decision taken | Open item 5, routed through the same origin until product decides |
