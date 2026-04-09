# Tavi Design Specification

> Tavi is our lightweight system for tracking work and projects clearly, without slowing teams down.

## 1. Product Summary

Tavi is an internal web application for managing project work as first-class projects and tasks. It replaces Loop as the primary tracker and turns checklist-style work into structured tasks with explicit status, ownership, due dates, and rollup behavior.

The product is optimized for review-heavy team workflows where people need to scan many projects quickly, regroup the view during discussions, and understand project health from task state instead of ad hoc notes or checklists.

## 2. Product Goals

1. Replace checklist-driven project tracking with explicit project and task records.
2. Make project status trustworthy by deriving it from task status and exposing rollup details.
3. Support fast review conversations with compact layouts, inline editing, and collapse/expand controls.
4. Make large worklists manageable through filtering, sorting, regrouping, and saved views.
5. Provide a practical migration path from existing Loop exports.

## 3. Non-Goals for v1

1. Arbitrary nested tasks beyond one task level under each project.
2. Bi-directional synchronization with Loop.
3. Mobile-first task management UX.
4. External customer or guest collaboration.
5. Broad portfolio analytics beyond operational status views.

## 4. Intended Users

| Role | Primary Use | Permissions |
|---|---|---|
| Admin | Configure access, manage imports, resolve data issues | Full access, role assignment, import administration, archive/restore |
| Editor | Create and manage project/task data | Create, edit, regroup, update status, save views |
| Viewer | Follow progress and join reviews | Read-only access to projects, tasks, and saved views |

## 5. Core Domain Model

### Project

A project is the top-level tracking unit. It represents a deliverable, initiative, or workstream.

Recommended fields:

- Title
- Summary
- Owner
- Due date
- Priority
- Labels/tags
- Derived status
- Optional manual status override
- Notes
- Source metadata for imports
- Created at / updated at / archived at

### Task

A task is a first-class work item directly attached to a project. Tasks are not nested beyond one level in v1.

Recommended fields:

- Title
- Description
- Assignee
- Due date
- Priority
- Status
- Blocked reason
- Labels/tags
- Sort order within the project
- Created at / updated at / completed at
- Source metadata for imports

### Saved View

A saved view stores a named combination of:

- Filters
- Grouping mode
- Sort order
- Expanded/collapsed state defaults
- Visible columns and density preferences

### Import Job

An import job records a Loop CSV or export-based migration event, including validation results, row mappings, and completion status.

### Audit Event

An audit event records meaningful changes such as status changes, task reordering, field edits, overrides, and imports.

## 6. Status Model

### Task Statuses

Recommended task statuses:

- `todo`
- `in_progress`
- `blocked`
- `done`
- `canceled`

### Project Statuses

Recommended project statuses:

- `not_started`
- `in_progress`
- `blocked`
- `done`

### Project Rollup Rules

Default project status is auto-calculated from task state.

1. If a manual override is active, show the override status and keep the derived status visible for context.
2. If the project has no active tasks, set status to `not_started`.
3. If all non-canceled tasks are `done`, set status to `done`.
4. If any open task is `blocked`, set status to `blocked`.
5. If any task is `in_progress`, set status to `in_progress`.
6. Otherwise set status to `not_started`.

Override requirements:

- Only admins and editors can set or clear an override.
- An override must capture a reason.
- The UI must always indicate when a displayed project status is overridden instead of derived.

Rollup details shown in the UI should include:

- Total task count
- Counts by task status
- Overdue task count
- Completion ratio

## 7. Core User Workflows

### 7.1 Create a Project

1. User creates a project with core metadata.
2. User adds tasks inline or through a project detail drawer/page.
3. Project appears in the main grouped list with an initial derived status.

### 7.2 Import Existing Work from Loop

1. Admin uploads a Loop export or CSV.
2. System validates required columns and previews the mapping.
3. User confirms the import.
4. Imported checklist items become tasks under their mapped project.
5. Import results show successes, skipped rows, and validation failures.

### 7.3 Daily Review / Standup

1. User opens a saved view or applies filters.
2. User groups projects by owner, status, due date bucket, or label.
3. User collapses unrelated groups and expands the project under discussion.
4. User updates task status and notes inline during the review.
5. Project rollup updates immediately.

### 7.4 Exception Handling

1. User marks a task blocked and provides a reason.
2. Project rollup reflects the change.
3. If the derived project status does not match the team's desired summary, an editor or admin can apply a manual override with a reason.

## 8. Functional Requirements

### FR-01 Authentication and Access

- Production access uses enterprise SSO via OIDC or SAML.
- Local development uses a simpler local auth mode.
- Authorization must enforce admin/editor/viewer roles.

### FR-02 Project Management

- Users can create, edit, archive, restore, and view projects.
- Projects must support due dates, owners, labels, notes, and priority.
- Soft deletion or archiving is preferred over hard deletion in v1.

