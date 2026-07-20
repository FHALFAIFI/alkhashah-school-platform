# Clean Production Baseline

Record of the controlled clean-production reset and the reversible cutover to the Dockerized clean
environment. English per the language policy. Companion: `docs/DOCKER_HOMELAB_DEPLOYMENT.md`,
`docs/DOCKER_OPERATIONS.md`, `docs/POST_PILOT_REMEDIATION.md`.

**Nothing was destroyed.** The previous production database, its volume, uploaded files, and all
encrypted backups are preserved as a cold recovery checkpoint. The reset created a **new, separate**
clean database + volumes; no old operational rows were copied in.

## Cold recovery checkpoint (the preserved legacy environment)

| Item | Value |
| --- | --- |
| Legacy DB container | `madrasa-db` (`postgres:16-alpine`, host port 5544) — **retained, running** |
| Legacy data volume | `fathersfile_madrasa_pgdata` — **retained, untouched** |
| Legacy app commit | `cf67e39` |
| Legacy migrations | 8 (`0000`–`0007`) — **0008/0009 were never applied to the legacy DB** |
| Pre-cutover encrypted backups (checksummed) | DB-only `backups/daily/db-20260720-094329.dump.enc` (sha256 `80b93482…7484d10`); full DB+files `backups/weekly/full-20260720-094329.tar.gz.enc` (sha256 `6e29ed45…696e49d`) |
| Restore rehearsal | **PASS** — full backup restored into a disposable DB, all domains verified, disposable DB dropped (`scripts/phase0-verify.sh`) |
| Recovery manifest | `storage/private/recovery/recovery-manifest-20260720-094329.json` (git-ignored) |

Legacy (old) domain counts, verified by the pre-cutover restore rehearsal: publicTables 66,
migrations 8, users 2, importBatches 77, programs 58, **people 80**, documents 56, floors 5,
**rooms 17**, **assets 3**, inspections 11, auditLog 1214, storedFiles 181 / **185 physical files**.
This is the mixed official + synthetic-scenario data (plus the uncommitted Fares «معاينة» batch) that
the principal asked to clear — preserved here, cleared from the active environment.

## New clean production environment

- **Stack**: `compose.production.yml`, project **`madrasa-prod`**, image `madrasa-app:0.1.0`.
- **Separate** Docker volumes: `madrasa-prod_pgdata` (DB), `madrasa-prod_storage` (private files),
  `madrasa-prod_backups`. **New, empty** — no legacy rows migrated in.
- **All 10 migrations** applied (`0000`–`0009`, including 0008 assets-lifecycle + 0009 templates).
- **Reference data only** seeded (one-shot `init` service; `src/db/seed.ts`, never `seed-demo.ts`).

### Verified clean-environment counts (non-empty tables)

| Table | Count | Kind |
| --- | --- | --- |
| `__drizzle_migrations` | 10 | all migrations applied |
| `users` / `roles` / `user_roles` | 2 / 2 / 2 | principal + administrator accounts + roles |
| `permissions` / `role_permissions` | 56 / 110 | RBAC (incl. `assets.delete`) |
| `school` / `stages` / `settings` | 1 / 3 / 13 | school identity + settings |
| `calendars` / `calendar_events` | 1 / 16 | official 1448-1449 calendar |
| `committee_templates` | 6 | official committee templates |
| `perf_models` / `perf_indicators` | 8 / 123 | official ministry models + D-014 status |
| `meeting_types` | 5 | reference |
| `inspection_templates` | 10 | **system reference templates** (`is_system`, not fake results) |
| `site_zones` / `floors` | 2 / 5 | building structure (empty containers — no rooms) |

**Confirmed zero demo/operational domain records**: `people`, `programs`, `program_*`, `committees`,
`committee_members`, `meetings`, `meeting_outcomes`, `perf_cycles`, `perf_sessions`, `perf_ratings`,
`rooms`, `assets`, `inspections`, `maintenance_issues`, `evidence_items`/`evidence_links`,
`documents`, `import_batches`/`import_rows`, `feedback`, `notifications`, `action_tasks`, `ai_*`,
`floor_geometry_versions`, `record_versions`, `sessions` — **all 0**. No synthetic audit events; the
only `audit_log`/session rows are from this environment's own legitimate use.

### Reset process (controlled, non-destructive)

1. Phase-0/pre-cutover encrypted backup + **passing** restore rehearsal of the legacy DB (above).
2. Legacy stack retained as the cold checkpoint (container + volume + backups).
3. New Postgres volume/DB created via `compose.production.yml`; **all migrations** applied in order.
4. **Only** legitimate system/reference data seeded (no demo people/programs/committees/meetings/
   cycles/rooms/assets/inspections/maintenance/evidence/reports/feedback/imports/test/synthetic-audit).
5. Clean-environment fully verified (Gate 8) before replacing the active service.

## Cutover (reversible) — authorized by the principal's earlier choice

The active service on `127.0.0.1:3080` was switched from the legacy dev server (on the legacy
`madrasa` DB) to the **clean Docker stack** (clean DB + persistent volumes):

```bash
# 1) (already done) pre-cutover encrypted backup + restore rehearsal of the legacy DB
# 2) stop the legacy active app (dev server) — legacy DB/volume/backups are retained, not deleted
lsof -tiTCP:3080 -sTCP:LISTEN | xargs kill
# 3) bind the clean stack to localhost:3080 and start it
#    (.env.production: APP_PORT=3080, APP_URL=http://localhost:3080 → later the Tailscale URL)
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod up -d app
# 4) verify
curl -fsS http://127.0.0.1:3080/api/health   # {"status":"ok","db":"up","version":"0.1.0"}
```

Post-cutover state: app healthy on `127.0.0.1:3080` (localhost-only), clean DB, zero operational
records, `principal` login + Arabic RTL confirmed, PostgreSQL not published.

## Emergency rollback to the pre-reset cold checkpoint

The switch is reversible. **Do not delete** the legacy DB/volume/files/backups.

```bash
# A) fastest — return to the legacy environment as-is (the legacy DB was never modified):
docker compose -f compose.production.yml -p madrasa-prod stop app   # stop the clean app on 3080
#    the legacy madrasa-db container is still running (host 5544);
#    restart the legacy application against it (dev): npm run dev   (binds 3080)
#    — or run the legacy production image against DATABASE_URL=…@localhost:5544/madrasa

# B) if the legacy DB volume were ever lost — restore from the pre-cutover encrypted backup:
BACKUP_PASSPHRASE=… bash scripts/restore.sh \
  backups/weekly/full-20260720-094329.tar.gz.enc \
  "postgresql://madrasa:…@localhost:5544/madrasa_restore" /tmp/restore-store
#    (verify counts against this document, then repoint the app's DATABASE_URL)
```

## Import readiness (principal's manual actions — not automated)

The clean environment is ready for the principal to (manually):
- Upload the **official Fares Excel** again → preview → correct classifications → defer/exclude rows
  → **confirm manually** (the agent never commits it).
- Upload the **official operational-plan** workbook → preview → **confirm manually** (never auto-approved).
- Upload/configure the academic calendar.
- **Rebuild the building manually** in the new SVG editor (create rooms → place → publish).

No import was executed and no Fares/plan data was committed after the reset. D-014 is left unresolved
(the principal reconciles it against نظام فارس at the first real evaluation cycle).
