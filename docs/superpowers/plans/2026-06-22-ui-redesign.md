# MongosyncUI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle MongosyncUI into a professional "control-room" UI that matches MongoDB's LeafyGreen brand, with an app shell, redesigned pages, themed charts, and tasteful motion — presentation only.

**Architecture:** Retheme the existing shadcn/Tailwind-v4 CSS-variable system to MongoDB's exact LeafyGreen palette, add a sidebar+topbar app shell, introduce a few presentational primitives (StatusDot, Skeleton, EmptyState, Stat), and restyle each page/component against that system. No API, lib, type, or props/data-flow changes.

**Tech Stack:** Next.js 16 (App Router), Tailwind v4 (CSS-based config), shadcn/ui on @base-ui, recharts v3, sonner, next-themes, Geist Sans + Geist Mono.

## Global Constraints

- **Presentation only.** No changes to `src/app/api/**`, `src/lib/**` (logic/types), or any component's **props/data-flow**. Styling, JSX structure, and new presentational components/files only.
- **Regression gate every task:** `npm run build` succeeds AND `npm test` reports **41/41 passing**. (The existing suite is the regression guard; this plan adds no unit tests.)
- **Brand palette is authoritative (LeafyGreen hex):** black `#001E2B`; gray dark4 `#112733` / dark3 `#1C2D38` / dark2 `#3D4F58` / dark1 `#5C6C75` / base `#889397` / light1 `#C1C7C6` / light2 `#E8EDEB` / light3 `#F9FBFA`; green dark3 `#023430` / dark2 `#00684A` / dark1 `#00A35C` / base `#00ED64` / light1 `#71F6BA` / light2 `#C0FAE6` / light3 `#E3FCF7`; blue base `#016BF8`; purple base `#B45AF2`; yellow base `#FFC010`; red base `#DB3030` / light1 `#FF6960`.
- **Status semantics:** RUNNING `#00ED64` (pulse) · PAUSED `#FFC010` · COMMITTING `#016BF8` (pulse) · COMMITTED `#00A35C` · REVERSING `#B45AF2` (pulse) · IDLE `#889397`.
- **Dark is the default theme**; light theme fully polished. Respect `prefers-reduced-motion`. Text contrast ≥ WCAG AA.
- Keep Geist Sans for UI; **Geist Mono for metrics, URIs, IDs, ports, PIDs**.
- Verify visually: run the app and screenshot the changed page in **both** themes before marking a task done.

---

### Task 1: Brand tokens + styling foundation

**Files:**
- Modify: `src/app/globals.css` (replace `:root` and `.dark` token blocks; add keyframes + helpers)
- Modify: `src/components/theme-provider.tsx` (default theme → dark)

**Interfaces:**
- Consumes: nothing
- Produces: the full LeafyGreen token set on `--background/--foreground/--card/--popover/--primary/--secondary/--muted/--accent/--border/--input/--ring/--destructive/--sidebar*/--chart-1..5`; utility animations `animate-pulse-dot`, `animate-fade-in`; `--radius: 0.5rem`.

- [ ] **Step 1: Replace the light `:root` token block** in `globals.css` with LeafyGreen light values:
  `--background:#F9FBFA; --foreground:#001E2B; --card:#FFFFFF; --card-foreground:#001E2B; --popover:#FFFFFF; --popover-foreground:#001E2B; --primary:#00684A; --primary-foreground:#FFFFFF; --secondary:#E8EDEB; --secondary-foreground:#001E2B; --muted:#E8EDEB; --muted-foreground:#5C6C75; --accent:#E3FCF7; --accent-foreground:#00684A; --destructive:#DB3030; --border:#E8EDEB; --input:#E8EDEB; --ring:#00684A; --chart-1:#00684A; --chart-2:#016BF8; --chart-3:#B45AF2; --chart-4:#944F01; --chart-5:#00A35C; --radius:0.5rem; --sidebar:#FFFFFF; --sidebar-foreground:#3D4F58; --sidebar-primary:#00684A; --sidebar-primary-foreground:#FFFFFF; --sidebar-accent:#F9FBFA; --sidebar-accent-foreground:#00684A; --sidebar-border:#E8EDEB; --sidebar-ring:#00684A;`

