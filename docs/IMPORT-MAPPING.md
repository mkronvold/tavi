# CSV Import Mapping

Tavi currently implements CSV import as a mapping-driven flow so the product can stage and validate real files before an exact Loop export sample is available in the repo.

## Supported flow

1. Upload a CSV or delimited export file.
2. API creates an import job.
3. Worker stages rows into `ImportRow`.
4. Admin reviews suggested header mappings and preview feedback.
5. Worker commits valid rows into projects and tasks, with project-only rows creating just the project.
6. Results show created, updated, skipped, and failed rows.

## Canonical fields

Required:

- `projectTitle`
- `taskTitle`

The task-title mapping is still required for checklist-style imports, but an individual row may leave that cell blank. In that case, Tavi treats the row as project-only and skips task creation for that row.

Optional:

- `projectExternalId`
- `projectNotes`
- `projectOwner`
- `projectDueDate`
- `projectPriority`
- `taskExternalId`
- `taskDescription`
- `taskAssignee`
- `taskDueDate`
- `taskPriority`
- `taskStatus`
- `taskBlockedReason`

## Mapping behavior

- Header suggestions are conservative and editable.
- Legacy headers such as `project summary` and `project description` are mapped into `projectNotes`.
- Project and task source ids drive idempotent updates when present.
- Without source ids, matching falls back to natural keys:
  - Project: title + owner + due date
  - Task: project + title + assignee + due date
- Newline-delimited checklist entries in the mapped task-title column are split into separate staged task rows under the same project.
- If the mapped task-title cell is blank, the row stays project-only: project fields still import, no task is created, and task-side status, priority, assignee, due-date, and notes values are ignored for that row.
- Task assignees that do not match known users surface in preview as missing import users and block commit until the admin creates those accounts or fixes the source data.
- When a project owner cell includes multiple `Name <email>` entries, Tavi uses the first matched person as the project owner and surfaces the remaining people as optional user-creation candidates for later manual task assignment.
- When the import includes a name plus email, preview offers one-click creation of local viewer accounts with generated passwords.
- Overlapping imported projects and tasks are shown per preview row, and the admin can choose whether to update the existing record, add a new one, or ignore the overlap for that row.
- Project overlap choices propagate across all staged rows that belong to the same imported project so checklist-split tasks stay grouped together.
- Unsupported priorities, statuses, missing project titles, invalid dates, and blocked tasks without a reason fail row validation. A blank task-title cell does not fail validation by itself; it produces a project-only row.

## Current caveat

- There is still no checked-in Loop sample export.
- The importer is intentionally mapping-driven so it stays useful without guessing a fixed Loop schema.
- Once a real export sample is available, header aliases and validation rules should be tightened against the actual file shape.
