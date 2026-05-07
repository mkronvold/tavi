# Notifications Guide

Tavi supports immediate project and task update emails, an optional daily digest for non-administrative notifications, and direct due-date reminders for private `Personal ToDo` items.

## Global rules

1. Outbound email must be enabled by an admin.
2. Each user chooses whether non-admin notifications arrive immediately or in the daily digest.
3. Each user saves their own digest time from `User Profile`; the UI shows browser-local time and the API stores UTC.
4. Administrative account emails are separate from these project and task work-tracking notifications.

## Where to configure it

### Admins

Open `Settings` to manage:

1. `Email Notifications` for the global outbound email on/off switch.
2. `Audit Notifications` to inspect notification delivery history, expand or copy full timelines, and run the admin test-email flow.

### Any user

Open `User Profile` from the signed-in user name to manage:

1. `Daily Digest` to choose digest delivery instead of immediate non-admin update emails.
2. The digest send time beside that toggle, shown in local browser time and saved in UTC when you click `Save`.

## Audit notifications and test email

`Audit Notifications` is the admin troubleshooting surface for outbound delivery.

Each row:

1. Starts collapsed so the list stays compact.
2. Expands when you click the summary bar or the subtle `Expand` button.
3. Offers a subtle `Copy` action that copies the full notification flow and timeline to the clipboard.

The `Test email` action sends to the signed-in admin and reports actionable SMTP diagnostics, including configuration problems, recipient/from details, SMTP host details, and the returned transport error or host response when delivery fails.

## Immediate update recipients

| Change saved | Recipients when email is enabled |
| --- | --- |
| Project update | The current project owner plus all active task assignees in that project |
| Task update | The current task assignee plus the current project owner |

These recipients are calculated from the current saved state, not from whoever previously owned or was assigned to the item.

## What update emails include

Update emails do not send only the single changed field anymore.

They now include:

1. The project or task context.
2. A formatted change summary.
3. Simulated code-fence `From:` and `To:` blocks so the before and after values are easy to compare.
4. Project names in email bodies link to a prefilled workspace search for that project.
5. An email-safe Tavi-branded HTML wrapper with a compact logo image, clear fallback text, and no dependency on stylized Unicode rendering.

## Daily digest behavior

When a user enables `Daily Digest`, non-admin work-notification emails are batched into one digest sent at that user's saved digest time.

Use digest mode when you want:

1. Fewer individual update emails during heavy editing.
2. A single review summary each day.

Keep digest mode off when you want immediate update emails instead.

Digest mode replaces immediate emails for:

1. Project updates
2. Task updates
3. Assignments and unassignments
4. Task due-date notifications for shared work

Administrative account emails still send immediately and are not batched into the digest.

## Personal ToDo reminders

Private `Personal ToDo` items do not send project-update, task-update, assignment, or ownership emails.

They can send only due-date reminder emails to their owner:

1. 7 days before due
2. 3 days before due
3. Tomorrow
4. Due today
5. Overdue

These reminder emails stay separate from the shared-work daily digest so a personal due reminder is not hidden inside the digest batch.

Use the `Enable reminders` switch at the top of the `Personal ToDo` panel to turn these owner-only reminder emails on or off. It defaults to on so existing reminder behavior stays unchanged until a user chooses otherwise.

## Related workspace behavior

1. Project and task saves still happen immediately in the UI; digest mode changes delivery timing, not save timing.
2. Audit history remains separate from email delivery and is available from [`AUDIT_HISTORY.md`](./AUDIT_HISTORY.md).
3. Backup, import, and restore operations do not use this non-admin notification flow.

## Non-obvious behavior

1. A user can enable daily digest only for themselves; admins do not force digest mode for everyone.
2. The stored default digest time is `11:00` UTC, which is `5:00 AM` CST, and digest starts off by default for each user.
3. If global email is disabled, neither immediate update emails nor daily digests are sent.
4. Personal ToDo reminder emails also depend on the global email switch, but they are not batched into the daily digest.
5. `Audit changes` intentionally excludes outbound email-delivery events so project/task changes and email timelines do not duplicate each other.
6. Email copy uses `Tavi` for broad mail-client compatibility even when the web UI or docs use the stylized `ᴛᴀᴠi` display form.
