# Settings Guide

The `Settings` panel is the control hub for browser-local preferences, user-specific backend settings, and admin-only controls. It also launches the dedicated `Import/Export`, `Backups`, local-account, and audit panels.

## Layout

Settings are grouped in this order:

1. Browser-local controls first.
2. User-specific backend settings second.
3. Admin-only controls last.

Most launcher cards and audit cards are whole-card click targets. If a card opens another panel, that panel also has an explicit `Close` button in its header.

## Settings available today

| Section | Setting | What it changes |
| --- | --- | --- |
| Browser-local | Theme | Switches between light and dark mode |
| Browser-local | Auto Collapse | Expands one project at a time by collapsing the rest automatically |
| Browser-local | Bulk Actions | Shows task selection checkboxes and the bulk action bar |
| Browser-local | Full Width | Lets the workspace use the full browser width |
| User-specific | Daily Digest | Replaces immediate non-admin email notifications for the current user with one daily digest email |
| Browser-local | Clear Local Storage | Removes only tavi-owned browser preferences after confirmation |
| Browser-local | My Auth History | Opens the login and auth event history for the current signed-in identity |
| Admin-only | Email Notifications | Controls the global outbound email switch |
| Admin-only | Daily Digest Time | Sets the shared digest send time in server local time |
| Admin-only | Backups | Opens the dedicated backup and restore panel |
| Admin-only | Import/Export | Opens the dedicated import and export panel |
| Admin-only | Local Accounts | Opens the local-auth management panel |
| Admin-only | Audit Logins | Opens system-wide sign-in audit history |
| Admin-only | Audit Changes | Opens system-wide change audit history |
| Meta | Version | Shows the current app version and repository link |

## Recommended use

1. Turn on `Auto Collapse` when you want only one project open during a live review.
2. Turn on `Bulk Actions` before doing large task cleanups.
3. Turn on `Full Width` when project titles, notes, references, or dense task tables need more horizontal space.
4. Turn on `Daily Digest` if you want one scheduled summary email instead of immediate task and project update emails.
5. Use the `Import/Export` and `Backups` launcher cards when you need data-management tools without keeping those panels open all the time.

## Local Accounts entry point

`Local Accounts` opens the dedicated account-management panel documented in `LOCAL_ACCOUNTS.md`.

Behavior depends on role:

1. Admins can manage all local accounts.
2. Non-admins only get self-service password controls.

## Clear Local Storage

`Clear Local Storage` removes only tavi browser state, including:

1. Theme
2. Auto Collapse
3. Bulk Actions
4. Full Width
5. Panel open or closed state
6. Per-project `Add Task` visibility

It does not delete projects, tasks, imports, backups, or accounts.

## Related panels launched from Settings

1. `IMPORT_EXPORT.md` covers exports, CSV import staging, import review, and workspace reset.
2. `BACKUPS.md` covers scheduled backups, backup-now, upload, restore, download, and delete.
3. `LOCAL_ACCOUNTS.md` covers local-auth account management.
4. `AUDIT_HISTORY.md` covers audit timelines and filters.

## Non-obvious behavior

1. Saved views are not the same as browser-local settings. Resetting local storage does not delete saved views from the server.
2. `My Auth History` is for the current user identity, not a full system-wide audit report.
3. `Daily Digest` applies only to non-admin notification emails. Administrative account emails still send immediately when global email is enabled.
4. Admin-only email controls do not force users into digest mode. Each user still chooses whether non-admin notifications arrive immediately or in the daily digest.
