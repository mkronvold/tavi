# Notifications Guide

Tavi supports immediate project and task update emails plus an optional daily digest for non-administrative notifications.

## Global rules

1. Outbound email must be enabled by an admin.
2. The admin-configured daily digest time is shared across users.
3. Each user can choose whether non-admin notifications arrive immediately or in the daily digest.
4. Administrative account emails are separate from these project and task work-tracking notifications.

## Where to configure it

### Admins

Open `Settings` to manage:

1. `Email Notifications` for the global outbound email on/off switch.
2. `Daily Digest Time` for the shared digest send time.

### Any user

Open `Settings` to manage:

1. `Daily Digest` to choose digest delivery instead of immediate non-admin update emails.

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

## Daily digest behavior

When a user enables `Daily Digest`, non-admin work-notification emails are batched into one digest sent at the shared admin-configured time.

Use digest mode when you want:

1. Fewer individual update emails during heavy editing.
2. A single review summary each day.

Keep digest mode off when you want immediate update emails instead.

## Related workspace behavior

1. Project and task saves still happen immediately in the UI; digest mode changes delivery timing, not save timing.
2. Audit history remains separate from email delivery and is available from `AUDIT_HISTORY.md`.
3. Backup, import, and restore operations do not use this non-admin notification flow.

## Non-obvious behavior

1. A user can enable daily digest only for themselves; admins do not force digest mode for everyone.
2. The shared digest time is configured once by an admin, but each user independently chooses digest on or off.
3. If global email is disabled, neither immediate update emails nor daily digests are sent.
