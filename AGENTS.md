<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# UpNow Frontend — Agent Guide

> Read this whole file before editing. It tells you what the project is, where things live, and how to pick up the next task.

## Project

UpNow is a UAE dual marketplace: long-term **rentals** + on-demand **home services**. This repo is the web client.

- **Stack**: Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4 · TanStack Query · React Hook Form + Zod
- **Backend repo**: `../upnow-backend` (NestJS API · Swagger at `/api/docs`)
- **Tracker**: Jira `SCRUM` project at `upnow-team.atlassian.net` (293 tasks across S1–S7)
- **Delivery window**: May 5 – Jul 9, 2026 · 7 sprints · 54 working days
- **Reference docs**: `../docs/sprint-0X-srs.html`, `../Mockups/`, `../ERD/`

## Conventions (non-negotiable)

1. **App Router only** (`src/app/`). Server Components by default; mark `"use client"` only when needed (state, effects, browser APIs).
2. **Forms**: `react-hook-form` + `@hookform/resolvers/zod`. Schemas live next to the form in `_schema.ts`.
3. **Server data**: TanStack Query for client fetching/caching. Server Components fetch directly via `fetch()` with `next: { revalidate }`.
4. **Validation**: Reuse Zod schemas on server actions / route handlers.
5. **Styling**: Tailwind v4 utility-first. Reusable primitives in `src/components/ui/`. Use `clsx` + `tailwind-merge` (`cn()` helper in `src/lib/utils.ts`).
6. **Icons**: `lucide-react` only.
7. **Money in fils** (integer). Format via `Intl.NumberFormat('en-AE', { style: 'currency', currency: 'AED' })`.
8. **Dates**: `date-fns`. UAE timezone `Asia/Dubai`.
9. **No client-side secrets.** Anything sensitive must be in a route handler / server action.

## Folder map (`src/`)

```
src/
├── app/
│   ├── api/[...path]/route.ts      # Catch-all proxy → NestJS backend (adds httpOnly cookie)
│   ├── api/maps/key/route.ts       # Serves Google Maps key to client (never expose in env)
│   ├── dashboard/(dashboard)/      # Shared DashboardShell layout (auth guard inside shell)
│   │   ├── layout.tsx              # Wraps DashboardShell — one layout for all roles below
│   │   ├── admin/                  # Admin + super_admin surfaces
│   │   ├── customer/               # Customer surfaces
│   │   ├── manager/                # Asset manager surfaces
│   │   ├── service-provider/       # Service provider surfaces
│   │   └── technician/             # Technician surfaces
│   ├── rental-provider/dashboard/  # RP dashboard (separate layout — own sidebar)
│   ├── listings/                   # Public listing browse + unit detail pages
│   ├── services/                   # Public home-services browse
│   ├── register/                   # Role-split registration (customer / rp / sp)
│   ├── login/                      # OTP login (2-step: email → code)
│   ├── verify/ + verify-email/     # OTP verification pages
│   ├── forgot-password/
│   ├── invite/[token]/             # Accept manager/technician invite
│   ├── guide/                      # Internal onboarding guide viewer
│   ├── docs/                       # Embedded API docs viewer (pulls from Swagger)
│   ├── not-found.tsx
│   └── page.tsx                    # Landing page — HomeRedirect island + marketing sections
├── components/
│   ├── ui/                         # Primitives: Button, Input, Badge, Toast, SkeletonLoader,
│   │                               #   StatusPill, EmptyState, CanAccess
│   ├── dashboard/                  # Shell + widget building blocks
│   │   ├── DashboardShell.tsx      # Sidebar (collapsible) + topbar + auth guard
│   │   ├── DashboardShell.module.css
│   │   ├── DashboardWidgets.tsx    # DashboardPage, StatCard, QuickAction, SectionHeader, etc.
│   │   ├── KycDocumentsPanel.tsx   # Document checklist panel (used in RP/SP detail pages)
│   │   ├── ProfileCompletionBanner.tsx
│   │   ├── RpOnboardingGate.tsx    # Redirects RP to /onboarding if profile incomplete
│   │   ├── ComingSoon.tsx          # Placeholder for unbuilt pages
│   │   └── DashboardWidgets.tsx
│   ├── upnow/                      # Brand components
│   │   ├── PropertyFormModal.tsx   # Add/edit property modal (used in RP portfolio)
│   │   ├── UnitFormModal.tsx       # Add/edit unit modal
│   │   ├── AddListingWizard.tsx    # Multi-step wizard to add a new listing
│   │   ├── MapPicker.tsx           # Google Maps lat/lng picker (uses GOOGLE_MAPS_KEY)
│   │   ├── Navbar.tsx              # Public marketing navbar
│   │   ├── FeaturedListings.tsx    # Landing page featured listings carousel
│   │   └── … (HeroSection, Footer, HowItWorks, TrustSignals, etc.)
│   ├── auth/                       # AuthShell, RegisterForm, OAuthButtons
│   ├── landing/                    # Landing page section components
│   ├── docs/                       # Docs viewer chrome
│   ├── guide/                      # Guide viewer chrome
│   ├── HomeRedirect.tsx            # Client island: redirects non-customers away from landing
│   └── Providers.tsx               # Root providers wrapper (AuthProvider, etc.)
├── contexts/
│   └── AuthContext.tsx             # Auth state, login/register/OTP, signOut, dashboardPath()
├── data/
│   └── guide.ts                    # Static guide content
├── lib/
│   ├── api.ts                      # apiGet / apiPost / apiPatch / apiDelete (all via /api proxy)
│   ├── docRequirements.ts          # Client-side doc requirement definitions (mirrors backend)
│   └── utils.ts                    # cn() (clsx + tailwind-merge)
└── types/
    └── openapi.ts                  # Generated TS types from backend Swagger schema
```

