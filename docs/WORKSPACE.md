# Workspace Guide

The workspace is the main operating surface in tavi. It is built for dense review sessions: search the full worklist, regroup the screen quickly, collapse projects you are not discussing, and edit projects or tasks inline without leaving the page.

## Main controls

| Control | What it does |
| --- | --- |
| Search | Narrows the visible workspace so you can focus on matching projects and tasks |
| Group by | Regroups projects by `None`, `Owner`, `Status`, or `Priority` |
| Status | Multi-select task filter. Only matching tasks stay visible, and a project stays visible only when at least one task still matches |
| Assignee | Multi-select task filter for one or more assignees |
| View | Opens saved-view controls for the current search, grouping, task filters, and expansion state |
| Import/Export | Opens exports for everyone, plus admin-only CSV import and workspace reset |
| New Project | Opens the inline project-creation panel |
| Settings | Opens browser-local preferences, auth history, and local-account entry points |

## Working with project rows

The top search, grouping, filter, and bulk-action controls stay pinned while you scroll so review controls remain visible during long discussions.

Each project row shows the project title, notes, owner, due date, priority, status, and completion percentage.

Use the row actions on the right to:

1. Expand or collapse the project.
2. Open `Add Task` to create a task directly under that project.
3. Open `History` to review project changes.
4. Open `Edit` to change title, notes, owner, priority, due date, manual status, or tracker link in an inline row editor.
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

Use `History` on a task row when you need to confirm who changed status, assignment, or dates.

Use `Delete` inside task edit when a single task should be removed without using bulk actions.

## Bulk task actions

Bulk actions are optional and stay hidden until enabled in `SETTINGS.md`.

Once enabled:

1. Select task checkboxes in the workspace table.
2. Use the bulk action bar to apply status, assignee, priority, or due-date changes to all selected tasks.
3. Use `Delete` to remove the selected tasks.
4. Use `Clear` when you want to leave bulk mode without changing data.

## Example review flow

1. Set `Group by` to `Owner`.
2. Use Search to narrow the screen to the topic under discussion.
3. Expand the active project and collapse the rest.
4. Use `Status` and `Assignee` to narrow the discussion to only the tasks you need on screen.
5. Edit tasks inline as decisions are made.
6. Save the setup as a personal view if you expect to revisit the same review layout.

## Non-obvious behavior

1. A project can show both a manual override and the task-derived status. The override changes the display status, but the underlying derived rollup is still tracked.
2. Task filters remove non-matching task rows inside each project; they do not just hide whole projects.
3. `Group by`, `Status`, and `Assignee` selections are stored in browser-local Tavi storage and can also be captured in a saved view.
4. `Add Task` visibility is stored in the browser, not in a saved view.
5. Auto-collapse behavior is controlled from `SETTINGS.md`, not from the workspace row actions.
6. Viewer users can browse and search the workspace, but they cannot edit projects or tasks.
7. Project and task delete actions ask for confirmation before the workspace removes them.
8. Project-to-task conversion is only available when the source project has no active tasks, so existing task lists are never dropped silently.
