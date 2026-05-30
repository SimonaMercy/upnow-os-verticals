# UpNow Frontend — Sprint Backlog

Tracker of record: Jira `SCRUM` project at `upnow-team.atlassian.net`. This file is the **agent-facing index** so any AI agent (or human) can immediately see what's next without leaving the repo.

## Status legend

| Symbol | Meaning |
|---|---|
| 🟢 Done | Merged, build passes, in `main` |
| 🟡 In Progress | Branch open, work underway |
| 🔵 Ready | Spec finalized, unblocked, AI/human can start now |
| ⚪ Blocked | Waiting on another ticket / decision |
| 🔴 Issue | Bug or rework needed |

---

## Sprint 1 — Auth & Identity (May 5–11, 6 working days)

Goal: registration, login, OTP, password reset, KYC upload UI; admin invite acceptance page.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| � | SCRUM-101 | `app/login` | Login form (RHF + Zod) · `d6905c8` |
| 🟢 | SCRUM-102 | `app/register/customer`, `app/register/rental-provider`, `app/register/service-provider` | Registration forms · `d6905c8` |
| 🟢 | SCRUM-103 | `app/verify`, `app/verify-email` | OTP verification + email confirm landing · `d6905c8` |
| 🟢 | SCRUM-104 | `app/forgot-password` | OTP-based password reset flow · `d6905c8` |
| 🟢 | SCRUM-105 | `app/invite/[token]` | Manager/technician invite acceptance · `d6905c8` |
| 🔵 | SCRUM-1xx | `app/dashboard/profile/kyc` | KYC document upload (presigned URL flow) — page missing |

SRS: [docs/sprint-01-srs.html](../docs/sprint-01-srs.html)

---

## Sprint 2 — Rental Provider & Properties (May 12–21, 9 working days)

Goal: RP onboarding wizard, property listing wizard, public property browse.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| � | SCRUM-201 | `app/rental-provider/dashboard/onboarding` | RP onboarding wizard · `d6905c8` |
| 🟢 | SCRUM-202 | `app/rental-provider/dashboard/portfolio`, `units`, `documents` | Property portfolio + units list · `d6905c8` |
| 🟢 | SCRUM-203 | `app/rental-provider/dashboard` | RP dashboard (overview, leads, contracts, team) · `d6905c8` |
| 🟢 | SCRUM-204 | `app/listings`, `app/listings/units/[id]` | Public browse + unit detail + inquire CTA · `d6905c8` || 🟢 | CID-201-FE | `app/rental-provider/dashboard/contracts/[id]` | **RP contract timeline**: Clean 6-step timeline (Contract Issued → Payment Collection → Signatures → Ejari → Move-In & DEWA → Active Tenancy). `viewing` field removed from `ContractDetail` interface. Renewal branch unchanged (4 steps). || 🔵 | SCRUM-2xx | `app/rental-provider/dashboard/portfolio/new` | Property listing wizard (multi-step) |

SRS: [docs/sprint-02-srs.html](../docs/sprint-02-srs.html)

---

## Sprint 3 — Services Marketplace, Maintenance & Disputes (May 23–Jun 4, 9 working days)

Goal: customer books service, escrow paid upfront, tracks technician, signs off; SP/tech dashboards; dispute UI.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| � | SCRUM-301 | `app/services` | Service category browse · `d6905c8` |
| 🟢 | SCRUM-302 | `app/dashboard/(dashboard)/service-provider` | SP dashboard (onboarding, profile, team, documents) · `d6905c8` |
| 🟢 | SCRUM-303 | `app/dashboard/(dashboard)/technician` | Technician dashboard stub · `d6905c8` |
| 🔵 | SCRUM-3xx | `app/services/[slug]/book` | Booking flow with escrow payment upfront |
| 🔵 | SCRUM-3xx | `app/dashboard/customer/bookings/[id]` | Live booking tracker (status lifecycle) |
| 🔵 | SCRUM-3xx | `app/dashboard/customer/maintenance/new` | Maintenance request form |
| 🔵 | SCRUM-3xx | `app/dashboard/*/disputes/[id]` | Dispute detail + evidence upload |

SRS: [docs/sprint-03-srs.html](../docs/sprint-03-srs.html)

> 🚫 UAE Holiday Blackout: May 26–29 (no work)