## Roles → dashboard routes

| Role | Post-login destination | Dashboard root |
|---|---|---|
| `customer` | `/` (landing page) | `/dashboard/customer/` |
| `rental_provider` | `/rental-provider/dashboard` | `/rental-provider/dashboard/` |
| `service_provider` | `/dashboard/service-provider` | `/dashboard/service-provider/` |
| `manager` | `/dashboard/manager` | `/dashboard/manager/` |
| `technician` | `/dashboard/technician` | `/dashboard/technician/` |
| `admin` | `/dashboard/admin` | `/dashboard/admin/` |
| `super_admin` | `/dashboard/admin` | `/dashboard/admin/` |

`dashboardPath(role)` in `AuthContext.tsx` is the single source of truth. `HomeRedirect.tsx` uses it on the landing page.

## Complete route inventory

### Public / Auth
| Route | Purpose |
|---|---|
| `/` | Landing page (HomeRedirect redirects non-customers) |
| `/login` | OTP login step 1 — enter email |
| `/verify` | OTP login step 2 — enter 6-digit code (phone) |
| `/verify-email` | Email verification flow |
| `/forgot-password` | Password reset request |
| `/register` | Role selector page |
| `/register/customer` | Customer self-registration |
| `/register/rental-provider` | RP self-registration |
| `/register/service-provider` | SP self-registration |
| `/invite/[token]` | Accept manager/technician invite link |
| `/listings` | Public property listings browse |
| `/listings/[country]/[emirate]` | Emirate-filtered listings |
| `/listings/units/[id]` | Single unit detail page |
| `/services` | Home services browse |

### Admin dashboard (`/dashboard/admin/`)
| Route | Purpose |
|---|---|
| `/dashboard/admin` | Overview — platform stats, quick actions |
| `/dashboard/admin/kyc` | KYC queue — split panel (list ↔ checklist+detail) |
| `/dashboard/admin/kyc/rental-provider/[id]` | Full RP KYC detail page |
| `/dashboard/admin/kyc/service-provider/[id]` | Full SP KYC detail page |
| `/dashboard/admin/kyc/tenant/[id]` | Full Tenant KYC detail page |
| `/dashboard/admin/listings` | Listing approval queue — split panel with RERA index |
| `/dashboard/admin/accounts` | Account management |
| `/dashboard/admin/accounts/new` | Create account (generic) |
| `/dashboard/admin/accounts/new-provider` | Create provider account (admin-side) |
| `/dashboard/admin/users` | User list |
| `/dashboard/admin/analytics` | Platform analytics (stub) |
| `/dashboard/admin/disputes` | Disputes queue (stub) |
| `/dashboard/admin/inbox` | Admin inbox (stub) |

### Customer dashboard (`/dashboard/customer/`)
| Route | Purpose |
|---|---|
| `/dashboard/customer/spaces` | My rented spaces — main customer hub with `RentalDocumentsCard` |
| `/dashboard/customer/contracts` | Contract list |
| `/dashboard/customer/contracts/[id]` | Contract detail (Parties/Property/Period/Payments/Clauses — NO documents tab) |
| `/dashboard/customer/contracts/[id]/print` | Print-friendly contract view |
| `/dashboard/customer/documents` | Unified document hub (KYC + rental docs + free-form) |
| `/dashboard/customer/services` | My service bookings |
| `/dashboard/customer/profile` | Profile & KYC |
| `/dashboard/customer/notifications` | Notification centre |
| `/dashboard/customer/help` | Help & support |
| `/dashboard/customer/wishlist` | Saved listings |
| `/dashboard/customer/viewings` | Viewing schedule |

### Rental Provider dashboard (`/rental-provider/dashboard/`)
| Route | Purpose |
|---|---|
| `/rental-provider/dashboard` | Overview — KPIs, occupancy gauge, receivables chart, quick actions |
| `/rental-provider/dashboard/portfolio` | Property & unit portfolio list |
| `/rental-provider/dashboard/portfolio/add` | Add new property/unit wizard |
| `/rental-provider/dashboard/leads` | Leads kanban — stage pipeline with fee rules |
| `/rental-provider/dashboard/orders` | Contracts list |
| `/rental-provider/dashboard/orders/[id]` | Contract detail (not used — see contracts/[id]) |
| `/rental-provider/dashboard/contracts/[id]` | Contract detail — 6-step timeline |
| `/rental-provider/dashboard/contracts/[id]/print` | Contract print view |
| `/rental-provider/dashboard/contracts/[id]/print/handover` | Move-in handover print |
| `/rental-provider/dashboard/contracts/[id]/print/receipt` | Payment receipt print |
| `/rental-provider/dashboard/contracts/[id]/print/addendum` | Contract addendum print |
| `/rental-provider/dashboard/contracts/[id]/print/deposit` | Security deposit receipt print |
| `/rental-provider/dashboard/contracts/[id]/inspection` | Move-in/out inspection |
| `/rental-provider/dashboard/contracts/new` | Create new contract |
| `/rental-provider/dashboard/receivables` | Financial receivables |
| `/rental-provider/dashboard/deposits` | Security deposit tracking |
| `/rental-provider/dashboard/documents` | RP document uploads |
| `/rental-provider/dashboard/amc` | AMC & vendor contracts |
| `/rental-provider/dashboard/team` | Team members |
| `/rental-provider/dashboard/tenants` | Tenant list |
| `/rental-provider/dashboard/units` | Unit list |
| `/rental-provider/dashboard/communications` | Messaging (stub) |
| `/rental-provider/dashboard/reports` | Reports (stub) |
| `/rental-provider/dashboard/onboarding` | RP profile onboarding wizard |
| `/rental-provider/dashboard/settings` | Settings |
| `/rental-provider/dashboard/profile` | Profile management |

