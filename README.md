# UpNow Frontend

UAE dual marketplace web client (rentals + home services). Next.js 15 (App Router) · React 19 · TypeScript · Tailwind v4.

## Quick start

```bash
cp .env.example .env.local    # already points at the staging API
npm ci
npm run dev                   # http://localhost:3000
```

Sign in with the staging account you were given (`…@staging.com`). The API
(NestJS, separate private repo) is not part of this repository; the frontend
talks to it over HTTP only, at `NEXT_PUBLIC_API_URL`.

## Working in this repository

- Branch from `main`, commit, push, open a pull request here. Do not push to `main` directly.
- Keep changes inside this repo's scope: UI, components, pages, styles, e2e specs.
  If a change needs a new or changed API endpoint, describe it in the PR; the API is
  built on the other side.
- Paths like `../upnow-backend`, `../docs` or `../Mockups` in AGENTS.md refer to the
  main monorepo and are not available here.
- `main` is synced both ways with the main repository (`git subtree`), so your commits
  keep their author and message when they land there.

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