---

## Sprint 4 — Tenancy Lifecycle (Jun 6–15, 9 working days)

Goal: lead pipeline, in-portal offer, contract sign, move-in inspection, renewals.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| � | SCRUM-401 | `app/rental-provider/dashboard/leads` | Leads kanban (RP-side) · `d6905c8` |
| 🟢 | SCRUM-402 | `app/rental-provider/dashboard/contracts/new`, `contracts/[id]`, `contracts/[id]/print` | Tenancy contract wizard + detail + print · `d6905c8` |
| 🟢 | SCRUM-403 | `app/dashboard/(dashboard)/customer/contracts`, `customer/contracts/[id]` | Customer contract list + e-sign view · `d6905c8` |
| 🟢 | CID-326-FE | `app/dashboard/(dashboard)/customer/contracts/[id]` | **Documents tab removed from contract detail page** — tab bar entry, drawer, sidebar nav entry, all upload state/functions, `Paperclip`/`UploadCloud`/`ExternalLink` imports all deleted. Document management is now solely in the My Spaces `RentalDocumentsCard`. No TS errors. |
| 🟢 | CID-327-FE | `app/dashboard/(dashboard)/customer/spaces/page.tsx` — `RentalDocumentsCard` | **Document UX overhaul**: (1) Priority sorting — rejected first, then required missing, landlord-requested, optional unuploaded, pending review, approved. (2) Distinct icons per state: `AlertTriangle` (rejected), `UploadCloud` (needs upload), `Clock` (pending review), `CheckCircle2` (approved). (3) Left-border color accents by state. (4) Summary banner naming missing/rejected docs. (5) Header counter: `X/Y uploaded` (amber) → `All required ✓` (green). (6) **Free-form "Attach additional document"** inline form at card bottom — tenant can upload any extra document with a custom name via the same presigned-URL flow. |
| 🟢 | SCRUM-404 | `app/dashboard/(dashboard)/customer/spaces`, `customer/viewings` | Customer spaces + viewing calendar · `d6905c8` |
| 🔵 | SCRUM-4xx | `app/rental-provider/dashboard/leads/[id]/offer` | Send offer directly from portal |
| 🔵 | SCRUM-4xx | `app/rental-provider/dashboard/move-in/[id]` | Move-in inspection checklist + photo capture |
| 🔵 | SCRUM-4xx | `app/rental-provider/dashboard/renewals` | Renewal pipeline (90/60/30-day reminders) |
| 🔴 | GAP-G6 | `app/dashboard/customer/contracts/[id]` | Tenant e-sign canvas has no typed-name fallback — blocks automated testing |
| 🔴 | GAP-G9 | `app/rental-provider/dashboard/contracts/[id]` | RP "Activate tenancy" button missing from contract detail page |
| 🟢 | CID-328-FE | `app/dashboard/(dashboard)/customer/documents`, `customer/spaces/{,v2/[spaceKey]}/page.tsx` | **Unified Document Hub — DONE + rolled back to hybrid**: Document Hub page built with KYC + rental sections + free-form uploads. `TenancyJourneyPanel` Step 3 originally became a deep-link; per product feedback the **inline preferences + docs form was restored** in both v1 and v2, with the Hub kept as a secondary "Manage KYC & other documents" link for ad-hoc uploads. |
| 🟢 | TENANT-V2 | `app/dashboard/(dashboard)/customer/spaces/v2/[spaceKey]` | **Customer Spaces v2 (Quest layout)**: New focused tenancy-life-cycle page. 25-state machine in `deriveStateKey`. Dual QuestActionCard for renewal-in-flight. Inline preferences/docs in `DocumentsAction`. Renewal terms display with comparison vs. current rent. Coexists with v1. |
| 🟢 | OCCUPANTS-FE | `src/lib/docRequirements.ts`, both spaces pages | **Number of Occupants stepper + per-occupant identity docs**: New helpers `getOccupantDocs(n)` and `deriveOccupantCount(keys)`. Occupant 1 reuses existing keys; occupant N≥2 uses `occupant_${N}_emirates_id|passport|uae_visa`. Count derived from uploaded doc keys (no DB column added). |
| 🟢 | ADDENDUM-FE | `src/components/upnow/AddendumsPanel.tsx`, `rental-provider/dashboard/templates`, both contracts/[id]{,/print} pages | **Addendum templates + per-contract addendums**: Reusable `AddendumsPanel` (landlord attach/remove/sign + tenant sign with canvas pad). RP template library CRUD page. Print pages append A4 coversheet per addendum. Locked to `ContractStatus.PENDING` for mutations. |
| 🟢 | PROFILE-OTP-FE | `app/dashboard/(dashboard)/customer/profile/page.tsx` | **Email + phone change with OTP**: `EmailField` / `PhoneField` components with dev-mode OTP banner + Auto-fill. Detects auto-generated `phone-...@upnow.local` emails and prompts replacement. Main form no longer touches `email` / `phone`. |
| 🟢 | UNIT-DESC-AUTOGEN | `src/components/upnow/UnitFormModal.tsx` | **Auto-generate Unit Description**: `composeUnitDescription` builds a 3-sentence description from selected unit type, tier, beds/baths, floor, size, view, furnishing, top 6 amenities. Button is disabled until unit type is selected. |
| 🟢 | COPY-CUSTOMER | 27 files across `src/app`, `src/components`, `src/data` | **"Tenant" → "Customer" UI text rename** (`05d6c13`): UI strings only — JSX text, tab/menu labels, toast/error copy. Code identifiers, API URLs, route paths, TypeORM bindings preserved. Legal labels in print/inspection pages and contract-signing banners kept as "Tenant". See AGENTS.md §"Session May 30, 2026" for the preserve-list. |

