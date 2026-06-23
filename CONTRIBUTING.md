# Contributing to MongosyncUI

Thanks for your interest in improving MongosyncUI! This guide covers local setup,
how to run the checks, and the pull-request flow.

## Prerequisites

- **Node.js 20+** and npm (npm ships with Node).
- For running the app against real clusters: a `mongosync` binary on your `PATH`,
  `mongosh`, and `tmux` (see the [README](./README.md#prerequisites)). These are not
  needed just to build, lint, or run the unit tests.

## Setup

```bash
git clone https://github.com/ilianga/MongosyncUI.git
cd MongosyncUI
npm install
npm run dev          # http://localhost:3000
```

Optional: copy `.env.example` to `.env.local` and adjust (see
[Configuration](./README.md#configuration)).

## Checks

Run these before opening a PR — CI runs the same ones (minus the tmux integration suite):

```bash
npm run lint         # ESLint
npm run test:ci      # Unit tests (excludes the tmux integration suite)
npm run build        # Production build
```

Other test commands:

```bash
npm test             # Full suite, including the tmux integration tests
npm run test:integration   # Only the integration suite (requires tmux + spawns real processes)
npm run test:watch   # Watch mode
```

> The supervision **integration** suite (`src/lib/__tests__/supervision.integration.test.ts`)
> needs `tmux` and spawns real wrapper processes, so it is excluded from CI and from
> `npm run test:ci`. Run it locally when touching supervision/process-management code.

## Code style

- **Keep files small and focused.** Prefer direct function calls over class hierarchies;
  avoid unnecessary abstractions.
- **Zod schemas are the source of truth** for form validation and shared types — derive
  TypeScript types from the schema rather than duplicating shapes.
- **Handle errors at the boundaries** (API routes / server actions) and surface
  user-facing failures as toasts; don't swallow errors deep in the call stack.
- Use server actions for mutations where natural, and API routes for polling/streaming.
- Match the existing TypeScript + Tailwind + shadcn/ui conventions already in the tree.

## Pull-request flow

1. Fork (or branch) off `master`.
2. Make focused commits with clear messages.
3. Ensure `npm run lint`, `npm run test:ci`, and `npm run build` all pass.
4. Open a PR against `master` and fill in the PR template.
5. CI must be green before merge.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE).
