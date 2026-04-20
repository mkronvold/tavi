# Audit History Guide

tavi records audit history for key entities so you can confirm what changed, who changed it, and when.

## Where to open history

| History type | Where to open it |
| --- | --- |
| Project history | `History` on a project row |
| Task history | `History` on a task row |
| Saved-view history | `View` panel, then `History` on the selected saved view |
| Auth history | Click the signed-in user name, then `User History` |
| Email delivery history | `Settings`, then `Audit notifications` |

## What you will see

Each history entry shows:

1. Actor name
2. Action label
3. Timestamp in your browser's local timezone, including the timezone label when time is shown
4. Actor role and email
5. Summary chips for the most relevant metadata, such as changed fields, owner changes, status changes, or view settings

## Common uses

1. Confirm when a task moved between projects.
2. See who changed a project status override.
3. Review saved-view updates before a recurring meeting.
4. Check sign-in activity for the current local account.
5. Troubleshoot skipped, failed, or queued outbound email delivery for notifications and password resets.

## Non-obvious behavior

1. History is scoped to the entity you opened, not a global audit log.
2. Metadata chips summarize the most relevant fields so you do not need to inspect raw JSON.
3. Auth history is centered on the current user identity, even for admins.
4. `Audit notifications` is admin-only and focuses on outbound delivery state rather than entity change history.