### Service Provider dashboard (`/dashboard/service-provider/`)
| Route | Purpose |
|---|---|
| `/dashboard/service-provider` | SP overview |
| `/dashboard/service-provider/services` | Service catalogue |
| `/dashboard/service-provider/services/new` | Add new service |
| `/dashboard/service-provider/jobs` | Active & past jobs |
| `/dashboard/service-provider/team` | Technician team |
| `/dashboard/service-provider/reviews` | Customer reviews |
| `/dashboard/service-provider/documents` | SP KYC documents |
| `/dashboard/service-provider/profile` | Profile |
| `/dashboard/service-provider/onboarding` | SP onboarding wizard |

### Manager dashboard (`/dashboard/manager/`)
| Route | Purpose |
|---|---|
| `/dashboard/manager` | Manager overview |
| `/dashboard/manager/properties` | Managed properties |
| `/dashboard/manager/contracts` | Managed contracts |
| `/dashboard/manager/maintenance` | Maintenance requests |

### Technician dashboard (`/dashboard/technician/`)
| Route | Purpose |
|---|---|
| `/dashboard/technician` | Technician overview |
| `/dashboard/technician/jobs` | Job assignments |
| `/dashboard/technician/schedule` | Shift schedule |

## AuthContext — key details

**Login is 2-step OTP** (no password):
1. `login(email)` → `POST /auth/login` → backend sends OTP → returns `requiresVerification: true`
2. `verifyLoginOtp(email, code)` → `POST /auth/login/verify-otp` → returns session cookie + user

**Session** lives as an httpOnly cookie managed by the Next.js `/api/[...path]/route.ts` proxy. JWTs never touch JS.

**`signOut()`** fires `POST /api/auth/logout` with `keepalive: true` (so it survives hard navigation), clears React state, then calls `window.location.replace('/')` — hard navigation prevents race conditions with auth guards during the brief `user === null` window.

**`RpOnboardingGate`** wraps RP pages — redirects to `/rental-provider/dashboard/onboarding` if the RP profile is incomplete.

## DashboardShell — sidebar nav

Nav items are defined in the `NAV` record in `DashboardShell.tsx`, keyed by `UserRole`. Sidebar is collapsible (60px icon-only ↔ 240px full), state persisted to `localStorage` key `upnow_sidebar_collapsed`. Customer/RP/SP/etc. each have their own nav structure — see `DashboardShell.tsx` for the full `NAV` record.

**RP sidebar sections**: Dashboard · My Properties / Leasing (Leads, Contracts) / Finance (Receivables, Deposits) / Operations (AMC) / Communications / Reports / Team / Tenants / Settings

## API proxy (`src/app/api/[...path]/route.ts`)

All `apiGet/apiPost/apiPatch/apiDelete` calls go to `/api/<path>` which the Next.js route handler proxies to `process.env.BACKEND_URL`. The proxy forwards the httpOnly JWT cookie automatically — client JS never sees the token.

## How to pick up the next task

1. Open [BACKLOG.md](BACKLOG.md). Find the first row with status `🔵 Ready` in the **active sprint**.
2. Read the linked Jira ticket (`SCRUM-XXX`) for AC. Mirror the SRS in `../docs/sprint-0X-srs.html`. Cross-check visuals against the matching mockup in `../Mockups/`.
3. Branch: `git checkout -b scrum-XXX-short-slug`
4. Implement: route in `src/app/...`, components in `src/components/...`, hooks/fetchers in `src/lib/...`.
5. Run `npm run lint && npm run build` — must pass.
6. Update `BACKLOG.md` row to `🟢 Done` with commit SHA.
7. PR title: `SCRUM-XXX: <summary>`. Reference SRS section.

## Commands

```bash
npm run dev      # http://localhost:3001 (backend on 3000)
npm run build    # production build
npm run start    # serve production build
npm run lint     # eslint
```

## Don't

- Don't add Supabase, Prisma, or Auth.js.
- Don't bypass Zod validation.
- Don't store JWTs in `localStorage` — use httpOnly cookies via route handlers.
- Don't import server-only modules into client components.
- Don't commit `.env.local` or anything from `.next/`.

---

## Implemented Architecture Decisions (session May 14, 2026)

### Document Management — Single Source of Truth

**Decision**: All customer document upload/management lives in ONE place only.

| Surface | What it shows |
|---|---|
| `app/dashboard/(dashboard)/customer/spaces/page.tsx` → `RentalDocumentsCard` | **THE upload hub** — all required, landlord-requested, and free-form docs |
| `app/dashboard/(dashboard)/customer/contracts/[id]/page.tsx` | **No documents** — Documents tab, drawer, sidebar nav entry and all upload state removed |

**Do not re-add document upload UI to the contract detail page.** The contract page is read-only for documents.

### RentalDocumentsCard (spaces/page.tsx — line ~849)

Standalone component used in `ExpandedDetail` and `DirectExpandedDetail` (both with-contract and no-contract branches). Key internals:

- **`handleUpload(req, file, existingDocId?)`** — upload for a known doc key (required or landlord-requested). Uses presigned URL → PUT → POST `/api/documents`.
- **`handleFreeUpload()`** — free-form attach with custom label. `ownerType: 'tenant_profile'`, `ownerId: tenantProfileId`. Form state: `showAttach`, `attachLabel`, `attachFile`, `attaching`, `attachError`, `attachInputRef`.
- **Priority sort rank**: 0=rejected required, 1=rejected landlord, 2=required missing, 3=landlord pending (no file), 4=optional missing, 5=uploaded pending review, 6=landlord uploaded pending, 7=approved required, 8=approved landlord.
- **Summary banner** above doc list: amber pills for missing required, red pills for rejected — shows exact document names.
- **Header counter**: `X/Y uploaded` (amber) when incomplete → `All required ✓` (green) when done.

