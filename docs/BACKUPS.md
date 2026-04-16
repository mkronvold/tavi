# Backups and Restore Guide

The `Backups` panel is the admin-facing control surface for scheduled backups, manual snapshots, stored backup files, and restore.

## Open the panel

1. Open `Settings`.
2. Select the `Backups` settings card.
3. Use the header `Close` button when you want to hide the panel again.

## What the panel shows

| Area | What it does |
| --- | --- |
| Automatic Backups | Enables or disables the worker-driven backup schedule |
| Backup time | Sets the daily backup time; use `Save` to persist it |
| Upload Backup | Validates a Tavi backup JSON file and saves it into backup storage |
| Backup Now | Creates a fresh backup immediately and saves it into backup storage |
| Status grid | Shows the active backup directory, last success, last failure, and stored-backup count |
| Stored Backups | Lists saved backup files with `Restore`, `Download`, and `Delete` controls |
| Restore controls | Previews a stored backup, then applies a full or selective restore |

## Stored backup workflow

All backups now go through storage first.

1. Scheduled backups are written by the worker into the configured backup directory.
2. `Backup Now` writes a new stored snapshot into the same directory.
3. `Upload Backup` stores the uploaded JSON file before it can be restored.
4. Restore preview and restore apply always run from a stored backup file.

## Restore workflow

1. Select `Restore` from a stored backup row, or choose a stored backup in the restore controls.
2. Review the backup preview counts and metadata.
3. Choose one restore scope:
   - `Full restore`
   - `Projects and tasks only`
   - `Users only`
4. For selective restore, choose the projects or users to include.
5. Resolve any conflicts by choosing `Skip` or `Replace existing`.
6. Confirm the restore.

## Restore scope behavior

| Scope | What it changes |
| --- | --- |
| Full restore | Replaces the full Tavi dataset with the selected backup |
| Projects and tasks only | Restores selected projects plus their tasks without replacing user records |
| Users only | Restores selected users and role assignments without replacing projects or tasks |

## Download and delete

1. `Download` streams the selected stored backup JSON file to your browser.
2. `Delete` removes the stored file from backup storage after confirmation.

Deleting a backup file does not change live workspace data. It only removes that stored snapshot from the backup directory.

## Backup directory behavior

Tavi supports the same repo `.env` in both local and containerized development:

1. It tries `BACKUP_DIRECTORY` first.
2. If that path is not usable for the current process, it falls back to `BACKUP_HOST_DIRECTORY`.
3. If neither is set, it falls back to the local default `backups` folder for the current runtime.

This means:

1. Docker and Kubernetes can keep using container paths like `/var/tavi/backups`.
2. Locally started API or worker processes can still use the host backup path without rewriting the shared `.env`.

## Runtime notes

1. Docker Compose mounts the same backup directory into both the API and worker.
2. Published-image Docker runs should mount the same host `./backups` directory into both containers.
3. Kubernetes variants mount the same backup PVC into the API and worker, and replica variants require shared-write storage.

## Non-obvious behavior

1. The API reads stored backups, but the worker is what creates scheduled backups.
2. A restore preview does not change data; it only computes counts, conflict matches, and selectable restore items.
3. Full restore can require reauthentication if the current signed-in account is replaced or loses admin access.
4. Backup upload accepts only valid Tavi backup JSON, not arbitrary exported JSON from other systems.
