# Release Candidate — Scope v2.1 (Mac mini) — Index & Runbook

**Status:** `TECHNICAL PRODUCTION READY ON MAC MINI — PRINCIPAL ACCEPTANCE PENDING — HOST-PC MIGRATION NOT STARTED`
**Not tagged.** The final release tag is created only after genuine principal acceptance.

## 1. Package contents

| Artifact | Location |
|---|---|
| Source commit | `8fb59c17d1d82e2bd7c4825013bb8e5dbf5050f5` (branch `scope-v2.1-corrections`) |
| Application image | `madrasa-app:0.1.0` — `sha256:a492d908bcfb8e97d578eea5b71f186e42e09b14c85f0fa2cb194d1b9a5e529a` |
| Rollback image | `madrasa-app:0.1.0-prev-v2-20260723` — `sha256:d6df008b…3e4a4a` |
| Encrypted DB+files backup | `backups/weekly/full-20260726-rc-v2_1.tar.gz.enc` (+ `.sha256`) — git-ignored |
| Recovery manifest | `RECOVERY_MANIFEST_20260726.md` |
| Migration journal | `migration_journal_post_0016.txt` (17 rows, ends at `0016`) |
| Sanitized env template | repo `/.env.production.example` (placeholders only — no secrets) |
| Deployment report | `DEPLOYMENT_REPORT_20260726_V2_1.md` |
| Destination-PC checklist | `DESTINATION_PC_CHECKLIST.md` |
| Arabic operating guide | `دليل_المدير_التشغيلي.md` |
| Arabic acceptance checklist | `قائمة_قبول_المدير.md` |
| Known limitations / backlog | `KNOWN_LIMITATIONS_BACKLOG.md` |

## 2. Installation prerequisites

- Docker Engine + Docker Compose v2.
- Images: `node:24-bookworm-slim` (build), `postgres:16-alpine` (DB).
- `openssl` for backup/restore encryption.
- A `.env.production` (copy from `.env.production.example`, fill real secrets): `POSTGRES_PASSWORD`, `SESSION_SECRET` (64 hex), `BACKUP_PASSPHRASE`, `APP_URL`, `TRUSTED_ORIGINS`. Optional temporary LAN retest: `APP_BIND=<LAN-IP>`, `ALLOW_INSECURE_LAN_HTTP=true`.
- Disk: image ~ hundreds of MB; `pgdata` + `storage` grow with use (current backup ≈ 21 MB).

## 3. Startup (Docker / Compose)

```bash
# First-time bootstrap (empty DB) — runs migrate + reference seed once, then the app:
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod up -d --build

# Existing DB upgrade (DATA PRESENT) — never re-seed. Migrate only, then app-only cutover:
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm --no-deps init sh -c "npx tsx src/db/migrate.ts"
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --no-deps app
```

> ⚠️ On a database that already holds live data, **never** run a plain `up` without `--no-deps app`: the compose `init` service runs `migrate.ts && seed.ts`, and a plain `up` would re-run `seed.ts`. The upgrade path above avoids `init`/seed entirely.

## 4. Backup

```bash
# Weekly encrypted full backup (DB + uploads + config):
docker exec madrasa-prod-db-1 pg_dump -U madrasa -d madrasa --format=custom > db.dump
# (bundle db.dump + package.json + .env.production.example + storage/, then:)
openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -in full.tar.gz \
  -out backups/weekly/full-<STAMP>.tar.gz.enc -pass env:BACKUP_PASSPHRASE
shasum -a 256 backups/weekly/full-<STAMP>.tar.gz.enc
```
Copy the `.enc` file **off the machine** (external disk or a second Tailscale node). The repo's `scripts/backup-weekly.sh` automates this when run where the DB and storage are host-reachable.

## 5. Restore

```bash
scripts/restore.sh backups/weekly/full-<STAMP>.tar.gz.enc \
  "postgresql://madrasa:<PASSWORD>@localhost:5432/madrasa" ./storage-restored
# then verify (see §7)
```
Requires `BACKUP_PASSPHRASE`. Target DB must be empty/replaceable (`pg_restore --clean --if-exists --no-owner`).

## 6. Rollback

Preferred = **application rollback** (additive `0016` schema is inert to the old code):
```bash
docker tag madrasa-app:0.1.0-prev-v2-20260723 madrasa-app:0.1.0
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod up -d --no-deps app
```
- Leave the `0016` objects in place. Drop the 2 tables + 1 column **only** before they hold data (they are empty now); **never** after committee task-template/assignment data exists.
- Restore the DB/files backup **only** if verified corruption requires it.
- Rollback must never destroy KPI/committee/task/report/activity/milestone records or uploaded files.

## 7. Verification checklist (post-deploy / post-restore)

```bash
# migration level = 17 rows, ends at 0016
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "SELECT count(*) FROM drizzle.__drizzle_migrations;"          # -> 17
# D-022 fingerprint must equal F0
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm --no-deps -e NODE_OPTIONS=--conditions=react-server init \
  sh -c "npx tsx scripts/verify-milestone-baseline.ts"          # -> 129 + 8d5375…a382cf
# reconciliation 129/129, 0 orphans; new tables present; requires_signature all false
# app health
curl -s http://192.168.0.48:3080/api/health                     # -> {"status":"ok","db":"up",...}
```

Expected values: migration rows **17**; D-022 fingerprint `8d5375e0f610ee06cd80702b4f1427a3967cbf19884ef091820d2f5a77a382cf`; milestones 129 / activities 129 / 0 orphans; `committee_task_templates` + `committee_task_assignments` present; `meeting_types.requires_signature` all `false`.
