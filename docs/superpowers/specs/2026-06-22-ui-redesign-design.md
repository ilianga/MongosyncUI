# MongosyncUI Redesign — Design Spec

**Goal:** Make the UI look and feel professionally designed and seamless with the MongoDB product family, using a "control-room / observability" aesthetic. **Presentation-only** — no API, data-flow, or behavior changes; all 41 existing tests must stay green.

**Direction (approved):** Control-room mood · MongoDB LeafyGreen brand colors · spring-green accent · dark by default with a polished light theme · full redesign (app shell + every page + tasteful motion).

## 1. Brand palette (MongoDB LeafyGreen — authoritative hex)

```
black   #001E2B   white  #FFFFFF
gray:   dark4 #112733  dark3 #1C2D38  dark2 #3D4F58  dark1 #5C6C75
        base  #889397  light1 #C1C7C6 light2 #E8EDEB  light3 #F9FBFA
green:  dark3 #023430  dark2 #00684A  dark1 #00A35C  base #00ED64
        light1 #71F6BA light2 #C0FAE6 light3 #E3FCF7
blue:   dark2 #083C90  dark1 #1254B7  base #016BF8  light1 #0498EC  light2 #C3E7FE
purple: dark2 #5E0C9E  base #B45AF2  light2 #F1D4FD
yellow: dark2 #944F01  base #FFC010  light2 #FFEC9E
red:    dark2 #970606  base #DB3030  light1 #FF6960  light2 #FFCDC7
```

## 2. Token mapping (override `src/app/globals.css` CSS variables; keep variable names)

**Dark `.dark` (default):**
- `--background` #001E2B · `--card`/`--popover` #112733 · raised panels #1C2D38
- `--foreground` #F9FBFA · `--muted` #1C2D38 · `--muted-foreground` #889397
- `--border` #3D4F58 (use /60 alpha for subtle) · `--input` #3D4F58 · `--ring` #00ED64
- `--primary` #00ED64 · `--primary-foreground` #001E2B (black text on green)
- `--secondary` #1C2D38 · `--secondary-foreground` #E8EDEB · `--accent` #023430 · `--accent-foreground` #C0FAE6
- `--destructive` #FF6960
- `--sidebar` #001E2B (or #0A2530) · `--sidebar-foreground` #C1C7C6 · `--sidebar-primary` #00ED64 · `--sidebar-accent` #112733 · `--sidebar-border` #1C2D38
- charts: `--chart-1` #00ED64 · `--chart-2` #016BF8 · `--chart-3` #B45AF2 · `--chart-4` #FFC010 · `--chart-5` #00A35C

**Light `:root`:**
- `--background` #F9FBFA · `--card`/`--popover` #FFFFFF · `--foreground` #001E2B
- `--muted` #E8EDEB · `--muted-foreground` #5C6C75 · `--border`/`--input` #E8EDEB · `--ring` #00684A
- `--primary` #00684A · `--primary-foreground` #FFFFFF (forest green; spring-green reserved for fills/status to keep contrast) · `--secondary` #E8EDEB · `--accent` #E3FCF7 · `--accent-foreground` #00684A
- `--destructive` #DB3030
- `--sidebar` #FFFFFF · `--sidebar-foreground` #3D4F58 · `--sidebar-primary` #00684A · `--sidebar-accent` #F9FBFA · `--sidebar-border` #E8EDEB
- charts: same hues as dark (#00684A/#016BF8/#B45AF2/#944F01/#00A35C for contrast on light)

`--radius` 0.5rem. Keep Geist Sans (UI) + **Geist Mono** for metrics/URIs/IDs.

## 3. App shell (new) — `src/app/layout.tsx` + a `Sidebar`/`Topbar` component
- **Left sidebar** (fixed, ~240px, collapses to icons under `md`): MongoDB leaf glyph + "MongosyncUI" wordmark; nav items Migrations / New Migration / Settings with an active-state pill (green left-bar + tinted bg); pinned footer chip showing mongosync version + binary OK/missing dot; **theme toggle**.
- **Topbar** (sticky): page title, optional breadcrumb, primary action button (e.g. "New Migration"), and a global live indicator `● N running` (pulsing green dot) derived from the migrations list.
- Content max-width container with comfortable padding; subtle page-enter fade.

## 4. Status system — `state-badge.tsx` + a shared `StatusDot`
Dot + label, LeafyGreen semantics: RUNNING #00ED64 (pulsing) · PAUSED #FFC010 · COMMITTING #016BF8 (pulsing) · COMMITTED #00A35C · REVERSING #B45AF2 (pulsing) · IDLE #889397. Badges: tinted bg + colored text/dot, mono-uppercase label.

## 5. Per-page treatment
- **Dashboard (`page.tsx`, `migration-card.tsx`):** redesigned cards — header row (mono `src → dst` with arrow, status badge), animated progress bar with % and copied/total bytes, a compact stat row (lag · events · ping), port/PID in muted mono, action buttons. Designed **empty state** (leaf glyph, headline, "New Migration" CTA). **Skeleton** loaders while fetching. Responsive grid.
- **New Migration (`migration-form.tsx` + fields):** grouped sections with headers/dividers, mono URI inputs with inline Test → status pill (reachable/version/error), polished Switches/Slider/Collapsibles, sticky submit bar; the reverse+filter warning as a branded Alert.
- **Detail (`migrations/[id]/page.tsx` + panels):** sticky header (name, status badge, direction, actions); **stat tiles** grid (copy %, lag, events, oplog window, ping, CEA); LeafyGreen-themed recharts (area/line with green gradient fills, muted grid, mono ticks, themed tooltip); refined verification panel (per-cluster, progress sub-bars); **terminal-styled** logs panel (mono, dark, stdout/stderr toggle, download).
- **Settings (`settings/page.tsx`):** grouped cards with section descriptions, the binary field + live version check (auto-test on save already in place), data-dir display in mono.

## 6. Motion & finish
Subtle only: card hover lift + border-accent; section/page fade-in (≤200ms); animated progress-bar fills; pulsing live dots (CSS keyframes, `prefers-reduced-motion` respected); sonner toasts already slide. Both themes fully polished and contrast-checked (WCAG AA for text).

## 7. Constraints
- No changes to API routes, lib logic, types, or component **props/data flow** — styling, structure, and new presentational components only.
- shadcn/ui (base-ui) components remain the primitives; add a few presentational wrappers (Sidebar, Topbar, StatusDot, Skeleton, EmptyState, Stat tile).
- `npm run build` green and `npm test` 41/41 throughout. Verify final result by running the app and screenshotting key pages in both themes.