- [ ] **Step 2: Replace the `.dark` token block** with LeafyGreen dark values:
  `--background:#001E2B; --foreground:#F9FBFA; --card:#112733; --card-foreground:#F9FBFA; --popover:#112733; --popover-foreground:#F9FBFA; --primary:#00ED64; --primary-foreground:#001E2B; --secondary:#1C2D38; --secondary-foreground:#E8EDEB; --muted:#1C2D38; --muted-foreground:#889397; --accent:#023430; --accent-foreground:#C0FAE6; --destructive:#FF6960; --border:#3D4F58; --input:#3D4F58; --ring:#00ED64; --chart-1:#00ED64; --chart-2:#016BF8; --chart-3:#B45AF2; --chart-4:#FFC010; --chart-5:#00A35C; --sidebar:#06212E; --sidebar-foreground:#C1C7C6; --sidebar-primary:#00ED64; --sidebar-primary-foreground:#001E2B; --sidebar-accent:#112733; --sidebar-accent-foreground:#E3FCF7; --sidebar-border:#1C2D38; --sidebar-ring:#00ED64;`

- [ ] **Step 3: Append keyframes + helpers** at the end of `globals.css`:

```css
@keyframes pulse-dot {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 currentColor; }
  50% { opacity: 0.7; box-shadow: 0 0 0 3px color-mix(in oklab, currentColor 30%, transparent); }
}
@keyframes fade-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.animate-pulse-dot { animation: pulse-dot 1.6s ease-in-out infinite; }
.animate-fade-in { animation: fade-in 0.2s ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .animate-pulse-dot, .animate-fade-in { animation: none; }
}
```

- [ ] **Step 4: Default theme to dark** — in `src/components/theme-provider.tsx`, ensure the provider passes `defaultTheme="dark"` (and keeps `enableSystem` + `attribute="class"`). If the provider hard-codes props, set `defaultTheme="dark"`.

- [ ] **Step 5: Verify** — `npm run build` (green) and `npm test` (41/41). Then `npm run dev`, screenshot `/` — the existing layout should now render in MongoDB dark colors (deep `#001E2B` bg, green accents).

- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat(ui): LeafyGreen brand tokens, dark default, motion helpers"`

---

### Task 2: App shell (sidebar + topbar)

**Files:**
- Create: `src/components/app-shell/sidebar.tsx`
- Create: `src/components/app-shell/topbar.tsx`
- Create: `src/components/app-shell/theme-toggle.tsx`
- Create: `src/components/app-shell/running-indicator.tsx`
- Modify: `src/app/layout.tsx`

**Interfaces:**
- Consumes: tokens from Task 1; `GET /api/migrations` (already exists) for the running indicator; `GET /api/mongosync/version` for the sidebar binary chip.
- Produces: `<AppShell>`-style layout — a fixed left `Sidebar`, a sticky `Topbar` (rendered per-page is unnecessary; Topbar lives in layout with a slot), and a content container. Nav links: `/` (Migrations), `/migrations/new` (New Migration), `/settings` (Settings).

- [ ] **Step 1: Sidebar** (`sidebar.tsx`, client component): fixed column `w-60` (collapses to `w-16` icon-only below `md` via responsive classes), `bg-sidebar text-sidebar-foreground border-r border-sidebar-border`. Top: MongoDB leaf glyph (inline SVG leaf in `#00ED64`) + "MongosyncUI" wordmark (`font-semibold`, hidden when collapsed). Nav: list of links using `next/navigation` `usePathname()`; active item gets `bg-sidebar-accent text-sidebar-accent-foreground` with a `before:` 2px green left bar; inactive `text-sidebar-foreground hover:bg-sidebar-accent/50`. Each link has a lucide-style inline icon (use simple inline SVGs: list, plus, settings). Footer: the binary/version chip (fetch `/api/mongosync/version`; green dot + `v1.x` if ok, red dot + "binary not found" if error) and the `ThemeToggle`.