SRS: [docs/sprint-04-srs.html](../docs/sprint-04-srs.html)

---

## Sprint 5 — Admin Intelligence (Jun 16–23, 7 working days)

Goal: admin dashboards, fee config UI, reports, bulk ops.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| 🔵 | SCRUM-5xx | `app/v2/dashboard/admin` | Admin home (KPIs, queues) |
| 🔵 | SCRUM-5xx | `app/v2/dashboard/admin/users` | User management + bulk suspend/export |
| 🔵 | SCRUM-5xx | `app/v2/dashboard/admin/fees` | Fee configuration UI |
| 🔵 | SCRUM-5xx | `app/v2/dashboard/admin/reports` | Reports (revenue, completion rate, dispute rate) |
| 🔵 | SCRUM-5xx | `app/v2/dashboard/admin/disputes` | Dispute mediation queue |

SRS: [docs/sprint-05-srs.html](../docs/sprint-05-srs.html)

---

## Sprint 6 — Notifications (Jun 24–Jul 2, 8 working days)

Goal: in-app notification center, preference settings, push opt-in.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| 🔵 | SCRUM-6xx | `components/upnow/NotificationBell` | In-app notification dropdown |
| 🔵 | SCRUM-6xx | `app/v2/dashboard/notifications` | Notification inbox |
| 🔵 | SCRUM-6xx | `app/v2/dashboard/settings/notifications` | Channel preferences (email/SMS/push) |
| 🔵 | SCRUM-6xx | `lib/push.ts` | FCM web push opt-in + device token registration |

SRS: [docs/sprint-07-srs.html](../docs/sprint-07-srs.html)

---

## Sprint 7 — Polish & Launch (Jul 4–9, 6 working days)

Goal: a11y pass, perf, SEO, error/empty/loading states, prep prod deploy.

| Status | Ticket | Surface | Summary |
|---|---|---|---|
| 🔵 | SCRUM-7xx | all | Bug bash from prior sprints |
| 🔵 | SCRUM-7xx | all | Loading + error + empty states for every async surface |
| 🔵 | SCRUM-7xx | all | Lighthouse ≥ 90 on key public pages |
| 🔵 | SCRUM-7xx | all | a11y audit (axe) — no serious violations |
| 🔵 | SCRUM-7xx | all | OG/SEO meta + sitemap |

SRS: [docs/sprint-08-srs.html](../docs/sprint-08-srs.html)

> Project close: **Jul 9** · Grace period: Jul 11–16 (6 working days)

---

## Updating this file

When you complete a task:

```
| 🟢 | SCRUM-XXX | `app/v2/services/[slug]/book` | Booking flow · `<commit-sha>` |
```

When you start work, set status `🟡 In Progress` and add your branch name. When blocked, switch to `⚪ Blocked` with the reason.