### RP Contract Timeline (rental-provider/dashboard/contracts/[id]/page.tsx)

Clean **6-step** timeline for non-renewal:
1. Contract Issued → 2. Payment Collection → 3. Signatures → 4. Ejari Registration → 5. Move-In & DEWA → 6. Active Tenancy

The `ContractDetail` interface has **no `viewing` field** on the frontend. The backend still returns it (reserved for future move-in checklist feature) — do not add it back to the TS interface unless you are building that feature.

Renewal branch is separate and unchanged: Terms Agreed (1) → Signatures (2) → Ejari Renewal (3) → Active Renewal (4).

### Customer Contract Detail Page (contracts/[id]/page.tsx)

Tabs present: **Parties · Property · Period · Payments · Clauses**. The `documents` tab was intentionally removed. Do not add it back. Imports `Paperclip`, `UploadCloud`, `ExternalLink` are gone from this file — do not re-add them for a documents purpose.

### Backend — contracts.module.ts / contracts.service.ts

`Lead` and `Viewing` are registered in `ContractsModule.forFeature` and `leadRepo`/`viewingRepo` are injected in `ContractsService`. `getContractById` returns a `viewing` key in the response (latest viewing for that lead). The frontend RP page does not consume this field today — it is **reserved** for the move-in inspection feature (SCRUM-403). Do not remove the backend enrichment.

### Pending DB migration (run before next deploy)

```sql
ALTER TYPE document_status ADD VALUE IF NOT EXISTS 'rejected';
```

### Contract Renewal — SCRUM-272 + SCRUM-273 (Sprint 4) — **IMPLEMENTED (May 21, 2026)**

Backend endpoints + DTO + Payment row generation live (see `upnow-backend/AGENTS.md` § Contract Renewal). Frontend pieces below.

#### RP side — Propose Renewal flow

**Location**: [rental-provider/dashboard/contracts/[id]/page.tsx](src/app/rental-provider/dashboard/contracts/%5Bid%5D/page.tsx)

- **CTA pill in top bar** — `Propose Renewal` button. Visible when `status === 'active'` AND `contractType !== 'renewal'` AND `renewalAccepted` is null. (The 120-day pre-expiry gate was dropped — backend `status='active'` check is the real constraint; the cron sets `renewalStatus='pending'` to surface the reminder upstream.)
- **State pills** (replace the CTA after a proposal):
  - `Renewal Proposed — awaiting tenant` (amber, when `renewalAccepted='pending'`)
  - `Renewal Rejected by tenant` (red, when `renewalAccepted='rejected'`)
  - `Renewal Accepted` (green, when `renewalAccepted='accepted'`)
