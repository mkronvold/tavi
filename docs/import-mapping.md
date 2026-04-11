# Loop Import Mapping

Tavi currently implements Loop import as a mapping-driven CSV flow so the product can stage and validate real files before an exact Loop export sample is available in the repo.

## Supported flow

1. Upload a CSV or delimited export file.
2. API creates an import job.
3. Worker stages rows into `ImportRow`.
4. Admin reviews suggested header mappings and preview feedback.
5. Worker commits valid rows into projects and tasks.
6. Results show created, updated, skipped, and failed rows.

## Canonical fields

Required:

- `projectTitle`
- `taskTitle`

Optional:

- `projectExternalId`
- `projectSummary`
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
- Project and task source ids drive idempotent updates when present.
- Without source ids, matching falls back to natural keys:
  - Project: title + owner + due date
  - Task: project + title + assignee + due date
- Unknown owners or assignees default to the import creator and surface a warning in preview.
- Unsupported priorities, statuses, missing titles, invalid dates, and blocked tasks without a reason fail row validation.

## Current caveat

- There is still no checked-in Loop sample export.
- The importer is intentionally mapping-driven so it stays useful without guessing a fixed Loop schema.
- Once a real export sample is available, header aliases and validation rules should be tightened against the actual file shape.
