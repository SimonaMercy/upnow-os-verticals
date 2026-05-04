# UpNow Frontend

UAE dual marketplace web client (rentals + home services). Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4.

## Quick start

```bash
cp .env.example .env.local    # fill in NEXT_PUBLIC_API_URL, etc.
npm install
npm run dev                   # http://localhost:3001
```

Backend must be running on `http://localhost:3000` (see `../upnow-backend`).

## Project docs (read in this order)

1. [AGENTS.md](AGENTS.md) — project rules, conventions, folder map, workflow
2. [BACKLOG.md](BACKLOG.md) — sprint-aligned task tracker (mirrors Jira `SCRUM`)
3. `../docs/sprint-0X-srs.html` — full SRS per sprint (AC + test steps)
4. `../Mockups/upnow_platform_overview_CEO.html` — full platform overview
5. `../Mockups/*.html` — per-journey UI mockups

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev (http://localhost:3001) |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint |

## Stack

- **Framework**: Next.js 15 (App Router) + React 19
- **Styling**: Tailwind CSS v4 + `clsx` + `tailwind-merge`
- **Forms**: React Hook Form + Zod
- **Data**: TanStack Query
- **Icons**: lucide-react
- **Charts**: Recharts (admin reports)
- **Toasts**: sonner

## Project structure

See [AGENTS.md](AGENTS.md) for the full folder map and role → surface table.