- **Modal** — comprehensive layout with three sections:
  1. **Current Contract** read-only summary: Tenant, Period, Building, Unit, Location, Annual Rent, Cheques payable to
  2. **New Renewal Terms**: New Annual Rent, Start/End Date, Installments, Payment Method, "Issue cheques to same payee" checkbox (uncheck reveals `chequePayeeName`)
  3. **Fees (AED)**: Admin Fee + Ejari Fee, prefilled from current contract
  4. **Planned Installments**: live-computed cheque schedule table (#, description, due date, amount) updates as user edits dates/rent/N
  5. **Additional Charges (optional)**: "+ Add line" rows for VAT, Municipality Fee, parking add-ons (description + amount + dueDate)
- **Submit** → `PATCH /contracts/:id/renewal/propose` (all field-level data above; AED integers throughout — no fils conversion).

#### Tenant side — Renewal Journey Panel

**Location**: [customer/spaces/page.tsx → `RenewalJourneyPanel`](src/app/dashboard/%28dashboard%29/customer/spaces/page.tsx) (function defined in same file; rendered above the active contract's details in all 4 layout branches).

**Auto-hides** when `parent.renewalAccepted` is null. Once a renewal is in flight, renders as a separate green-bordered card at the **top** of the space tile, before the active Contract section.

**Card structure**:
1. **Header**: "Renewal Journey" title + status pill (Action Required / In Progress / Rejected). Header gradient `#f0faf6 → #fafff7`.
2. **Renewal Contract & Payment Plan** (matches the new-lease "Payment Plan & Cheques" card visually — `#f0f9ff` accent):
   - Print/Download button (top-right) — opens a new window with full printable HTML (window.print → Save as PDF). Implemented in `handlePrintRenewal()`.
   - Contract & Cheque Details grid (Cheque Drawer, Cheque Payee, Building, Unit, Location, Renewal Period)
   - Rent & Fees section (Annual Rent, Admin Fee, Ejari Fee, Security Deposit = "Carries forward")
   - Cheque Schedule table — listed in order: admin → ejari → rent #1..N → extras. Total at the foot.
3. **6-Step Timeline** (mirrors the new-lease pipeline minus Issued + Utility):

| # | Step | Done when |
|---|---|---|
| 1 | Terms Offered | tenant clicks Accept (or Reject which sets `'rejected'`) |
| 2 | Rental Documents | RP confirms PDC (`pdcConfirmed` on child) OR contract progresses past it |
| 3 | Payment Plan & Cheques | RP sets `pdcConfirmed=true` on the renewal child |
| 4 | Signatures | both landlord + tenant signed the renewal child |
| 5 | Ejari Renewal | `child.ejariStatus === 'registered'` |
| 6 | Active Renewal | `child.status === 'active'` |

**Step 1 actions**: `Accept Renewal` / `Reject` buttons (call `PATCH /contracts/:id/renewal/accept` or `/reject`).

**Step 2 — Rental Documents** is the only step that explicitly requires tenant action:
- Existing documents do **NOT** auto-carry over for renewals. Tenant must upload fresh copies.
- Renders the **same `InlineDocRow` component** used by the new-lease pipeline.
- Required-doc list comes from `getRequiredDocs(parent.unit.type)` in `[docRequirements.ts](src/lib/docRequirements.ts)` — switches by unit category:
  - Residential: Emirates ID + Passport + Employment Letter + Bank Statement
  - Commercial: Trade License + (optional: Tax Registration, MOA/MOM, Financials)
  - Industrial: Trade License + Business License + (optional: Financials)
- Optional docs collapsed under "+ Optional documents" details.
- **Renewal docs are isolated** from the tenant's lifetime KYC docs:
  - Uploaded with `ownerType: 'tenancy_contract', ownerId: child.id` (NOT `customer` + `tenantProfileId`)
  - Fetched via `GET /api/documents?ownerType=tenancy_contract&ownerId=<childId>` (NOT `/documents/my`)
  - This means each rental on this property gets a fresh upload slot; the previous lease's docs aren't surfaced as "already uploaded".

**Step 4** shows a `Sign Renewal Contract` deep link (currently to `/dashboard/customer/contracts/<childId>` — the existing tenant contract page handles signing).

#### List view — `/dashboard/customer/spaces` indicator

When `row.contract?.renewalAccepted` is non-null, the space tile's status pill is replaced with:
- Amber `🔄 Renewal — Action Required` (when `'pending'`)
- Green `🔄 Renewal in Progress` (when `'accepted'`)

So tenants see at-a-glance from the list which spaces have renewals in flight.

#### Disambiguating original vs renewal child contracts

The customer/spaces page's `pickPrimaryContract(contracts, unitId)` helper resolves which contract to render as the tile's primary tenancy when a unit has both the original active contract AND a pending renewal child:
- Filters out rows where `contractType === 'renewal'` or `parentContractId !== null`
- Falls back to ranking by status (active > issued > pending)

This prevents the tenant journey panel from showing the renewal child's "Contract Issued / Sign Contract" early-stage flow while their original tenancy is still active.

#### TenantContract interface extensions

`TenantContract` (used by the spaces list) now includes `contractType`, `parentContractId`. `FullContractDetail` (used by `ContractInlineSection`) includes `renewalAccepted`, `renewalStatus`. Both required by the helpers above.

#### Still pending
- Cron-driven renewal reminders (SCRUM-272) — backend stub only.
- Signing UX for the renewal child contract is currently a deep-link to the existing tenant contract page rather than inline in the panel.

---

## Open bugs (centralized)

| ID | Area | Issue |
|---|---|---|
| GAP-G6 | RP contracts e-sign | Tenant e-sign UI is canvas-only — needs typed-name fallback (discovered in E2E) |
| GAP-G9 | RP contract detail | "Activate tenancy" button missing — page comment notes it; not yet built |

---

## In-flight uncommitted work (as of May 20, 2026)

**151 modified files in each repo (`upnow-frontend` + `upnow-backend`) currently uncommitted on `main`.**

This is the Sprint 1–4 implementation pass + full codebase commenting pass + all admin dashboard UI work from session May 20. NOT noise — do not discard. Once committed, the entry below should be removed.

Scope of changes:
- Backend: auth, users, profiles, properties, leads, contracts, documents, admin KYC endpoints, notifications, audit, full enums consolidation, .env.example updates
- Frontend: all admin dashboard pages (KYC split panel + AbortController fix, listings RERA index, accounts), DashboardShell collapsible sidebar, HomeRedirect island, customer documents hub, RP contract detail timeline, RentalDocumentsCard

See git status for the full file list. Commit message format: `feat: Sprint 1-4 implementation + full codebase commenting pass` (per the earlier `4a77a77` commit — these are additional changes since that landed).

### Open next task — Unified Document Hub (CID-328-FE)

See BACKLOG.md Sprint 4 for the full spec. Short version:
- New page: `/dashboard/customer/documents`
- Section A: Identity/KYC (all customers)
- Section B: Rental docs (only when active tenancy/lead exists)
- Section C: Free-form uploads
- `RentalDocumentsCard` becomes a compact status chip + "Manage Documents →" link
- `TenancyJourneyPanel` Step 3 becomes a link to this page, no inline upload

---

## Admin Dashboard UI Sprint (session May 20, 2026)

### 1. Collapsible sidebar — `DashboardShell.tsx`

- Added `collapsed?: boolean` prop to `Sidebar` component
- Collapsed state: 60px icon-only rail; expanded: 240px full rail
- Desktop toggle button (ChevronLeft/Right) in the topbar
- State persisted to `localStorage` key `upnow_sidebar_collapsed`
- When collapsed: text labels, role chip, and user info hidden; icon `title` attributes act as tooltips
- CSS: `overflow-x: hidden` + `transition: padding 0.2s ease` added to `.rail` in `DashboardShell.module.css`
- Active item style: `background: #e7f3ed; color: #166651` (lighter green — intentional, do not revert to dark)

### 2. Post-login redirect — `HomeRedirect.tsx` + `app/page.tsx`

- New client island: `src/components/HomeRedirect.tsx`
- Mounted on the landing page (`/`). If user role is not `customer`, redirects to `dashboardPath(user.role)` immediately after auth loads
- Customers see the landing page; super\_admin / admin / rental\_provider / service\_provider go straight to their dashboard
- Imported and rendered as first child in `src/app/page.tsx` (before `<Navbar />`)

### 3. Listings page redesign — `admin/listings/page.tsx`

Full rewrite. Key structural decisions:

- **No `DashboardPage` wrapper** — custom `flex flex-col h-full` with `padding: 12px 20px 16px`
- **Height**: `flex-1 min-h-0` pattern everywhere (no `calc(100vh - Npx)`)
- **Header row**: "Listings" title inline with category tabs + compact stats strip (Total, Pending, Approved, Rejected counts) + refresh button — all in one `border-bottom` row
- **Split panel**: 320px left card list + `flex-1` right detail. Left list scrolls independently
- **`UnitDetailPanel`**: two-column internal layout — 168px left checklist strip + flex-1 right scrollable detail
  - Checklist strip: score badge (% complete) + 6 items (Photos, Rental price, Unit size, Description, Availability, Unit type)
  - Detail cards: photo carousel (160px, thumbnails), Location, Unit Specs (2-col key-value table), Pricing (annual rent highlighted + 2-col grid), Amenities, Description

### 4. RERA Rental Index — `admin/listings/page.tsx`

Per-card badges + filter chip. No separate section (doesn't scale to 1000s).

```typescript
const RERA_INDEX_CAP: Record<string, number> = {
  residential: 145000,   // AED/yr
  commercial:  270000,
  industrial:  160000,
};

function indexDeviation(unit: PendingUnit): number | null {
  // returns % above cap only if ≥ 20%, else null
}
```

- `UnitCard` shows amber/red `⬆ +N%` badge when deviation ≥ 20%
- Filter chip "Exceeds RERA Index (N)" alongside category chips; `queueOverIndex` boolean state
- `visibleQueue` is the derived filtered list; pagination suppressed when `queueOverIndex` is true

### 5. KYC queue page redesign — `admin/kyc/page.tsx`

Full rewrite applying the same split panel pattern as listings.

**Layout:**
- Same tight header: "KYC Queue" title + 3 tabs (Rental Providers, Service Providers, Tenants with counts) + compact stats (RP Pending, RP Action, SP Pending, SP Action — red when > 0) + refresh button
- Status filter chips (All / Pending Review / Action Required / Compliant) — hidden while a record is open
- Split panel: 280px left + `flex-1` right

**Left panel — context-aware:**
- **Browsing**: shows the scrollable `KycCard` list
- **RP selected**: switches to `RpChecklistPanel` — KYC score badge (large) + document checklist items + "← Back to list" button
- **SP selected**: `SpLeftPanel` — icon, category, status, entity type, rating summary + back button
- **Tenant selected**: `TenantLeftPanel` — icon, doc status, active status, registered date + back button

**Right panel:**
- `RpContentPanel`: Identity card (8 fields, 2-col grid), Trade License card, Banking card, Uploaded Docs card + sticky action bar (notes input + Mark Compliant / Request Action / Expire buttons)
- `SpContentPanel`: SP fields + "Open Full KYC Review" primary CTA
- `TenantContentPanel`: tenant fields + "Open Full KYC Review" primary CTA

**RP detail fetch is lifted to the main page** (`rpDetail`, `rpDetailLoading`, `rpDetailError` state) so both `RpChecklistPanel` and `RpContentPanel` share a single fetch — no duplicate requests.

### 6. Race condition fix — `admin/kyc/page.tsx` + `src/lib/api.ts`

Rapid provider switching was firing multiple concurrent fetches; whichever responded last won (stale data).

Fix: `AbortController` in the RP detail `useEffect`. Cleanup function calls `controller.abort()` on every re-run.

```typescript
// apiGet now accepts an optional signal
export async function apiGet<T>(path: string, options?: { signal?: AbortSignal }): Promise<T>
```

Pattern used:
```typescript
const controller = new AbortController();
apiGet<RpDetail>(`/admin/kyc/rental-providers/${selectedId}`, { signal: controller.signal })
  .then((d) => { if (!controller.signal.aborted) setRpDetail(d); })
  ...
return () => controller.abort();
```

**All callers of `apiGet` that don't pass a signal are unaffected** — the parameter is optional.

---

## Session May 21, 2026 — Ejari one-click activate, termination UI, contracts list, reports

### Ejari upload → activate chain (RP contract detail)

[`rental-provider/dashboard/contracts/[id]/page.tsx`](src/app/rental-provider/dashboard/contracts/[id]/page.tsx) — `uploadEjariDoc` now chains three API calls on a successful upload:

1. `POST /api/documents` — record the file
2. `PATCH /api/contracts/:id/ejari` — set `ejariStatus: 'registered'`
3. `PATCH /api/contracts/:id/activate` — only if not already active

The two manual buttons ("Mark Ejari Registered", "Mark Ejari Renewed") are removed. The Ejari step in both timelines (new contract + renewal) now shows a single **Upload & Activate** button that handles everything.

**Re-upload Ejari**: in the `done` state of either Ejari step, a small "Re-upload Ejari" button calls `PATCH /api/contracts/:id/ejari/reset` (new backend endpoint). On success the contract reverts to `status='issued'`, `ejariStatus='pending'`, and the cached `docs` state is filtered to drop the old Ejari rows. The upload UI re-appears and the chain runs again.

### Two-sided termination — top-of-page panel

Termination is no longer a discreet button buried in Step 5 of the RP timeline. Both pages now show it at the top:

**RP page** ([`contracts/[id]/page.tsx`](src/app/rental-provider/dashboard/contracts/[id]/page.tsx)):
- "Request Termination" button in the top action bar (only when `status='active'` and no pending request)
- Banner just below the top bar in three states:
  - Tenant-initiated → **amber alert** with Accept / Reject buttons (`POST /api/contracts/:id/termination/respond`)
  - RP-initiated → neutral "Awaiting tenant response" card
  - Rejected → small dismissed-note line
- Request modal collects `reason` (textarea) + `effectiveDate` (date input). Empty fields show inline validation.

**Customer page** ([`customer/spaces/page.tsx` → `ContractInlineSection`](src/app/dashboard/(dashboard)/customer/spaces/page.tsx)):
- "Request Termination" button in the contract card header
- Same three banner states, with directions reversed (RP-initiated → amber alert for tenant)
- Tenant-side endpoints: `POST /api/contracts/tenant/:id/termination/request`, `PATCH /api/contracts/tenant/:id/termination/respond`

`TenantContract` + `FullContractDetail` types both gained a `termination` object that mirrors the backend shape.

### Customer spaces page — tab-focus refetch

Added focus/visibility-change listeners in three components so the customer always sees the freshest RP-side state without a hard reload:

- Top-level `SpacesPage` — refetches contracts list
- `ContractInlineSection` — refetches its own `/api/contracts/tenant/:id`
- `RenewalJourneyPanel` — refetches renewal child + docs

Pattern (lifted into a `useEffect` in each component):
```tsx
useEffect(() => {
  function refetchIfVisible() {
    if (document.visibilityState === 'visible') load();
  }
  window.addEventListener('focus', refetchIfVisible);
  document.addEventListener('visibilitychange', refetchIfVisible);
  return () => {
    window.removeEventListener('focus', refetchIfVisible);
    document.removeEventListener('visibilitychange', refetchIfVisible);
  };
}, [load]);
```

### RP contracts list page (new)

[`rental-provider/dashboard/contracts/page.tsx`](src/app/rental-provider/dashboard/contracts/page.tsx) — a minimal list of every contract under this RP, fetched from `GET /api/contracts`. Replaces a missing route that the back button on the detail page (`/contracts/:id`) pointed at. Columns: Contract (CID + renewal pill), Tenant, Unit, Period, Annual Rent, Status pill. Search filter and "+ New Contract" CTA in the top bar.

### Reports — interactive + CSV + print PDF

New route `/rental-provider/dashboard/reports/[slug]` ([page.tsx](src/app/rental-provider/dashboard/reports/[slug]/page.tsx)) is a single generic detail page driven by a `REPORTS: Record<ReportSlug, ReportDef>` map. Each `ReportDef` declares title, description, endpoint, columns (with type: `aed` / `date` / `number` / `bucket` / `stage` / `rate` / `delta`), and total tiles.

Backed by 4 backend endpoints (Occupancy, Receivables, Lease Expiry, Renewal Pipeline). The detail page renders:

- KPI tiles at the top from `data.totals`
- Sortable columns — click any header, ↑/↓ indicator
- Search box that filters across every column
- **CSV download** — `downloadCsv()` helper builds a CSV string client-side from the *currently sorted* rows. AED columns export as `(fils / 100).toFixed(2)`; dates as ISO `YYYY-MM-DD`. No backend round-trip.
- **PDF** — `window.print()`. The page is print-styled with `print:hidden` on the action bar / search / controls, and a `print:block` header that shows the title, description, and "Generated …" timestamp. Users use the browser's "Save as PDF" destination from the print dialog. **No server-side PDF library** — matches the existing `/contracts/[id]/print` pattern.

The lease-expiry report has a window selector (30 / 60 / 90 / 180 / 365 days) that updates the URL query string + refetches.

The reports landing page ([`/reports/page.tsx`](src/app/rental-provider/dashboard/reports/page.tsx)) lists all 12 report tiles, with the 4 backed ones in an "Available now" grid (clickable to `/reports/<slug>`) and the other 8 in a dimmed "Coming soon — needs additional data tracking" grid.

---

## Session May 22–25, 2026 — Customer Spaces v2, Addendums, Profile edits, Occupants

### Customer Spaces v2 — Tenancy Journey redesign

New parallel route [`/dashboard/customer/spaces/v2/[spaceKey]`](src/app/dashboard/(dashboard)/customer/spaces/v2/[spaceKey]/page.tsx) implementing the Quest-layout tenancy life-cycle from the design bundle. Coexists with v1 (`/dashboard/customer/spaces`) — both are live; v2 is the design-aligned single-space focused view, v1 remains the list view.

Key pieces:
- `deriveStateKey(resolved)` → 25 named states (viewing → application_review → documents → documents_submitted → payment_plan → cheques_submitted → contract_issued → signature → ejari → utility → awaiting_movein_inspection → move_in → awaiting_activation → active → termination_* → renewal_*). State priority intentionally puts `c.renewalAccepted === 'pending'` BEFORE the renewal child contract's state, so the Terms-Offered card (step 1 of 6) shows before the cheques screen.
- Action bodies via `<ActionBody stateKey={…} resolved={…} onRefresh={…} />` dispatch — one component per state.
- Renewal mode shows two stacked QuestActionCards (original lease + renewal child) when both contracts coexist.
- `RenewalOfferedAction` shows full terms with comparison vs current rent, delta %, period, cheques, contract value, carry-forward deposit note.

### Step 3 — Inline Rental Documents & Preferences (restored + extended)

A previous CID-328-FE refactor deleted the inline preferences/docs form from `TenancyJourneyPanel` Step 3 (replaced with a deep-link to Document Hub) — but the design and product flow required the inline form. Restored in v1 from HEAD verbatim and ported to v2's `DocumentsAction`.

Form contents (v1 + v2 identical behaviour, different visual systems — v1 Tailwind, v2 inline CSS-var styles):
- **Contract Start Date** picker — calendar respects `rp.preferredStartDays` (per-RP day-of-month allow-list); falls back to all-days when unrestricted.
- **Number of Payments** pills — Annual / Semi-Annual / Quarterly / Bi-Monthly / Monthly.
- **Number of Occupants** stepper (residential only) — default 1.
- Inline required document rows with one-click upload (3-step S3 presigned-PUT).
- **Submit** → `PATCH /api/leads/my-viewings/:viewingId/preferences` with `desiredMoveIn` + `preferredChequeCount` + `paymentType: 'postdated_cheque'`, then refresh.

After submit, the action card collapses to a single "Documents & preferences submitted ✓" line and the state machine flips to `documents_submitted`.

### Occupant identity docs (multi-occupant booking support)

New helpers in [`docRequirements.ts`](src/lib/docRequirements.ts):

```ts
getOccupantDocs(occupantCount: number): DocReq[]    // emits 3 docs per occupant >= 2
deriveOccupantCount(docKeys: Iterable<string>): number   // count from existing keys
```

For occupant N ≥ 2, three doc rows render with stable keys: `occupant_${N}_emirates_id`, `occupant_${N}_passport`, `occupant_${N}_uae_visa`. Occupant 1 (the primary tenant) reuses the existing `emirates_id` / `passport` / `uae_visa` keys.

Occupant count is **not persisted** as a column — `deriveOccupantCount(myDocs.map(d => d.documentKey))` reads it back from uploaded docs so the stepper survives reload without a backend migration. `useEffect` on `myDocs` bumps `occupantCount` to the derived value when higher.

`requiredMissing` and `docsOk` checks now include the occupant docs, so the Submit button stays disabled until every occupant's identity docs are uploaded.

### Addendum templates feature (Sprint-11 delta)

End-to-end PDF/DOCX addendum library tied to contracts, with both-party signatures.

**Backend**:
- New entities: `addendum_templates` (per-RP reusable library), `contract_addendums` (template attached to a specific contract + tenant/landlord sig). Schema delta SQL: [`upnow-backend/docs/sprint-11-schema-delta-addendum.sql`](../upnow-backend/docs/sprint-11-schema-delta-addendum.sql) — applied to dev DB.
- New module: `addendum-templates.{controller,service,module}.ts` — CRUD + `POST /addendum-templates/upload-url` (presigned). `ALLOWED_MIME = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']`.
- ContractsService gains `attachAddendum / listAddendums / removeAddendum / signAddendum` — locked to `ContractStatus.PENDING` for attach/remove (cannot mutate after issuance).
- ContractsController exposes `GET/POST/DELETE /:id/addendums` + dual-role sign endpoints (`POST /:id/addendums/:addendumId/sign` for RP and `POST /tenant/:id/addendums/:addendumId/sign` for tenant).
- Audit logs use `actionKey: 'contract.addendum.attach' | '.remove' | '.sign'` and `actorUserId` (NOT `action` / `actorId` — those are wrong field names).

**Frontend**:
- New reusable [`AddendumsPanel`](src/components/upnow/AddendumsPanel.tsx) — role-aware (`role="landlord" | "tenant"`); landlord can attach (template picker OR one-off upload) + remove, tenant can only sign. Canvas signature pad inside.
- New RP page [`/rental-provider/dashboard/templates/page.tsx`](src/app/rental-provider/dashboard/templates/page.tsx) — addendum template library CRUD; nav entry added under "Leasing" in [`DashboardShell`](src/components/dashboard/DashboardShell.tsx).
- `<AddendumsPanel role="landlord">` mounted at the top of [`rental-provider/dashboard/contracts/[id]/page.tsx`](src/app/rental-provider/dashboard/contracts/[id]/page.tsx); `<AddendumsPanel role="tenant">` mounted above the main action banner on [`customer/contracts/[id]/page.tsx`](src/app/dashboard/(dashboard)/customer/contracts/[id]/page.tsx).
- Both `/contracts/[id]/print/page.tsx` pages fetch `/api/contracts/:id/addendums` and append one A4 coversheet per addendum (with name + file URL + tenant/landlord SigBox).

### Profile — Email + Phone change with OTP

[`customer/profile/page.tsx`](src/app/dashboard/(dashboard)/customer/profile/page.tsx) now ships `EmailField` and `PhoneField` components for in-place email/phone changes (the previous form silently no-op'd these fields).

- **EmailField** detects auto-generated phone-only emails (matching `@upnow.local` or `^phone-`) and prompts the user to add a real one. New email → PATCH `/auth/me` (which resets `emailVerified=false`) → `POST /auth/email/resend` → OTP entry → `POST /auth/email/verify-otp`. Dev-mode OTP rendered in the banner with an Auto-fill button when `NODE_ENV !== 'production'`.
- **PhoneField** mirrors the email pattern — new phone → PATCH `/auth/me` (resets `phoneVerified=false`) → `POST /auth/otp/request` → `POST /auth/otp/verify`.
- The form's main submit no longer includes `email` or `phone` (they have their own flows).

Backend [`auth.service.ts`](../upnow-backend/src/auth/auth.service.ts) `updateMe` enforces uniqueness on both email and phone before persisting (throws `ConflictException` with a friendly message). `UpdateProfileDto` in [`auth.dto.ts`](../upnow-backend/src/auth/auth.dto.ts) now accepts an `email` field with `@IsEmail` + `@MaxLength(150)`.

### Auto-generate Unit Description

[`UnitFormModal`](src/components/upnow/UnitFormModal.tsx) gained a `composeUnitDescription(d, propertyCategory)` helper + "Auto-generate" / "Re-generate" button next to the Description label. Synthesizes 3 sentences from the selected unit type, tier, bedrooms/bathrooms, floor (with ordinal), size, view, furnishing, and top 6 amenities. Button is disabled until a unit type is selected.

### Bulk operational note

When marking an RP as "onboarding-verified" for dev/testing, the SQL is:

```sql
UPDATE rental_providers
SET compliance_status = 'compliant',
    document_status = 'complete',
    bank_account_status = 'complete',
    poa_status = CASE WHEN has_poa THEN 'complete' ELSE poa_status END,
    compliance_paused_at = NULL,
    updated_at = NOW()
WHERE id = <rp_id>;
```

`account_type_confirmed_at` should already be set if the RP completed Step 2 of onboarding; `email_verified` / `phone_verified` flags live on the `users` row.
