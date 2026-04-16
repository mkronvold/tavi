# Views Guide

Saved views store the workspace layout you already built in the browser so you can come back to it later without rebuilding the same search and grouping state.

## What a saved view remembers

Saved views currently persist:

1. Search text
2. `Group by`
3. Task `Status` filters
4. Task `Assignee` filters
5. Collapsed group defaults
6. Expanded project defaults

Saved views do not store theme, panel open or closed state, bulk-action preference, or other browser-local settings from [`SETTINGS.md`](./SETTINGS.md).

## Save a new view

1. Set the workspace exactly how you want it.
2. Open the `View` panel.
3. Enter a name in `View name`.
4. Select `Save new`.

Example names:

- `Sprint review`
- `Blocked work`
- `High-priority owner sweep`

## Load, update, rename, or delete a view

1. Open the `View` panel.
2. Choose a saved item from `My view`.
3. Use one of the actions:
   - `Update` saves the current workspace state back into the selected view.
   - `Rename` changes only the view name.
   - `Delete` removes the saved view.
   - `History` opens the audit trail for that saved view.

## Return to the unsaved workspace

Choose `Current workspace` in `My view` to stop applying a saved view. This does not delete anything; it simply leaves you in the current unsaved state.

## Non-obvious behavior

1. `Update` changes the selected view contents without changing its name.
2. `Rename` is disabled until the name actually changes.
3. Saved views are personal in this build. Other users do not see them.
