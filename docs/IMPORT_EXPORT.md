# Import and Export Guide

The `Import/Export` area combines filtered workspace exports for all signed-in users with admin-only CSV import and workspace reset controls.

## Permissions

| Feature | Who can use it |
| --- | --- |
| CSV, XLSX, JSON, and Loop exports | Any signed-in user |
| CSV import staging and commit | Admin only |
| Reset all Projects/Tasks | Admin only |

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

1. Open `Import/Export`.
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

## Cancel a pending import

The `Cancel import` button appears only while the selected import is still removable. Use it to delete the pending import job and its staged rows before the worker finishes the flow.

Completed and actively running imports stay in history.

## Reset all Projects/Tasks

`Reset all Projects/Tasks` is destructive for workspace data.

What it does:

1. Deletes current projects and tasks.
2. Seeds a compact example workspace.
3. Keeps local accounts, saved views, and import history.

To continue, the current admin must re-enter the current password.

## Loop checklist reference

This screenshot shows the style of legacy Loop source data that tavi turns into projects plus first-class tasks.

![Loop-style project and checklist source data](../references/screenshots/loop-projects-and-checklist.png)

Checklist lines separated by newlines in the imported CSV become separate task rows under the same project during staging.

Blank checklist cells keep the project row in preview and import it without creating a task.

## Non-obvious behavior

1. Import is generic CSV staging in the UI, but the `Loop` export button still produces a Loop-oriented CSV shape.
2. A blank mapped checklist or task-title value creates a valid project-only row, even when project and task mappings share source columns such as status or priority.
3. `Commit valid rows` stays disabled when there are blocking missing users or zero valid rows.
4. Canceling an import removes the pending job; it does not undo a completed commit.
