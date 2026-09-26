# EVIDENTIARY v2.1.0, The New Logic, Carried Into PROVENANCE

> **Source of truth:** `EVIDENTIARY_v2.1.0_SPEC.md` (backend/architecture) and
> `EVIDENTIARY_v2.1.0_Frontend.md` (UI requirements), both v2.1.0, Kyvrex (Pty) Ltd.
> This document restates every operative rule from those two files in its
> private-firm-only form, as adopted by the PROVENANCE build. For what is
> implemented today vs. pending, see **[PROVENANCE-RECONCILIATION.md](../PROVENANCE-RECONCILIATION.md)**.
>
> Everything government-tenant from earlier versions is **deleted, not archived**
> (v2.1.0 §0.1): Multi-Year Plan module, IDP export, Normal Services, Departments,
> grants/MTEF labels, `/gov/*` routes, `GovProjectService`, `PMU_OFFICER`,
> `provincial_gov` org type, province/municipality org fields, OrgTypeGuard.

***

## 1. The core governance rule

**The Org Admin runs the system. The consultant uploads. The linked client approves.**

Refined in v2.1.0 into two separate, non-interchangeable authorities:

| Authority | Who holds it | What it means |
|---|---|---|
| **Endorsement** | Domain Leads (per domain) | A *technical* sign-off that a submission is correct. Never sets status to `approved`. |
| **Approval** | `CLIENT_APPROVER` (+ `ORG_ADMIN` for administration) | The client's authority to accept. Held via `canApproveDocuments`. |

`canApproveDocuments = true` **only** for `ORG_ADMIN` and `CLIENT_APPROVER`, including
Domain Leads and PMs (SPEC §5.2). Collapsing endorsement into approval "would quietly
undo the consultant-uploads-client-approves governance rule this whole platform exists
to enforce." This separation is enforced server-side and **must be covered by an
explicit automated test** (SPEC §11), not just by route naming.

**Contractual framing (SPEC §4.6, important):** under GCC 2015 / JBCC, the party who
certifies payment, values VOs, and determines EOTs is the **Employer's Agent**, usually
the consulting engineer's own firm, not the client. `CLIENT_APPROVER`'s in-app sign-off
is an **internal client governance layer**, not the contractual certification act.
Consequences:

* Every project record carries an explicit **Employer's Agent** field (metadata held,
  displayed near the ref code in the UI, never inferred).
* Generated/exported certificates and records must word `CLIENT_APPROVER` sign-off as
  the client's internal governance approval, never as the legally operative certification.
* This is a framing/documentation constraint, not a workflow change, who clicks what
  does not change.

***

## 2. The three project domains

Domains are **properties of one project's detail**, never project types. A single
project can involve all three at overlapping times (SPEC §4.1, 4.2).

| Domain | Covers | Typical window | Lead role |
|---|---|---|---|
| Professional Services | Scoping, preliminary & detailed design, non-site sub-consultant appointments, professional fee tracking | Stages 1, 2, oversight through 4 | `PROFESSIONAL_SERVICES_LEAD` |
| Geotechnical | Ground investigation, geotech reporting, geotech deliverables & appointments | Primarily stage 2; can resurface in 4 | `GEOTECHNICAL_LEAD` |
| Construction Management | Site handover, monthly reporting, payment-certificate readiness (site side), site evidence, snag lists, close-out | Stages 3, 5 | `CONSTRUCTION_MANAGER` |

**Applicability:** a project does not have to use all three. Each domain carries an
explicit `applicable | not_applicable` state, set by the PM at project setup, with a
**required written reason** when N/A, audited like any other decision. An N/A domain
disappears from that project's working view (and its UI tabs) but is never deleted from
the platform model. Construction Management N/A is technically possible but discouraged
(edge case: pure feasibility study).

***

## 3. Strict domain scoping, `ProjectDomainAssignment`

Every person working on a project accesses a domain through an explicit assignment
record, never through their overall role:

```
ProjectDomainAssignment {
  projectId, userId,
  domain: "professional_services" | "geotechnical" | "construction_management",
  domainRole: "lead" | "member",
  grantedBy, createdAt
}
```

Rules (SPEC §4.4):