### FR-03 Task Management

- Users can create, edit, reorder, and archive tasks within a project.
- Tasks must support assignee, due date, priority, status, labels, and blocked reason.
- Tasks exist only under a project in v1.

### FR-04 Dense Primary Workspace

- The default workspace is a dense grouped list/table.
- The workspace must display both project rows and task rows.
- Expand/collapse must work at both group and project levels.

### FR-05 Inline Editing

- Core project and task fields must be editable inline without navigating away.
- Inline edits should preserve context and avoid full-page reloads.

### FR-06 Sorting, Filtering, and Regrouping

- Users can sort, filter, and regroup by owner, assignee, status, due date, priority, and label.
- Filters and grouping state should be shareable via URL and savable as named views.

### FR-07 Rollup and Summary Indicators

- Project status is derived from tasks by default.
- The UI must display rollup counts and completion progress alongside each project.
- Manual overrides must remain visible and auditable.

### FR-08 Saved Views

- Users can save personal or team views.
- Views persist filters, grouping, sorting, and display density.

### FR-09 Search

- Users can search across project titles, task titles, owners, assignees, and labels.

### FR-10 Import from Loop

- v1 must support CSV or export-based import from Loop.
- Import must provide preview, validation, and error reporting.
- Imported checklist items become tasks in the destination project.

### FR-11 Audit History

- Meaningful project and task changes must be auditable.
- Minimum audit events: create, edit, status change, reorder, override, import, archive/restore.

### FR-12 Bulk Actions

- Editors and admins should be able to bulk-update common fields such as assignee, due date, label, and status for selected tasks.

### FR-13 Accessibility

- Keyboard navigation is required for row navigation and inline edits.
- Status indicators must not rely on color alone.
- Table controls and row actions must remain screen-reader accessible.

### FR-14 Performance

- The primary workspace should remain responsive with large grouped lists.
- Expanding, collapsing, filtering, and inline edits must feel immediate in normal use.

## 9. UX Requirements

### Interaction Model

- Desktop-first experience optimized for review conversations and operational tracking.
- Compact row density with minimal visual chrome.
- Secondary actions should be visually quiet until hover or focus.
- Common edits should happen inline or in lightweight drawers/modals.

### Visualization Requirements

- Group headers must show counts and summary status.
- Project rows must show rollup counts without requiring expansion.
- Task rows must be easy to scan with stable column alignment.
- Users must be able to collapse unrelated content quickly to focus the discussion.

### Layout Requirements

- Support sticky headers and stable columns for large lists.
- Preserve user column preferences where practical.
- Keep filters and grouping controls compact and close to the data.

### Responsiveness

- v1 should target desktop and large laptop screens first.
- Smaller screens may support read/update workflows, but full dense-table management is not a v1 priority.

## 10. Business Rules

1. Every task belongs to exactly one project.
2. Projects support only one task level in v1.
3. Archived projects and tasks are hidden from default views but recoverable.
4. A blocked task should require a blocked reason.
5. Manual project status overrides require a reason and audit entry.
6. Imported records should preserve source metadata for traceability.

## 11. v1 Scope

### In Scope

- Internal authenticated web app
- Admin/editor/viewer roles
- Projects with one level of tasks
- Dense grouped list/table workspace
- Inline editing
- Filtering, sorting, regrouping, saved views
- Derived project status with manual override
- CSV/export-based Loop import
- Audit history

### Nice to Have if Time Allows

- Basic dashboard summaries
- Per-user default views
- Bulk-edit improvements beyond the initial field set

### Out of Scope for v1

- Full Loop sync
- Deep task nesting
- Native mobile app
- External collaborator access
- Advanced reporting suites

## 12. Suggested Supporting Documents

To reduce ambiguity before implementation, the following supporting docs are recommended after `docs/design.md` and `docs/architecture.md` are accepted:

1. `docs/ux-flows.md` for annotated workflows and wireframes of the dense workspace, import flow, and inline editing states.
2. `docs/api-contract.md` for concrete request/response shapes and error models.
3. `docs/data-dictionary.md` for field definitions, enums, and validation rules.
4. `docs/import-mapping.md` for the Loop export format, column mapping, and migration rules.
5. `docs/ops-runbook.md` for deployment, rollback, and operational procedures.
6. `adr/` entries for major architectural decisions that may evolve during implementation.
7. `docs/branding.md` for canonical naming, stylized display usage, and first-use product copy.

## 13. Reference Alignment

TrackForge and current Loop screenshots should be used during UI review to validate layout density, row hierarchy, and control placement before implementation begins. They are reference inputs for interaction quality, not the source of truth for the product model.

Store reference screenshots under `references/screenshots/` using descriptive filenames so the design discussion can cite them directly as new examples are added.