- [ ] **Step 2: ThemeToggle** (`theme-toggle.tsx`, client): use `useTheme()` from `next-themes`; a `Button variant="ghost" size="icon"` that toggles `dark`/`light`, sun/moon inline SVG, `aria-label`. Guard against hydration mismatch with a mounted check (`useEffect` set mounted; render a neutral placeholder until mounted).

- [ ] **Step 3: RunningIndicator** (`running-indicator.tsx`, client): fetch `/api/migrations` every 5s, count migrations whose `state` is RUNNING/COMMITTING/REVERSING; render a pulsing green `StatusDot`-like dot + `N running` (mono). If zero, render muted `idle`.

- [ ] **Step 4: Topbar** (`topbar.tsx`): sticky top bar `h-14 border-b border-border bg-background/80 backdrop-blur`, flex row: left `title` prop (h1, `text-lg font-semibold`), right slot for a primary action + `<RunningIndicator/>`. Accept props `{ title: string; action?: React.ReactNode }`.

- [ ] **Step 5: Rewire `layout.tsx`** — replace the current `<header>` with: a flex row containing `<Sidebar/>` and a `min-w-0 flex-1` column. Keep `<ThemeProvider>` (dark default) and sonner `<Toaster/>`. The page content renders inside the column. Since Topbar needs a per-page title, expose it by rendering Topbar inside each page (simplest, no context) OR render a default Topbar in layout and let pages override via their own Topbar — choose: **render Topbar per page** (pages import and place `<Topbar title=... action=.../>` at top of their content). Layout provides only Sidebar + content container with `animate-fade-in`.

- [ ] **Step 6: Verify** — build green, 41/41 tests. `npm run dev`; screenshot `/`, `/migrations/new`, `/settings` — sidebar present, active nav highlighting correct, theme toggle flips light/dark, binary chip shows version. Check the `md` breakpoint collapses the sidebar to icons.

- [ ] **Step 7: Commit** — `git commit -am "feat(ui): sidebar + topbar app shell, theme toggle, running indicator"`

---

### Task 3: Status system + presentational primitives

**Files:**
- Create: `src/components/ui/status-dot.tsx`
- Create: `src/components/ui/skeleton.tsx`
- Create: `src/components/ui/empty-state.tsx`
- Create: `src/components/ui/stat.tsx`
- Modify: `src/components/state-badge.tsx`

**Interfaces:**
- Consumes: tokens from Task 1; `MongosyncState` from `@/lib/types`.
- Produces:
  - `StatusDot({ state, className? })` — a colored dot; pulses for RUNNING/COMMITTING/REVERSING.
  - `Skeleton({ className })` — `bg-muted animate-pulse rounded`.
  - `EmptyState({ icon?, title, description, action? })`.
  - `Stat({ label, value, sub?, mono? })` — a small stat tile.
  - Restyled `StateBadge` using StatusDot + tinted bg.

- [ ] **Step 1: `STATE_STYLE` map** — add to `state-badge.tsx` (or a small `src/lib/state-style.ts` constant, presentational only) mapping each `MongosyncState` to `{ text, bg, dot }` Tailwind classes using LeafyGreen hues, e.g. RUNNING → `text-[#00A35C] dark:text-[#71F6BA] bg-[#E3FCF7] dark:bg-[#023430]/60`, dot `#00ED64`; PAUSED → yellow; COMMITTING → blue; COMMITTED → green-dark1; REVERSING → purple; IDLE → gray. (Keep the existing exported `STATE_COLORS`/`availableActions` from `@/lib/state-machine` untouched — those are logic.)

- [ ] **Step 2: `StatusDot`** — `<span>` with `h-2 w-2 rounded-full` colored per state; for RUNNING/COMMITTING/REVERSING add `animate-pulse-dot` and set text color = dot color so the keyframe's `currentColor` glow matches.

- [ ] **Step 3: Restyle `StateBadge`** — render `StatusDot` + uppercase mono label inside a pill (`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium font-mono`) with the tinted bg/text from the style map. **Keep the component's props (`{ state }`) unchanged.**

