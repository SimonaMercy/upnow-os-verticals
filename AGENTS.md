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
