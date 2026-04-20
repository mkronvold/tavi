# Development Troubleshooting

Use this guide as the first stop when changing core product behavior, especially for schema, status-model, rollup, import, or workspace UI work.

## Canonical validation commands

Run these from the repository root:

1. `corepack pnpm lint`
2. `corepack pnpm typecheck`
3. `corepack pnpm build`

Useful focused commands from the status-model change:

1. `corepack pnpm --filter @tavi/api prisma:generate`
2. `corepack pnpm --filter @tavi/api exec jest src/project-rollup.spec.ts src/notification-events.service.spec.ts src/tasks.service.spec.ts src/imports.service.spec.ts src/saved-views.service.spec.ts src/workspace.service.spec.ts --runInBand`
3. `corepack pnpm --filter @tavi/web exec vitest run src/App.test.tsx src/ImportPanel.test.tsx`

## Build-order gotchas

### Shared schema changes

If you change `packages/schemas/src/index.ts`, rebuild `@tavi/schemas` before trusting downstream type errors:

1. `corepack pnpm --filter @tavi/schemas build`
2. `corepack pnpm typecheck`

The API, web app, and worker all consume generated declarations from the built package. If you skip the schemas build, you can end up chasing stale type unions.

### Prisma schema changes

If you change `apps/api/prisma/schema.prisma`, regenerate Prisma before reading API type errors:

1. `corepack pnpm --filter @tavi/api prisma:generate`
2. `corepack pnpm typecheck`

API build also regenerates Prisma, but running generation directly is faster during iteration.

## Status-model lessons learned

The task/project status model is cross-cutting. A status change is not just a UI label update.

### Files that must stay aligned

- `packages/schemas/src/index.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/prisma/migrations/...`
- `apps/api/src/project-rollup.ts`
- `apps/api/src/saved-view-state.ts`
- `apps/api/src/backups.service.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/App.css`
- `apps/worker/src/loop-import-worker.ts`
- `apps/worker/src/notification-worker.ts`

### Live model vs legacy compatibility

Current live task/project status order:

1. `not_started`
2. `in_progress`
3. `demo`
4. `review`
5. `done`
6. `blocked`
7. `on_hold`
8. `canceled`

Do not reintroduce live task writes with `todo`. `todo` is now a legacy read alias only.

Places where old `todo` can still appear and must be translated intentionally:

- saved view JSON from older versions
- backup snapshots from older versions
- imported CSV status normalization
- old audit history payloads or tests

Personal ToDo items are separate and still use `todo` / `done`.

### Rollup duplication

Project rollup logic exists in more than one place:

- API canonical rollup: `apps/api/src/project-rollup.ts`
- worker import recalc path: `apps/worker/src/loop-import-worker.ts`

If you change derived-status rules, update both. If you only change one, imported data and normal workspace mutations will disagree.

### Counter naming trap

The persisted/API field `taskTodoCount` still exists for compatibility, but it now counts `not_started` tasks. Do not rename it casually without auditing backups, worker export paths, web types, and tests.

## Workspace UI gotchas

### Keep one status option source

The workspace has multiple status controls:

- project override select
- add-task status select
- task edit status select
- bulk task status select
- project status filter
- group-by-status headings

Use shared option arrays and shared label formatting instead of hand-maintained repeated `<option>` blocks.

### Group-by-status order is explicit

Status grouping order is intentionally fixed in the web app. Do not rely on map insertion order or lexical sorting. Keep the status option list and the group sorting helper aligned.

### Collapsing a project must cancel task edit

The correct place to enforce this is the shared project expansion/collapse path in `setProjectExpanded()` inside `apps/web/src/App.tsx`, not just one button handler. That covers:

- direct manual collapse
- auto-collapse when another project opens
- future callers that reuse the same helper

### Task chips need label formatting

Task rows should render `formatStatusLabel(task.status)`, not the raw enum. This was an easy regression because project pills were already formatted while task pills initially were not.

## Notification and email gotchas

Notification formatting has its own human-label mapping in `apps/worker/src/notification-worker.ts`. If you add or rename statuses, update email formatting there too or notification text will fall back to raw enum strings.

Immediate notification rules also depend on status transitions in `packages/schemas/src/index.ts`. If you change what counts as resumed, reopened, blocked, or on-hold behavior, audit the notification helpers in the shared schema package.

## Test-suite gotchas

### Vitest worker-fork failures

A failed `vitest run src/App.test.tsx` is not always an assertion failure. During this change, one stale shell showed:

- `[vitest-pool]: Worker forks emitted error`
- `Worker exited unexpectedly`
- `Timeout terminating forks worker`

That run was runtime noise from an old shell, not a current product failure. Always inspect the actual failure markers before assuming the latest code is broken.

### Prefer focused reruns after broad failures

When web tests fail after a large UI/status change:

1. rerun `src/App.test.tsx` and any directly related spec
2. inspect failing expectations for label-case changes (`Done` vs `done`, `Not Started` vs `todo`)
3. verify whether the problem is a real assertion, a stale shell, or a worker-pool timeout

### Common expectation drift during status changes

Expect to update tests for:

- visible labels (`Not Started`, `In Progress`, `Cancelled`)
- audit history text (`Not Started -> In Progress`)
- grouped headings (`Done` instead of `done`)
- default select values (`not_started` instead of `todo`)
- old fixtures that still use the legacy task enum

## Docs sync checklist

When status behavior changes, update at least:

1. `docs/WORKSPACE.md`
2. `docs/DESIGN.md`
3. `docs/ARCHITECTURE.md`
4. `docs/README.md`

User-facing docs should explain visible ordering and rollup behavior. Technical docs should capture storage quirks, migration behavior, and compatibility aliases.

## Status-model change summary

The recent status-model update added `demo` and `review`, renamed live task `todo` usage to `not_started`, added fixed workspace status ordering, updated project rollup precedence, and canceled inline task edits when their parent project collapses.
