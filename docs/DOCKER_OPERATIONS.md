# Docker Operations (Day-2)

Operational runbook for the homelab Docker deployment. Companion to
`docs/DOCKER_HOMELAB_DEPLOYMENT.md`. All commands assume the project name `madrasa-prod` and
`--env-file .env.production`. English per the language policy.

Shortcut used below:
```bash
dc() { docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod "$@"; }
```

## Lifecycle

| Task | Command |
| --- | --- |
| Start / apply changes | `dc up -d --build` |
| Stop (keep data) | `dc stop` |
| Restart the app only | `dc up -d app` (or `dc restart app`) |
| Status / health | `dc ps` · `curl -fsS http://127.0.0.1:3080/api/health` |
| Follow logs | `dc logs -f app` · `dc logs -f db` |
| Shell in app | `dc exec app sh` |

Logs are rotated by the json-file driver (`max-size 10m`, `max-file 5`) — no unbounded growth.

## First-run credentials

```bash
dc exec app cat /data/storage/private/initial-credentials.txt
```
Change both passwords on first login, enable TOTP, then delete the file:
```bash
dc exec app rm -f /data/storage/private/initial-credentials.txt
```

## Applying migrations (safe)

New app versions may add migrations. The `init` service applies them idempotently on `up`. To run
on demand without a full restart:
```bash
dc run --rm init
```
`src/db/migrate.ts` applies pending migrations in order; `src/db/seed.ts` is idempotent (guards +
`onConflictDoNothing`) and never seeds operational/demo rows.

## Updating to a new image / rolling back

```bash
# update
git pull                        # or copy the new release
dc up -d --build                # rebuilds app image, re-applies migrations via init

# roll back to the previous image (tag images per release, e.g. APP_VERSION)
APP_VERSION=<previous> dc up -d app
```
The app version is visible in **Administration → Settings** and in every **feedback** record's
metadata, so you can confirm which build is live.

## Backups (encrypted)

The image ships the backup scripts. Run them inside the app container (they read `.env` values from
the container environment; `BACKUP_DIR=/data/backups` is a persistent volume):

```bash
dc exec app npm run backup:daily      # encrypted DB-only dump  → /data/backups/daily
dc exec app npm run backup:weekly     # encrypted DB + files    → /data/backups/weekly
```

Schedule on the **host** (cron) so backups run even if you are away:
```cron
0 1 * * *  docker compose -f /opt/madrasa/compose.production.yml --env-file /opt/madrasa/.env.production -p madrasa-prod exec -T app npm run backup:daily
0 2 * * 0  docker compose -f /opt/madrasa/compose.production.yml --env-file /opt/madrasa/.env.production -p madrasa-prod exec -T app npm run backup:weekly
```

- **Retention**: daily keeps 14, weekly keeps 8 (configurable via `BACKUP_DAILY_RETENTION` /
  `BACKUP_WEEKLY_RETENTION`). Each archive is AES-256-CBC + PBKDF2 (200k), `chmod 600`.
- **Checksums**: `sha256sum /data/backups/weekly/full-*.tar.gz.enc` — record alongside the archive.
- **Off-site**: copy the weekly archive to an external disk or a second tailnet node
  (`BACKUP_OFFSITE_DIR`, or `tailscale file cp`). **Never** store `BACKUP_PASSPHRASE` with the archive.

## Restore rehearsal (monthly, disposable)

```bash
dc exec app npm run restore:rehearsal
```
Takes a fresh weekly backup, restores it into an **isolated disposable** database + temp storage,
verifies tables/users/files, then drops the disposable database. Log the result. This never touches
the live database.

Real restore into a disposable DB (manual verification):
```bash
dc exec app bash scripts/restore.sh /data/backups/weekly/full-XXXX.tar.gz.enc \
  "postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@db:5432/restore_check" /tmp/restore-store
```

## Disk-space checks

```bash
df -h                                   # host disk
docker system df                        # images/volumes/build cache
dc exec db du -sh /var/lib/postgresql/data
dc exec app du -sh /data/storage /data/backups
```
Prune old build cache when needed: `docker builder prune`. Do **not** `docker volume prune` — it can
remove the data volumes.

## Certificate / HTTPS behaviour

TLS is terminated by **Tailscale Serve** on the host (automatic tailnet certificates) — the app runs
plain HTTP on `127.0.0.1:3080` behind it. Verify: `tailscale serve status` and browse the
`https://school-server.<tailnet>.ts.net` address. Session cookies are `Secure` + `HttpOnly` when the
request arrives over HTTPS (via `x-forwarded-proto`).

## Server reboot / power outage recovery

- `restart: unless-stopped` on `db` and `app` brings the stack back automatically after a reboot.
- Recovery test: `sudo reboot` → after boot, `dc ps` shows both healthy and `/api/health` returns ok;
  data persists (named volumes).
- Power outage: a **UPS** (≥ 650 VA) is recommended so PostgreSQL shuts down cleanly. On unclean
  shutdown, Postgres performs crash recovery on next start; if the DB fails to start, restore the last
  weekly backup into a fresh volume (see above) — this is why off-site backups matter.

## Backup health in the Arabic admin UI

Backup status is surfaced in the Arabic administration backup screen (`/admin/backup`) where the
current design supports it (latest backup timestamp / presence). The app version is shown in
**Administration → Settings**.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| App unhealthy | `dc logs app`; `curl /api/health` returns `db:"down"` → check `dc logs db` / `dc ps` |
| `init` failed | `dc logs init` — usually a bad `DATABASE_URL`/password in `.env.production` |
| PDF/report errors | Chromium present at `/ms-playwright`? `dc exec app ls /ms-playwright` |
| AI unavailable | Expected when Ollama is off; the app still works — Arabic notice shown |
| Buttons "dead" after update | Hard-refresh; the service worker self-recovers `ChunkLoadError` and shows «يتوفر تحديث جديد للمنصة» |

## Complete removal (keeps data by default)

```bash
dc down                     # stops + removes containers/network — VOLUMES ARE KEPT
# only if you REALLY intend to delete all data (irreversible):
# dc down -v                # removes volumes too — DO NOT run casually
```
`dc down` never deletes volumes. The legacy pre-reset checkpoint (`madrasa-db` container + its
volume + encrypted backups) is separate and must be retained (see `CLEAN_PRODUCTION_BASELINE.md`).
