# Import and Export Guide

The `Import/Export` panel combines filtered workspace exports for all signed-in users with admin-only CSV import plus clear/reset controls for workspace projects and tasks.

The import card follows the same flow described in the UI: import from CSV, apply mapping, review the preview, and then commit to the database.

## Open the panel

1. Open `Settings`.
2. Select the `Import/Export` settings card.
3. Use the `Close` button in either panel header when you want to hide the panel again.

## Permissions

| Feature | Who can use it |
| --- | --- |
| CSV, XLSX, JSON, and Loop exports | Any signed-in user |
| CSV import staging and commit | Admin only |
| Clear all Projects/Tasks / Reset to example Projects/Tasks | Admin only |

## Export the current workspace

Exports always follow the current search text, grouping choice, task `Status` filters, and task `Assignee` filters. You only get the data visible to your current role.

Available export buttons:

| Button | Result |
| --- | --- |
| `CSV` | Spreadsheet-friendly export of the filtered workspace |
| `XLSX` | Native Excel workbook export of the filtered workspace |
| `JSON` | Structured export for automation or archiving |
| `Loop` | Loop-oriented CSV generated from the filtered workspace |

## CSV import workflow

1. Open `Settings`, then open `Import/Export`.
2. Choose a CSV file and select `Stage import`.
3. Pick the staged job from `Recent imports`.
4. Review `Header mapping` and fix any incorrect field matches.
5. Review `Preview` for invalid rows, warnings, missing users, and overlap decisions.
6. Rows with a blank value in the mapped checklist or task-title column are treated as project-only rows. Preview shows `No task created` and `Project only` for them.
7. Resolve blocking issues.
8. Select `Commit valid rows` to queue the worker-backed commit.
9. Review `Commit results` after processing finishes.

## Missing users

During preview, tavi surfaces imported people who do not match existing local accounts.

Important rules:

1. Missing task assignees can block commit.
2. Additional project owners from a multi-owner import are optional.
3. tavi can create local viewer accounts only when the import includes an email address.
4. Generated passwords are shown once in the panel, so copy them before leaving the page.

## Overlap decisions

If the import matches an existing project or task, each preview row shows the overlap and lets the admin choose what to do.

### Project overlaps

- `Update existing project`
- `Add new project`
- `Use existing project unchanged`

### Task overlaps

- `Update existing task`
- `Add new task`
- `Ignore task row`

Project overlap choices propagate across checklist-split rows for the same imported project so the staged tasks stay grouped together.

## Remove a recent import

The `Remove import` button appears for any selected recent import. Use it to delete the import history entry and clean up its staged or recorded result rows.

Important rules:

1. Removing an import does not undo any projects or tasks that were already created or updated by that import.
2. Removing an active import also removes its tracked history, even if worker cleanup is still in flight.
3. Removing a staged import clears its staged rows the same way the old cancel flow did.

## Clear or reset Projects/Tasks

Both workspace actions are destructive for project/task data and require the current admin password.

### Clear all Projects/Tasks

What it does:

1. Deletes current projects and tasks.
2. Does not seed example projects.
3. Keeps local accounts, saved views, and import history.

### Reset to example Projects/Tasks

What it does:

1. Deletes current projects and tasks.
2. Seeds a compact example workspace.
3. Keeps local accounts, saved views, and import history.

## Loop checklist reference

This screenshot shows the style of legacy Loop source data that tavi turns into projects plus first-class tasks.

![Loop-style project and checklist source data](../references/screenshots/loop-projects-and-checklist.png)

Checklist lines separated by newlines in the imported CSV become separate task rows under the same project during staging.

Blank checklist cells keep the project row in preview and import it without creating a task.

## Non-obvious behavior

1. Import is generic CSV staging in the UI, but the `Loop` export button still produces a Loop-oriented CSV shape.
2. A blank mapped checklist or task-title value creates a valid project-only row, even when project and task mappings share source columns such as status or priority.
3. `Commit valid rows` stays disabled when there are blocking missing users or zero valid rows.
4. Removing an import clears its history entry; it does not undo any completed import changes.
5. The export and import cards share the same workspace panel toggle, so closing either header closes the full `Import/Export` workspace area.
6. `Preview` and `Commit results` are separate subsections inside the selected import detail view, not separate panels.
