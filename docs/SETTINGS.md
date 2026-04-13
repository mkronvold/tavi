# Settings Guide

The `Settings` panel controls browser-local preferences and gives you access to auth history and local-account management entry points.

## Settings available today

| Setting | What it changes |
| --- | --- |
| Local Accounts | Opens the local-auth management panel |
| Theme | Switches between light and dark mode |
| Auto Collapse | Expands one project at a time by collapsing the rest automatically |
| Bulk Actions | Shows task selection checkboxes and the bulk action bar |
| Full Width | Lets the workspace use the full browser width |
| My Auth History | Opens the login and auth event history for the current signed-in identity |
| Clear Local Storage | Removes only tavi-owned browser preferences |
| Version | Shows the current app version and repository link |

## Recommended use

1. Turn on `Auto Collapse` when you want only one project open during a live review.
2. Turn on `Bulk Actions` before doing large task cleanups.
3. Turn on `Full Width` when project titles, notes, or dense task tables need more horizontal space.
4. Use `Theme` and `Clear Local Storage` as personal browser choices; they do not affect other users.

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

It does not delete projects, tasks, imports, or accounts.

## Non-obvious behavior

1. Saved views are not the same as browser-local settings. Resetting local storage does not delete saved views from the server.
2. `My Auth History` is for the current user identity, not a full system-wide audit report.
