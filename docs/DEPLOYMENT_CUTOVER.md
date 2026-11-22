# Deployment cutover and database migration note

**Status: HOLD.** This is a preparation note only. The next-version work remains in local development and testing. Do not deploy, migrate a hosted database, or change production records until the roadmap is complete and the user explicitly approves the cutover.

## Why this note exists

The existing deployed database, if still in use, was initialized by replaying `db/schema.sql` and does not have the new `app_schema_migrations` history table. The new runner intentionally refuses to apply the current baseline to an untracked non-empty database. The baseline command records that the existing schema is current without re-running the baseline SQL.

## Cutover checklist for the future

1. **Finish the roadmap and freeze the release scope.** Confirm the code, schemas, privacy/security requirements, and staff login are complete. Agree on a maintenance window and who can approve or stop the cutover.
2. **Inventory the target.** Confirm the database host, database name, schema version, extensions, row counts, current application version, and any schema drift. Never infer the target from a shared `.env` file.
3. **Back up and prove recovery.** Take a provider snapshot and a logical `pg_dump`; restore the backup to an isolated local database and verify representative records and relationships before changing the target.
4. **Rehearse on the restored copy.** Run `pnpm db:migrate:baseline` against the restored current-schema copy, then `pnpm db:migrate` to apply all new forward migrations. Run the full local test gate and feature-specific data checks against that copy. Record duration and any locks or manual steps.
5. **Prepare application configuration.** Use production-only secrets and database credentials, disable all seed scripts, configure backups/monitoring, and verify there is no development Compose configuration or `.env*` file in the image.
6. **Cut over deliberately.** Put the existing app into maintenance/read-only mode, take a final backup, record the final row counts, mark the known current schema baseline, apply forward migrations as a separate operator step, deploy the matching app version, and run health and staff workflow smoke checks.
7. **Verify and monitor.** Confirm inventory, accounts, permissions, and critical workflows. Watch errors, database health, and audit events. Keep the old application artifact and backup available until the agreed observation period ends.
8. **Rollback carefully.** Roll back application code only when the migrated schema remains compatible. For destructive or incompatible data changes, restore the verified backup only under an agreed recovery plan because writes made after cutover may be lost. Prefer additive/expand-and-contract migrations to keep code rollback possible.

## Migration runner rules

- Run migrations as a separate step; the web container must not apply schema changes at startup.
- For a database without migration history, use `pnpm db:migrate:baseline` only after verifying that it matches the current baseline and after backup/restore rehearsal. This command writes migration history; it does not execute baseline SQL.
- Never edit a migration after it has been applied. Add a new numbered migration.
- Do not use `pnpm db:seed:dev` or `pnpm db:reset:dev` against a hosted database.
- Keep this note until cutover is complete, then replace it with the actual deployment runbook and remove obsolete instructions.
