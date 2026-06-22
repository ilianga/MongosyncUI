# MongosyncUI

A local web UI for managing MongoDB cluster-to-cluster migrations via mongosync.

## Tech Stack

- **Next.js 14+** (App Router) — full-stack framework
- **TypeScript** — throughout
- **Tailwind CSS + shadcn/ui** — styling and components
- **recharts** — charts
- **react-hook-form + zod** — form handling and validation
- **better-sqlite3** — local database
- **nanoid** — ID generation

## Project Structure

```
src/
  app/                    # Next.js App Router pages
    page.tsx              # Dashboard (list migrations)
    migrations/
      new/page.tsx        # New migration form
      [id]/page.tsx       # Migration detail + charts
    settings/page.tsx     # Settings page
    api/                  # API routes
      migrations/         # CRUD + actions (start, pause, resume, commit, reverse)
      metrics/            # Metric queries for charts
      settings/           # Settings CRUD
      mongosync/          # Binary detection, version check
  lib/
    db.ts                 # SQLite setup + queries
    process-manager.ts    # Spawn/kill mongosync processes
    poller.ts             # Poll /progress on active migrations
    config-generator.ts   # Generate YAML configs + /start bodies
    types.ts              # Shared TypeScript types
  components/
    ui/                   # shadcn/ui components
    migration-card.tsx    # Dashboard migration card
    migration-form.tsx    # New migration form
    metrics-charts.tsx    # recharts charts
    logs-panel.tsx        # Log viewer
    state-badge.tsx       # State badge with colors
    action-buttons.tsx    # State-aware action buttons
```

## Data Directory

All runtime data lives in `~/.mongosync-ui/`:
- `data.db` — SQLite database
- `configs/` — generated YAML config files
- `logs/` — mongosync log output directories

## Commands

```bash
npm install          # Install dependencies
npm run dev          # Start dev server (localhost:3000)
npm run build        # Production build
npm run start        # Start production server
npm run lint         # Lint with ESLint
```

## Key Design Decisions

- **Simplicity first** — minimal config, sensible defaults, single command to run
- **No WebSockets** — client polls API every 5s for live updates
- **No daemon** — polling only runs while Next.js server is running
- **No auth** — personal tool, localhost only
- **SQLite** — zero-config persistence, no extra services
- **One mongosync process per migration** — each on its own port (auto-assigned from 27182)

## Mongosync API

The UI proxies commands to mongosync's HTTP API. Key endpoints:
- `POST /api/v1/start` — start sync with full config
- `POST /api/v1/pause` — pause running sync
- `POST /api/v1/resume` — resume paused sync
- `POST /api/v1/commit` — finalize cutover
- `POST /api/v1/reverse` — reverse sync direction
- `GET /api/v1/progress` — get current state + metrics

## Mongosync States

`IDLE -> RUNNING -> PAUSED (optional) -> COMMITTING -> COMMITTED -> REVERSING (optional) -> RUNNING`

## Conventions

- Keep files small and focused
- Use server actions for mutations where natural, API routes for polling/streaming
- Zod schemas are the source of truth for form validation and types
- No unnecessary abstractions — direct function calls over class hierarchies
- Error handling at API boundaries only — toast user-facing errors
