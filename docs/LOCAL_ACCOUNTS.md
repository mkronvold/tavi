# Local Accounts Guide

Local Accounts is the admin surface for local-auth environments.

## Who can do what

| User             | What is available                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------- |
| Admin            | Create, edit, remove, search, import, export, reset defaults, and set passwords for local accounts |
| Editor or Viewer | Use `User Profile` in the workspace header to update only their own name, email, and password      |

## Create an account

1. Open `Settings`.
2. Open `Local Accounts`.
3. Select `New account`.
4. Enter name, email, role, and password.
5. Use `Generate` if you want a random password.
6. Select `Create`.

## Edit, remove, or reset a password

From the account list, admins can:

1. Select `Edit` to change name, email, or role inline in that account row.
2. Select `Set Password` to replace the password from the same row.
3. Select `Remove` to delete the account.

Use the search box to filter by name, email, or role before making bulk admin changes.

If an account still has active assigned tasks, Tavi pauses deletion and lets you either:

1. Reassign those tasks to another local account.
2. Set those tasks to `None` so they become unassigned.

Accounts that still own active projects must have those projects reassigned or removed before deletion can continue. Archived projects and tasks do not block account deletion.

## Bulk actions

Admins can select multiple rows with the account checkboxes, then:

1. Use `Bulk Password Reset` to set the same password across every selected account.
2. Use `Bulk Change Role` to move all selected accounts to `viewer`, `editor`, or `admin`.
3. Use `Bulk Delete` to remove all selected accounts that are safe to delete.

Important rules:

1. Bulk role changes and bulk delete still require at least one admin account to remain.
2. Bulk delete skips accounts that still own active projects or have active assigned tasks and reports the failures after the run.

## Export JSON and import JSON or CSV

Admins can export local accounts as JSON, then import accounts later from either JSON or CSV.

## Self-service profile edits

Non-admin users no longer open `Local Accounts` for self-service changes.

Use the signed-in user name in the workspace header to open `User Profile`, then:

1. Select `Edit`.
2. Update name and/or email inline.
3. To change your password, enter your current password plus the new password twice.
4. Select `Save`.

If you cannot sign in, the login screen now reveals `Forgot password` after one failed sign-in attempt. That flow emails a one-time password in `AAAA-BBBB` hex format, accepts the code only for 10 minutes, requires typing it into the reset form, and then returns you to the login screen after the password is changed. It still sends when SMTP is configured even if admins have turned off routine outbound email notifications.

Important rules:

1. JSON exports include `passwordHash`, not plaintext passwords.
2. JSON and CSV imports match existing users by email.
3. If an imported account leaves `password` blank and the account already exists, the current password stays unchanged.
4. New imported JSON accounts must include either `password` or `passwordHash`.
5. CSV imports use `name`, `email`, `role`, and optional `password` columns.
6. If duplicate emails appear in the import file or already exist in Tavi, the panel asks whether to overwrite duplicates or skip them before import continues.

Example JSON import shape:

```json
{
  "accounts": [
    {
      "name": "Casey Admin",
      "email": "casey@tavi.local",
      "role": "admin",
      "password": "change-me-now"
    },
    {
      "name": "Riley Viewer",
      "email": "riley@tavi.local",
      "role": "viewer",
      "passwordHash": "$2b$10$examplehashedpasswordvalueforrestoreonly........"
    }
  ]
}
```

Example CSV import shape:

```csv
name,email,role,password
Casey Admin,casey@tavi.local,admin,change-me-now
Riley Viewer,riley@tavi.local,viewer,
```

## Restore Defaults

`Restore Defaults` restores these fake local accounts:

1. `admin@tavi.local`
2. `editor@tavi.local`
3. `viewer@tavi.local`

All three are reset to `password123`. Other local accounts stay in place.

## Initial production bootstrap

Fresh non-dev deployments do not create the demo users. Instead, in local-auth mode, the API auto-creates only `admin@tavi.local` on first startup when there are no users yet, generates a random 10-character alphanumeric password, and writes that initial password to the API logs.

Example log lookup commands:

```bash
# Docker Compose production runtime
docker compose -f infra/docker/compose-prod.yaml logs api \
  | rg 'auth.bootstrap.initial_admin_created|initialPassword'

# Kubernetes deployment
kubectl logs -n tavi deployment/tavi-api -c api \
  | rg 'auth.bootstrap.initial_admin_created|initialPassword'
```

This bootstrap path does not create `editor@tavi.local`, `viewer@tavi.local`, projects, tasks, or example workspace data.

## Import-created users from CSV import

CSV import preview can create missing viewer accounts directly when the source data includes `Name <email>` values. Those accounts appear in this panel after creation.

## Non-obvious behavior

1. Account JSON export and JSON or CSV import are for local auth only.
2. A password generated or shown during account creation should be copied immediately; the UI does not treat exported JSON as a password backup.