1. **Writes check the assignment table**, not "is this person a PM/Member on the project."
2. A Geotechnical Member cannot upload a Construction Management deliverable, even
   though both are "on the project."
3. **The PM does not get implicit write access into a domain's technical content.**
   If the PM wants to upload into the Geotechnical domain, they need their own
   `ProjectDomainAssignment` for it. (PM retains project-wide *visibility*, domain
   assignment management, and stage advancement.)
4. `ORG_ADMIN` bypasses domain scoping for administration (reassignment, audit,
   dispute resolution), but every bypass is **logged distinctly as an admin override**,
   never folded into normal domain-action audit entries (SPEC §11).
5. In the UI, a user without an assignment for a domain tab sees a **read-only notice
   explaining why** ("You don't have access to upload or endorse in this domain,
   contact your PM"), content is never silently hidden and never 404s. *Visibility of
   the boundary is the point* (Frontend §6.1).

***

## 4. The domain-gated three-step approval chain

Generalises the removed `PMU_OFFICER` pattern (SPEC §4.5). Applies to **anything tagged
to a domain**: deliverables, documents, VOs, EOTs, Penalties.

| Step | Actor | Action |
|---|---|---|
| 1 | Domain Member (or Domain Lead, or an assigned PM) | Uploads the item, **tagged to a domain**. Status: pending domain endorsement. |
| 2 | The **Domain Lead owning that domain** | Endorses or sends back, *before the client ever sees it*. Status: pending client approval. |
| 3 | `CLIENT_APPROVER` | Approves/rejects with reason, seeing both the item and its endorsement. |

* Which lead reviews is determined **solely by the item's `domain` tag**, a design-change
  VO routes to the Professional Services Lead; a site-originated VO to the Construction
  Manager.
* Items with `domain: null` (genuinely non-technical administrative correspondence) skip
  step 2 and use the plain two-step PM→Client pattern. This is a per-document-category
  decision, to be finalised against the real deliverable list.
* **Open research flag (SPEC §13.1):** decide whether any item can span two domains
  (dual endorsement vs. single primary-domain tag) before implementing, do not leave
  it to whoever builds it first.

***

## 5. Lifecycle, stages, and gates

v2.1.0 defines a **five-stage lifecycle**: Initiation (sub-consultant procurement trail),
Project Planning, Project Execution (site handover), Monitoring & Control, Project
Closure. Gate conditions per stage are unchanged in mechanism; gates now evaluate
**per-domain readiness where the domain is applicable** (SPEC §4.3):

* **Stage 1→2:** Professional Services + Geotechnical (if applicable) procurement /
  appointment steps complete, per domain.
* **Stage 2→3:** PS planning deliverables approved; geotech investigation deliverables
  approved (if applicable).
* **Stage 3→4:** Construction Management's Site Handover bundle approved.
* **Stage 4:** all three domains may run concurrently (design amendments, site queries,
  the four monthly cycles).
* **Stage 5:** primarily Construction Management (close-out reports, Final Account,
  completion certificates); PS and Geotech contribute their own close-out reports where
  applicable, the old Principal Agent / Safety / EIA reports now map onto domain
  ownership.

> **PROVENANCE mapping:** the PROVENANCE rename-spec pins an **11-stage ladder**
> (Multi-Year Planning → Complete). The reconciliation doc maps the five v2.1.0 stages
> onto that ladder as phase groupings rather than replacing it. See
> [PROVENANCE-RECONCILIATION.md §2](../PROVENANCE-RECONCILIATION.md).

Supporting mechanics that ride on the lifecycle:

* **Procurement trail**, 5-step sub-consultant appointment trail per appointment,
  rendered per domain (Professional Services and Geotechnical tabs).
* **Site handover bundle**, the Stage 3→4 gate artefact, owned by Construction Management.
* **Monthly cycles in Monitoring & Control**, reporting, payment-certificate readiness,
  site evidence, all Construction Management territory.

***

## 6. Finance, a fully decoupled bounded context

`FinanceLedger` is its own bounded context (contract value, adjustments, payment
certificates, fees invoiced/received/outstanding, penalties, Final Account):

1. It **reads** project/domain state to run readiness checks, but is **never read by
   the stage engine** to decide whether work can proceed, with **one named exception**:
   Stage 5's Final Account gate check (SPEC §6).
2. **VOs, EOTs, and Penalties carry a `domain` tag** in addition to their ledger fields,
   so step 2 of the chain routes to the correct Domain Lead automatically. This is
   metadata on finance records, not a change to the finance/project boundary.
3. **Private-firm fee tracking** (Fees Invoiced / Received / Outstanding / Balance
   Remaining) lives in the ledger, surfaced as a KPI strip at the top of Finance views.
4. **Payment certificates** run a 4-point **readiness check panel** (pass/fail/**override
   with written reason**, overrides are audited).
5. **Final Account** appears once Stage 5 begins; read-only once approved; it is the one
   point where finance and the stage gate are aware of each other (the named exception).
6. **Adjustment history**: contract value changes are traceable as each VO's before/after.

***

## 7. Dashboard & navigation (single org type)

* **One dashboard** (SPEC §7): Portfolio KPI cards (Active Projects / Total Contract
  Value / **Fees Outstanding, sourced from FinanceLedger, not Project** / Pending
  Client Actions), Client Portfolio Table, Projects by Stage, Projects **by Domain**
  (three counts of active assignments), Pending Approvals + Upcoming Events.
* **Reports is removed as a nav item** (Frontend §3.1). Its content is relocated, not
  deleted: fee summary + payment forecast → the new **Finances** screen
  (`/:tenantSlug/finances`, ORG_ADMIN + PM; Domain Leads see only domain-tagged items);
  project-status content → filter/export on the Projects table.
* **Sidebar:** Dashboard, Projects, Clients, **Finances**, Kanban, Calendar, Settings
  (ORG_ADMIN only), Profile.

## 8. Client Portal, a separate shell

`CLIENT_APPROVER`, `CLIENT_TEMP` (+ `VIEWER`) land in a **purpose-built shell at
`/client/*`**, never a role-guarded copy of the operator UI (Frontend §3.3, S-09, S-11):

| Route | Purpose |
|---|---|
| `/client/queue` (default landing) | Every item awaiting this client's decision, across all linked projects, oldest first, with inline Approve/Reject where review is simple. Empty state: "You're all caught up." |
| `/client/decisions` | Plain-language history of everything this client approved/rejected, with reasons and dates. |
| `/client/projects` | Read-scoped list of linked projects → read-only Project Detail (Overview + the domain/Finance tabs relevant to them). |

`ClientPortalGuard` redirects client roles here at login and blocks operator routes
entirely. Same Atlas Sahara tokens and rounded treatment, a different, purpose-built
product, not a lesser one.

***

## 9. Project Detail, tab structure (Frontend §S-07)

Persistent `ProjectHeader`: name, ref code, **Employer's Agent label**, stage progress,
metric pills, RAG dots.

Tabs: **Overview** (demoted stage panel: gate status "X of Y complete", per-domain
readiness cards that jump to their tabs) · **Professional Services** · **Geotechnical** ·
**Construction Management** (site evidence gallery, Gantt, snag lists) · **Finance**
(the decoupled ledger view) · **Documents** (all document-type files, filterable by
domain) · **Audit Trail** (reverse-chronological, filterable, exportable).

N/A domains render **no tab at all**. Domain tabs contain: ProcurementTrailCards (where
relevant), DeliverableCards with `DomainBadge`, and the domain team roster with Manage
Assignments for PM/Org Admin.

## 10. Viewers

* **DocumentViewer**, plain PDF/document viewing (open, scroll, download). Deliberately
  unremarkable.
* **SiteMediaViewer**, image/video/**plan** files: pan & zoom, **billing-period
  comparison** (slider or side-by-side vs. a prior month from the same GPS tag), GPS +
  capture-date overlay, **pin/markup mode on plans**, chronological scrub across billing
  periods (never a flat version list). Home: Construction Management tab's site evidence.

## 11. Design system deltas (Atlas Sahara, refined)

* **Corners:** `border-radius: 0` is retired. Radius tokens only, no ad-hoc values:
  `--radius-sm` 6px (buttons/inputs/badges) · `--radius-md` 10px (cards/panels/tables) ·
  `--radius-lg` 14px (modals/drawers) · `--radius-full` 9999px (status pills, avatars).
* **Dark theme tokens** (in addition to light): `--bg-primary #080808` with 20%-opacity
  diagonal crosshatch, `--bg-card #181818`, brand gold `--accent #C9A961` (8.9:1 on
  #080808), teal `--teal-accent #2DD4BF` for data/links/focus rings, status colours
  (`#4ADE80` active, `#FACC15` review, `#60A5FA` planning, `#A78BFA` done, `#F87171`
  danger), and **domain colours**: professional `#60A5FA` (blue), geotechnical
  `#D97757` (clay), construction `#4ADE80` (green), used only in `DomainBadge` + small
  accents, always with the domain name as text (never colour alone).
* Gold is never a large background fill. Status colours live only inside badges.
* Typography unchanged: Cormorant Garamond display/currency, Montserrat UI chrome,
  DM Mono for GPS/ref codes/contract values/countdowns.
* Buttons: fill-slide hover + subtle shadow lift; radius transitions together with
  shadow at the same 0.5s ease. Tabs keep the 2px gold underline (not pills).
* `prefers-reduced-motion` disables all CSS transitions/animations. Focus ring:
  2px solid teal, 3px offset.
* Hover lift on cards is one step more pronounced than v4.0, where the "take it up a
  level" feedback should read most clearly.

## 12. Registration simplification

Org-type selector is **removed** (one org type). Province field dropped (was gov-only).
`Local Municipality` **stays** as a general SA location field for site addresses, it is
a location concept, not a government-org-type concept.

## 13. Guards (frontend)

`AuthGuard`, `TenantGuard`, `RoleGuard`, `ProjectScopeGuard`, `SuperAdminGuard` unchanged.
`OrgTypeGuard` **removed**. New:

* **`DomainScopeGuard`**, checks `ProjectDomainAssignment` for the current
  project/domain; renders the read-only notice on failure, never silent unmount.
* **`ClientPortalGuard`**, client roles are redirected to `/client/*` and cannot reach
  operator routes at all.

## 14. Security rules carried forward (Frontend §9)

JWT in memory only (no localStorage), no `dangerouslySetInnerHTML`,
`canApproveDocuments` UI checks always backed by server enforcement, `data-testid`
stripped in production builds, **plus**: the UI must never render a Domain Lead's
endorsement action as if it were the client's approval (frontend echo of SPEC §11).

## 15. Testing requirements (SPEC §11, Frontend §8)

Backend (non-negotiable, automated):

1. **Domain-scope regression suite**: a Member/Lead/PM **without** an assignment for a
   domain cannot write into it, explicitly including the PM-without-assignment case,
   the one most likely to be quietly bypassed "because they're the PM."
2. **Endorsement ≠ approval**: a Domain Lead's endorsement action can never set a
   document's status to `approved`, only `CLIENT_APPROVER`/`ORG_ADMIN` actions can.
3. **Admin override distinct logging**: an `ORG_ADMIN` domain bypass is logged as an
   override entry, distinguishable from an assigned lead's action.

Frontend integration tests (Vitest + Testing Library + MSW + axe): only applicable
domain tabs render; DomainScopeGuard shows the notice; `domain: null` skips the
endorsement drawer; Dashboard's Fees Outstanding comes from a FinanceLedger fixture
(keeps the architecture boundary honest in code); no gov fields render anywhere.

E2E journeys: firm journey (create client → project with domain applicability → assign
leads → issue client login → item appears in client queue); **domain-gated deliverable**
(member uploads in assigned domain; upload attempt in unassigned domain shows the notice,
not a crash; lead endorses; client approves); payment certificate + override; client
portal full flow (lands on Queue, approves, sees it in Decisions, views project
read-only). The government-journey E2E is deleted.

## 16. Open items inherited from v2.1.0

| # | Item | Blocking? |
|---|---|---|
| 1 | Single-domain vs. dual-domain tagging for deliverables/VOs/EOTs/Penalties | YES |
| 2 | Default domain-lead assignment for new projects (PM auto-assigned vs. starts with none) | YES |
| 3 | Confirm who is actually named Employer's Agent on real contracts | Before first client onboarding |
| 4 | Security review pass before any client-facing pilot | YES |
| 5 | Client portal path strategy (`/client/*` vs. subdomain) | YES (early) |
| 6 | File storage presigned-URL format | YES |
