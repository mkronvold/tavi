# Workspace Guide

The workspace is the main operating surface in tavi. It is built for dense review sessions: search the full worklist, regroup the screen quickly, collapse projects you are not discussing, and edit projects or tasks inline without leaving the page.

## Main controls

| Control | What it does |
| --- | --- |
| Search | Narrows the visible workspace so you can focus on matching projects and tasks |
| Group by | Regroups projects by `None`, `Owner`, `Status`, or `Priority` |
| Sort by | Orders projects by one or more fields including `Title`, `Progress`, `Priority`, `Due Date`, `Age`, and `Last Updated` |
| Status | Multi-select project-status filter. It hides whole projects by their current display status and does not trim task rows inside matching projects |
| Assignee | Multi-select task filter for one or more assignees |
| View | Opens saved-view controls for the current search, grouping, project status filters, assignee filters, sort order, and expansion state |
| Personal ToDo | Opens the current user's private personal task panel without changing the shared workspace list |
| New Project | Opens the inline project-creation panel |
| Settings | Opens browser-local preferences, daily-digest controls, auth history, local-account entry points, and launcher cards for `Import/Export` and `Backups` |

## Working with project rows

The top search, grouping, filter, and bulk-action controls stay pinned while you scroll so review controls remain visible during long discussions. After you scroll down, a floating `To top` button appears in the lower-right corner of the browser frame so you can jump back to the top quickly.

Each project row shows the project title, notes, references, owner, due date, priority, status, and completion percentage. Expanded projects also get a highlighted border so the active discussion area is easier to track.

Project and task notes render basic markdown in place. Tavi keeps line breaks, recognizes simple lists and emphasis, and turns plain URLs into clickable links.

Project references support one line per entry. URL lines render as shortened external links, while plain-text lines stay visible as compact project metadata.

Use the row actions on the right to:

1. Expand or collapse the project.
2. Open `Add Task` to create a task directly under that project.
3. Open `History` to review project changes.
4. Open `Edit` to change title, notes, owner, priority, due date, manual status, or references in an inline row editor.
5. Use `Delete` inside project edit to remove the project from the workspace. This also removes that project's active tasks.
6. Use `Convert to Task` inside project edit to turn a taskless project into a task inside `Unassigned`. Tavi creates the `Unassigned` project automatically the first time it is needed.
7. Use `Clear override` when a manual project status is set and you want to return to the task-derived rollup.

## Working with task rows

Task rows stay directly under their parent project. Inline task editing lets editors and admins change:

1. Title
2. Assignee
3. Priority
4. Due date
5. Status
6. Notes
7. Project

Changing the `Project` field moves the task to a different project and recalculates both project rollups when you save. The last `Project` option, `Convert to Project`, turns the edited task into a new standalone project instead. The new project keeps the task title, notes, assignee as owner, due date, priority, and the closest matching project status.

When you add several tasks to the same project in a row, Tavi keeps the last assignee selection, including `None`, and the last priority selected in the add-task row so repeated entry is faster.

Use the compact `::` drag handle on the left side of each visible task row to save a manual task order for that project. Reordering is only enabled when the full task list for that project is visible, and admins can hide all drag handles globally from [`SETTINGS.md`](./SETTINGS.md).

Expanded task tables include a compact `D` toggle beside the `Status` header so you can hide or show `done` rows without changing project rollups or task data.

Use `History` on a task row when you need to confirm who changed status, assignment, or dates.

Use `Delete` inside task edit when a single task should be removed without using bulk actions.

## Personal ToDo panel

`Personal ToDo` opens a private per-user task list that does not appear in the shared project workspace.

Inside the panel you can:

1. Add a private task with only `Task name`, `Notes`, and `Due date`.
2. Reorder visible personal items with the compact drag handle.
3. Toggle completion with the checkbox and hide or show done items with the compact `D` toggle.
4. Import or export only your personal to-do list without affecting shared workspace data.
5. Delete a personal item from the panel with the `X` action.

## Bulk task actions

Bulk actions are optional and stay hidden until enabled in [`SETTINGS.md`](./SETTINGS.md).

Once enabled:

1. Select task checkboxes in the workspace table.
2. Use the bulk action bar to apply status, assignee, priority, or due-date changes to all selected tasks, or clear notes from the whole selection.
3. Use `Copy` with `Copy to project` to duplicate the selected tasks into another project without changing the original tasks. Copies keep title, notes, assignee, priority, due date, and status.
4. Use `Delete` to remove the selected tasks.
5. Use `Clear` when you want to leave bulk mode without changing data.

## Example review flow

1. Set `Group by` to `Owner`.
2. Use Search to narrow the screen to the topic under discussion.
3. Expand the active project and collapse the rest.
4. Use `Status` to narrow the project list, then `Assignee` to narrow task rows inside those matching projects.
5. Edit tasks inline as decisions are made.
6. Save the setup as a personal view if you expect to revisit the same review layout.

## Non-obvious behavior

1. A project can show both a manual override and the task-derived status. The override changes the display status, but the underlying derived rollup is still tracked.
2. `Status` filters whole projects by project display status. `Assignee` filters task rows inside the remaining visible projects.
3. `Group by`, `Sort by`, `Status`, and `Assignee` selections are stored in browser-local Tavi storage and can also be captured in a saved view.
4. `Add Task` visibility is stored in the browser, not in a saved view.
5. Auto-collapse behavior is controlled from [`SETTINGS.md`](./SETTINGS.md), not from the workspace row actions.
6. Viewer users can browse and search the workspace, cannot edit shared projects or tasks, and can still use `Personal ToDo`.
7. Project and task delete actions ask for confirmation before the workspace removes them.
8. Project-to-task conversion is only available when the source project has no active tasks, so existing task lists are never dropped silently.
9. When outbound email is enabled, saving a project emails the current project owner plus all active task assignees for that project. Saving a task emails the current task assignee plus the current project owner. Update emails include side-by-side `From:` and `To:` change blocks instead of just the edited field.
10. [`IMPORT_EXPORT.md`](./IMPORT_EXPORT.md) and [`BACKUPS.md`](./BACKUPS.md) are opened from [`SETTINGS.md`](./SETTINGS.md), not from the top workspace toolbar.
11. When auto-collapse switches from one expanded project to another, Tavi scrolls the newly expanded project back into view so the screen focus stays on the open project.
12. The `Personal ToDo` panel is private to the signed-in user, and its `hide done` toggle is stored only in that browser's local Tavi storage.

## Derived project status

When a project does not have a manual status override, Tavi derives its status from the project's active, non-archived tasks:

1. No active tasks: `not_started`
2. All non-canceled tasks are `done`: `done`
3. All remaining actionable tasks are `blocked`: `blocked`
4. All remaining actionable tasks are `on_hold`: `on_hold`
5. All non-canceled tasks are `todo`: `not_started`
6. Any mix that includes progress, completed work plus remaining todo work, or other mixed active states: `in_progress`

For rollup purposes, actionable tasks are tasks that are not `done` and not `canceled`.