- [ ] **Step 4: `Skeleton`, `EmptyState`, `Stat`** — small presentational components per the Interfaces. `Stat`: `rounded-lg border bg-card p-4`; label `text-xs text-muted-foreground`; value `text-2xl font-semibold` (mono when `mono`); optional `sub` muted. `EmptyState`: centered, optional icon in a tinted circle, title, description, action slot.

- [ ] **Step 5: Verify** — build green, 41/41. Quick visual: temporarily render the badges on `/` (or just confirm build); screenshot once cards adopt them in Task 4. Confirm StatusDot pulses for RUNNING.

- [ ] **Step 6: Commit** — `git commit -am "feat(ui): status dot, restyled badges, skeleton/empty-state/stat primitives"`

---

### Task 4: Dashboard + migration cards

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/components/migration-card.tsx`

**Interfaces:**
- Consumes: `Topbar` (Task 2), `StateBadge`/`StatusDot`/`Skeleton`/`EmptyState`/`Stat` (Tasks 2–3), `ActionButtons` (existing, unchanged props), `formatBytes` from `@/lib/format`.
- Produces: redesigned dashboard. **No data-fetching or props changes** — same `fetch('/api/migrations')` + 5s interval already in `page.tsx`.

- [ ] **Step 1: Dashboard layout** — at the top of `page.tsx` content render `<Topbar title="Migrations" action={<Link href="/migrations/new"><Button>+ New Migration</Button></Link>} />`. Body: while `loading`, render a grid of 3 `Skeleton` cards. When empty, render `<EmptyState>` with the leaf glyph, "No migrations yet", a one-line description, and the New Migration CTA. Otherwise a responsive grid `gap-4 md:grid-cols-2 xl:grid-cols-3` of `MigrationCard`s with `animate-fade-in`.

- [ ] **Step 2: MigrationCard redesign** — `Card` with `hover:border-primary/40 transition-colors`. Header: a row with mono `sourceUri → destUri` (truncate, arrow `→` in `text-primary`) and `<StateBadge state={migration.state}/>`. Middle: a progress bar — use shadcn `Progress` (or a div) filled to the card's latest known percent; since the card only has `migration` (no live metric), show the bar only when state is active and fall back to a thin track otherwise; label port/PID. Footer: `<ActionButtons migration={migration} onAction={onAction}/>` (unchanged). Keep the `<Link href={'/migrations/'+id}>` on the title. **Do not change props.**

- [ ] **Step 3: Verify** — build green, 41/41. `npm run dev`; screenshot `/` in dark and light: empty state (delete `~/.mongosync-ui/data.db` or use a fresh `MONGOSYNC_UI_DIR` if needed to see empty), and (if any rows exist) populated cards. Confirm hover lift and badge/dot styling.

- [ ] **Step 4: Commit** — `git commit -am "feat(ui): redesigned dashboard with cards, empty state, skeletons"`

---

### Task 5: New Migration form

**Files:**
- Modify: `src/components/migration-form.tsx`
- Modify: `src/components/cluster-uri-field.tsx`
- Modify: `src/components/namespace-filter-fields.tsx`
- Modify: `src/app/migrations/new/page.tsx`

**Interfaces:**
- Consumes: `Topbar` (Task 2), shadcn primitives, `Alert`. **No form-logic, schema, or props changes** — only structure/classes. The reverse+filter warning, the Test button behavior, and `formValuesToConfig` submission stay exactly as implemented.

- [ ] **Step 1: Page** — `migrations/new/page.tsx` renders `<Topbar title="New Migration"/>` then the form in a `max-w-2xl` container with `animate-fade-in`.

- [ ] **Step 2: Form sections** — wrap the existing fields in grouped `Card`-like sections with a small section header + helper text: "Connection" (name + the two cluster URI fields), "Sync options" (reversible, detectRandomId, preExisting, buildIndexes select, verification), "Namespace filtering" (collapsible), "Advanced" (load level slider, verbosity). Use consistent spacing (`space-y-6`), `Label` styling, and a sticky bottom submit bar (`sticky bottom-0 bg-background/80 backdrop-blur border-t py-3`) holding the "Create & Start Migration" button. Keep the reverse+filter `Alert` and the submit-disabled logic verbatim.

- [ ] **Step 3: ClusterUriField** — mono input; the Test button as `variant="outline"`; render the result as a small status pill (green check + `Reachable · v1.x` or red + error). Keep the existing fetch + `useEffect` clear-on-change.

- [ ] **Step 4: NamespaceFilterFields** — keep the two-row bordered layout; restyle inputs as mono, tighten spacing, style the remove "X" as a ghost icon button, and the "Add row" as a dashed `variant="outline"` button.

- [ ] **Step 5: Verify** — build green, 41/41. `npm run dev`; screenshot `/migrations/new` in both themes; toggle reversible + add a filter to confirm the warning + disabled submit still work; click Test on a bad URI to see the red pill.

- [ ] **Step 6: Commit** — `git commit -am "feat(ui): redesigned new-migration form with sections and status pills"`

---

### Task 6: Detail page + progress/verification/logs panels

**Files:**
- Modify: `src/app/migrations/[id]/page.tsx`
- Modify: `src/components/progress-panel.tsx`
- Modify: `src/components/verification-panel.tsx`
- Modify: `src/components/logs-panel.tsx`

**Interfaces:**
- Consumes: `Topbar`, `Stat`, `StateBadge`, `StatusDot`, `ActionButtons` (unchanged), `PreCommitDialog` (unchanged), `formatBytes`/`formatDuration`. **No data-flow/props changes.**

- [ ] **Step 1: Detail header** — replace the page's top header with a sticky bar: migration name + `<StateBadge/>` + mono direction (`source → dest`, using live `directionMapping` when present else the stored URIs) on the left; `<ActionButtons ... onConfirmCommit={...}/>` on the right. Keep the `PreCommitDialog` wiring and 5s polling exactly.

- [ ] **Step 2: ProgressPanel** — convert the stat cards to the shared `Stat` tiles in a responsive grid (`sm:grid-cols-2 lg:grid-cols-4`): Phase, Lag, Events, CEA, Oplog window, Source/Dest ping, Can-commit. Render the warnings as branded destructive `Alert`s. Style the copy-progress and index-building bars with the `Progress` component + mono captions. Keep all field paths (`collectionCopy.*`, `indexBuilding.*`, `directionMapping.Source/Destination`, `source/destination.pingLatencyMs`) unchanged.

- [ ] **Step 3: VerificationPanel** — two `Card`s (Source/Destination) with mono counts and small progress sub-bars for scanned/total collections and hashed/estimated docs; muted labels; keep the null-render guard.

- [ ] **Step 4: LogsPanel** — terminal aesthetic: `rounded-lg border bg-[#06212E] dark:bg-[#001017]` mono text, a header strip with stdout/stderr segmented toggle + a "Download" ghost button; keep the 5s poll + auto-scroll + download logic. Use `text-[#71F6BA]` for log lines on the dark terminal, muted timestamps if parseable (optional, no logic change).

- [ ] **Step 5: Verify** — build green, 41/41. `npm run dev`; open a detail page (create a migration if needed, even one that fails to spawn shows the header/empty panels) and screenshot in both themes; confirm stat tiles, progress bars, and terminal logs render; confirm the commit dialog still opens via the Commit button.

- [ ] **Step 6: Commit** — `git commit -am "feat(ui): redesigned detail page, progress/verification panels, terminal logs"`

---

### Task 7: LeafyGreen chart theming

**Files:**
- Modify: `src/components/metrics-charts.tsx`

**Interfaces:**
- Consumes: `Metric[]` (unchanged), recharts v3, chart tokens `--chart-1..5` from Task 1.
- Produces: brand-themed charts. **No data shape change.**

- [ ] **Step 1: Theme the recharts** — for each of the four charts (copyProgress, lagTimeSeconds, totalEventsApplied, estimatedCopiedBytes) switch to `AreaChart` with a `linearGradient` fill from the chart color to transparent; stroke = the corresponding `--chart-*` hue (copyProgress green `#00ED64`, lag yellow/red, events blue `#016BF8`, bytes purple `#B45AF2`); `CartesianGrid` stroke = `var(--border)` at low opacity; axes ticks `fontSize:10 fill:var(--muted-foreground)` in mono; custom `Tooltip` styled with `bg-popover border rounded-md text-xs` (themed, not default white). Keep `fmtTime`/`fmtLabel` and the `Metric` keys unchanged. Each chart sits in a titled `Card`.

- [ ] **Step 2: Verify** — build green, 41/41. `npm run dev`; on a detail page with some recorded metrics (let a migration run, or insert is not required — empty charts should render the "No metrics yet" state), screenshot the charts in both themes; confirm gradient fills, mono axes, themed tooltip (hover), and that colors read well on `#001E2B`.

- [ ] **Step 3: Commit** — `git commit -am "feat(ui): LeafyGreen-themed metrics charts"`

---

### Task 8: Settings + final consistency & polish pass

**Files:**
- Modify: `src/app/settings/page.tsx`
- Touch-ups across any component for cross-page consistency (spacing, headings, focus rings)

**Interfaces:**
- Consumes: everything above. **No logic/props changes** (auto-test-on-save and the version check stay).

- [ ] **Step 1: Settings layout** — `<Topbar title="Settings"/>` + `max-w-2xl` body. Keep the four `Card` groups (Binary, Process & Polling, New Migration Defaults, Data Directory) but add concise section descriptions, consistent label styling, mono for the binary path + data-dir, and keep the inline version pill + the path hint. Style the verbosity `<select>` to match inputs (bg-background, border, focus ring) so it doesn't look unstyled.

- [ ] **Step 2: Consistency sweep** — verify across all pages: consistent heading sizes, `focus-visible` ring uses `--ring` (green), button variants consistent, card padding consistent, mono used for all metrics/URIs/IDs, every active/live element uses the pulse dot, `animate-fade-in` on page bodies. Fix any stragglers (e.g. leftover gray-on-gray, default white tooltips, hard-coded old colors).

- [ ] **Step 3: Accessibility/motion check** — confirm text contrast AA in both themes for muted text on cards; confirm `prefers-reduced-motion` disables pulse/fade (the keyframes already guard this); confirm theme toggle has an `aria-label` and nav links are keyboard-focusable.

- [ ] **Step 4: Final verify** — `npm run build` green, `npm test` 41/41. `npm run dev`; screenshot **all four pages in both light and dark**. Confirm visual cohesion and that nothing regressed functionally (create-migration flow still submits; Test buttons work; commit dialog opens).

- [ ] **Step 5: Commit** — `git commit -am "feat(ui): settings redesign + final consistency and a11y polish"`

---

## Self-Review

**Spec coverage:** §1 palette → Task 1 constraints; §2 token mapping → Task 1; §3 app shell → Task 2; §4 status system → Task 3; §5 per-page (dashboard/new/detail/settings) → Tasks 4/5/6/8; charts (§5 detail) → Task 7; §6 motion/finish → Tasks 1/8; §7 constraints (presentation-only, tests green, both themes) → every task's gate. ✓ All spec sections mapped.

**Placeholder scan:** No TBD/TODO; token values and class patterns are concrete; per-page tasks specify exact structure and the unchanged logic to preserve. (Per-page restyle tasks intentionally describe structure + exact classes rather than reproducing every line of large existing JSX, since the files exist and props/logic must not change — the constraint "no props/data-flow change" bounds them precisely.)

**Type/name consistency:** New components — `StatusDot`, `Skeleton`, `EmptyState`, `Stat`, `Sidebar`, `Topbar`, `ThemeToggle`, `RunningIndicator` — are referenced consistently across tasks. `StateBadge`/`ActionButtons`/`PreCommitDialog`/`progress-panel`/`verification-panel`/`logs-panel`/`metrics-charts` keep their existing prop signatures (explicitly constrained). Token variable names match `globals.css`/`@theme inline` exactly.
