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
├── app/                    # Routes (pages, layouts, route handlers)
│   ├── guide/              # Onboarding/help pages
│   ├── docs/               # Embedded docs viewer
│   └── v2/                 # New marketplace surface (active build)
├── components/
│   ├── ui/                 # Reusable primitives (Button, Input, Dialog, ...)
│   ├── upnow/              # Brand-specific composite components
│   ├── landing/            # Marketing page sections
│   ├── docs/               # Doc page chrome
│   └── guide/              # Guide page chrome
├── contexts/               # React contexts (auth, theme, ...)
├── data/                   # Static seed/mock data + content JSON
├── lib/                    # API client, fetchers, utils, query keys
└── types/                  # Shared TS types (mirror backend DTOs)
```

## Roles → primary surfaces

| Role | Where they live in the app |
|---|---|
| Customer (tenant + service buyer) | `app/v2/` (browse, book, dashboard) |
| Rental Provider (RP) | `app/v2/dashboard/rp/` |
| Asset Manager (AM) | `app/v2/dashboard/am/` |
| Service Provider (SP) | `app/v2/dashboard/sp/` |
| Technician | `app/v2/dashboard/tech/` |
| Admin / Super Admin | `app/v2/dashboard/admin/` |

(Create folders as you build the surfaces — they're not all scaffolded yet.)

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

### Open next task — Unified Document Hub (CID-328-FE)

See BACKLOG.md Sprint 4 for the full spec. Short version:
- New page: `/dashboard/customer/documents`
- Section A: Identity/KYC (all customers)
- Section B: Rental docs (only when active tenancy/lead exists)
- Section C: Free-form uploads
- `RentalDocumentsCard` becomes a compact status chip + "Manage Documents →" link
- `TenancyJourneyPanel` Step 3 becomes a link to this page, no inline upload
