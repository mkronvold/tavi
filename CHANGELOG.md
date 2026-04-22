# Changelog

This file records the versions released in repository history. Dates reflect the release commit date currently present in git history.

## Unreleased

## 0.9.9 - 2026-04-22

- Renamed local-account `Reset Defaults` to `Restore Defaults` and added an admin-only `Clear all local accounts` action that requires the current password and preserves the signed-in account plus guest access.
- Fixed the Personal ToDo drag-and-drop reorder flow so browser-cleared drag state no longer leaves the page in a white-screen crash state.
- Updated assignee filtering so matching projects stay visible with their full task list instead of hiding sibling tasks that do not match the selected assignee.

## 0.9.8 - 2026-04-21

- Added guest access for local auth, including a login-screen `View as guest` path that auto-creates or repairs the dedicated `guest@tavi.local` viewer account.
- Added an admin `Guest Access` toggle in Settings and persisted the workspace-wide flag in `EmailSettings` with a Prisma migration.
- Hid guest-only restricted UI surfaces and blocked guest access to saved views, Personal ToDo, profile edits, and related user settings APIs so guest sessions stay read-only.

## 0.9.7 - 2026-04-21

- Redacted embedded SMTP passwords anywhere `SMTP_URL` reaches the web UI so admin diagnostics never display the raw secret.
- Masked SMTP credentials in test-email error banners, audit-notification rows, and copied notification-flow text while leaving the rest of the connection string visible for troubleshooting.

## 0.9.6 - 2026-04-21

- Consolidated outbound SMTP configuration around a single `SMTP_URL` connection string that now carries protocol, host, port, and optional credentials.
- Updated the API and worker mail transports to parse SMTP authentication directly from `SMTP_URL` and aligned the test-email diagnostics with the new configuration model.
- Moved Kubernetes SMTP examples to secret-backed `SMTP_URL` values and refreshed the Docker runtime examples and docs to match the new secret-based SMTP wiring.

## 0.9.5 - 2026-04-21

- Added a pinned `cloudnative-pg-install/` kustomization for the `infra/k8s/k8s-with-replicas-and-internal-ha-db/` variant and a root HA stack `kustomization.yaml` so CloudNativePG setup and the rest of the HA manifests are applied in the documented two-step flow.
- Updated Kubernetes deployment documentation to explain the CNPG operator install order, verification commands, and the cluster-scoped permissions required by the HA variant.
- Added project-search links to notification email bodies and synced the worker runtime env wiring so notification emails use the configured `SMTP_FROM`, `SMTP_URL`, and `TAVI_HOME_URL` values in Docker and Kubernetes deployments.

## 0.9.4 - 2026-04-20

- Buffered non-admin project and task notifications so users receive one hourly summary email, or one daily digest if they prefer daily delivery.
- Replaced the profile `Daily Digest` toggle with a `Notification Rate` selector and restricted daily send times to hourly values.
- Normalized legacy digest times in auth and backup flows, and filtered internal batched notification records out of the admin audit-notifications view.
- Release commit: `fc1cf2d`

## 0.9.3 - 2026-04-20

- Added `Demo` and `Review` workflow statuses, renamed `ToDo` to `Not Started`, and updated derived project-status rollups to match the new status model.
- Updated workspace filters, imports, saved views, and rollup behavior to support the new project and task statuses.
- Added `docs/DEVGUIDE.md` and refreshed the workspace, design, and architecture documentation around the updated status model.
- Release commit: `e9d79ab`

## 0.9.2 - 2026-04-20

- Refreshed product and operator documentation across architecture, design, settings, notifications, import/export, branding, and workspace guides.
- Consolidated the written guidance shipped alongside the current 0.9.x feature set.
- Release commit: `3f51ef2`

## 0.9.1 - 2026-04-20

- Polished the settings experience by tightening the audit-notification expander, removing duplicate email controls from audit changes, and refining CSV import panel copy and spacing.
- Made new-task notes multiline and expandable in the inline workspace add-task flow.
- Added corresponding web and audit test coverage for the settings and import/export refinements.
- Release commit: `df8b27f`

## 0.9.0 - 2026-04-20

- Added the retention settings panel for backup, login-log, change-log, and notification retention, including estimated sizes and prune-now actions.
- Added server-backed user configuration with browser sync, reset support, backup/restore coverage, and personal to-do retention preferences.
- Added forgot-password email reset, workspace search clear, project search-link copy, and additional workspace reset and rollup polish.
- Release commit: `e268952`

## 0.3.8 - 2026-04-18

- Expanded the prebuilt Docker runtime documentation and added `infra/docker/compose-prod.env.example` for published-image local runs.
- Refined the `compose-prod` workflow and supporting documentation for image-based deployments.
- Release commit: `0f69465`

## 0.3.7 - 2026-04-18

- Split the source-mounted development stack and published-image runtime into `compose-dev.yaml` and `compose-prod.yaml`.
- Tightened local-account administration behavior and updated scripts and deployment docs to match the new compose layout.
- Release commit: `e747d23`

## 0.3.6 - 2026-04-18

- Replaced the external local-auth seed script with an API-managed bootstrap service for default local users.
- Added bootstrap-focused API tests and simplified the deployment and local-account documentation around startup seeding.
- Release commit: `ac85100`

## 0.3.5 - 2026-04-18

- Added one-shot local admin seeding helpers for Docker and Kubernetes startup flows.
- Documented seeded local account setup and bootstrap behavior for source and deployed environments.
- Release commit: `5d491a3`

## 0.3.4 - 2026-04-17

- Switched the web image to a static production-serving path with `serve-dist.mjs`.
- Updated Docker, Kubernetes, and README guidance for the production web runtime.
- Release commit: `200d9e7`

## 0.3.3 - 2026-04-17

- Aligned package and container version metadata across the monorepo after the 0.3.2 deployment changes.
- Refreshed the Docker build files to ship the matching release version consistently.
- Release commit: `98f1aa5`

## 0.3.2 - 2026-04-17

- Hardened Docker and Kubernetes manifests for the API, web, and worker services.
- Improved rendered markdown handling for notes and tightened notification, backup, and personal to-do behavior around the deployment updates.
- Release commit: `a5daed8`

## 0.3.1 - 2026-04-16

- Added the Personal ToDo experience across the API and web app, including reminders, settings, and workspace integration.
- Expanded local account administration, notification behavior, and workspace polish, and refreshed the related documentation.
- Release commit: `5c2f2ad`

## 0.3.0 - 2026-04-13

- Initial shipped Tavi release with project and task management, CSV imports, audit history, local account administration, saved views, and broader UX polish.
- Established the first documented release baseline for the repository.
- Release commit: `da1290f`
