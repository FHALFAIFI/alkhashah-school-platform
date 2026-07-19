# Pilot Operations Guide (Technical)

Operations runbook for the integrated school-management platform
(مجمع الخشعة التعليمي للبنين) during the controlled principal pilot.

> Language: English (technical). All user-facing UI stays Arabic RTL.
> **No secrets or passwords appear in this document.** Credentials live only in
> git-ignored `storage/private/` and the environment (`.env`, not committed).

---

## 1. Stack & topology

- **Next.js 16** (App Router) · TypeScript · Drizzle ORM · **Postgres 16** (Docker).
- App dev server: **port 3080** (`npm run dev`).
- Postgres: Docker container **`madrasa-db`**, host port **5544** (5432 is used by
  another project). Real database name: **`madrasa`**. Test database: **`madrasa_test`**.
- Locale `ar-SA`, timezone `Asia/Riyadh`, RTL throughout.
- Access is over the existing **Tailscale** private network (HTTP; gate C5 deferred).

## 2. Startup and shutdown

Startup:
```bash
# 1) Database (Docker)
docker start madrasa-db          # or: docker compose up -d db
docker ps --filter name=madrasa-db      # expect: Up (healthy), 0.0.0.0:5544->5432

# 2) App
cd "<project root>"
npm run dev                      # serves on http://localhost:3080
```

Shutdown:
```bash
# Stop the app: Ctrl-C in its terminal (or stop the process manager/service)
docker stop madrasa-db           # stops the database when taking the host down
```

Health check:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3080   # 307 -> /login = healthy
```

## 3. Port and database configuration

- `DATABASE_URL` (in `.env`) points at `postgresql://<user>:<pass>@localhost:5544/madrasa`.
- The connection layer has a **fail-closed guard** (`src/db/guard.ts`): when
  `MADRASA_ENV=test`, it refuses any `DATABASE_URL` whose database name does not end in
  `_test`. Tests therefore can never touch the real `madrasa` database.
- Do not change business data via direct SQL — use the UI. Direct SQL is read-only for
  diagnostics, plus the authorized additive migrations described below.

## 4. Tailscale access

- The host runs inside the school's Tailscale tailnet; the principal's device joins the
  same tailnet and opens `http://<host-name>:3080`.
- HTTPS via `tailscale serve` (gate C5) is **deferred by the product owner (D-018)** —
  do not enable certificate/Serve/Funnel work unless the owner re-opens it.
- `TRUSTED_ORIGINS` defaults to `*.ts.net`; optionally harden to the exact device name.

## 5. Backup and restore

Scripts (encryption is always mandatory — `BACKUP_PASSPHRASE` must be set in the env):
```bash
npm run backup:daily        # encrypted DB-only dump  -> backups/daily/db-*.dump.enc
npm run backup:weekly       # encrypted full (DB + storage) -> backups/weekly/full-*.tar.gz.enc
npm run restore:rehearsal   # fresh weekly backup -> restore into a disposable DB -> verify -> drop
npm run restore <file.enc> [TARGET_DB_URL] [ATTACHMENTS_DIR]   # real restore
```

- Backups are AES-256-CBC (PBKDF2, 200k iterations) via OpenSSL; files are `chmod 600`.
- Retention: daily keeps 14 (`BACKUP_DAILY_RETENTION`), weekly per its own policy.
- Off-site: set `BACKUP_OFFSITE_DIR` and schedule cron on the production host.
- **Always run `restore:rehearsal` before any migration** and log the result in
  `docs/BACKUP_REHEARSAL_LOG.md`. The rehearsal creates `madrasa_rehearsal_<ts>`, restores
  into it + a temp storage dir, verifies table/user/file counts, and drops the disposable DB.

## 6. Ollama (local AI) startup and health checks

- Local, private, default provider `qwen3:4b` on `http://localhost:11434`.
- Config lives in DB setting `ai.config` (managed from `/admin/settings/ai`) — no `.env`
  needed to enable it; API secrets (external providers) stay in the env only.
```bash
ollama serve &                 # start the daemon (if not already running)
ollama list                    # expect qwen3:4b present
curl -s http://localhost:11434/api/tags | head   # health: lists installed models
```
- In-app test: `/admin/settings/ai` → "اختبار الاتصال". The `/pilot` center also shows a
  live AI connection line.
- If Ollama is down, the app shows the Arabic optional-service message and **stays fully
  usable**; never block the platform on AI.
- Inside Docker, the base URL must be `http://host.docker.internal:11434` (not localhost).

## 7. Log locations

- App logs: stdout/stderr of the `npm run dev` (or the service/PM2/systemd unit) process.
- Postgres logs: `docker logs madrasa-db`.
- **Audit trail** (in-app, authoritative for actions): `/admin/audit`, backed by the
  `audit_log` table. Feedback events are audited as `feedback.created`,
  `feedback.status_changed`, `feedback.archived`, `feedback.unarchived`,
  `feedback.attachment_download`, `export.feedback_xlsx`.

## 8. Feedback triage procedure

1. Open `/admin/feedback` (requires `feedback.manage`).
2. Filter by module / category / severity / status / date. "يعيق العمل" (blocked) items
   first; then severity "تمنع إكمال العمل".
3. Open an item, review captured metadata (page path, device class, viewport, browser,
   app version) and any private attachment.
4. Move status through: `جديدة → قيد المراجعة → مخطط لمعالجتها → تم الحل` (or `لن تُنفذ`,
   which **requires a documented reason**). `تم الحل` records a resolution note + date.
5. Never delete feedback. If needed, **archive** with a documented reason (reversible via
   "استرجاع"). Export the working set with the Excel button.
6. Reproduce blocking issues on `madrasa_test`, not on the real DB.

## 9. What to check after a restart

- `docker ps` shows `madrasa-db` Up (healthy) on 5544.
- `curl http://localhost:3080` returns 307 (redirect to /login).
- Log in; `/dashboard`, `/pilot`, `/people`, `/plan`, `/committees`, `/performance`,
  `/building`, `/admin/feedback` all render with no page-level horizontal overflow.
- `/pilot` shows the correct Fares state (Preview vs committed) and a live AI line.
- Ollama health (section 6) if AI is expected to be on.

## 10. Distinguishing real, synthetic-excluded, and pilot-feedback data

- **Real data**: official plan batch `385c615a-…` (منفذة, 26 programs), the Fares people
  batch `12673bed-…`, official performance models, and (after the principal commits Fares)
  the 52 materialized people. Never synthetic.
- **Synthetic-excluded data**: records created by e2e/demo runs (tagged «تجريبي آلي», demo
  plan years, `%تجريبي%` import batches). Hidden from every customer-facing query by the
  central filter `getExcludedIdSets()` / `notSynthetic()` in `src/lib/synthetic.ts`
  (always-on; toggle structural-only visibility with `MADRASA_INCLUDE_SYNTHETIC=1` in
  non-prod). The synthetic **archive** is deferred and NOT executed.
- **Pilot-feedback data**: the additive `feedback` table (refs `FB-0001…` from sequence
  `feedback_ref_seq`). Operational metadata about the pilot itself — never school domain
  data, and excluded from all domain counts/reports.

## 11. Recovery procedure for a failed Fares confirmation

Committing the Fares batch is the principal's manual action. If a confirmation appears not
to have taken effect:

1. Read-only verify the batch state:
   ```sql
   SELECT id, status, committed_at FROM import_batches
   WHERE id = '12673bed-c6ae-4f28-af9d-c311fb2e7a3d';
   SELECT count(*) FROM people
   WHERE import_batch_id = '12673bed-c6ae-4f28-af9d-c311fb2e7a3d';
   ```
   `منفذة` + `committed_at` set + 52 people = committed. `معاينة` + 0 people = not committed.
2. Check the audit trail for `import.batch_commit_started` / `import.batch_committed` and
   the returned **correlationId** (the commit path is instrumented). A `commit_started`
   with no `committed` points at a session-expiry or dropped response, not a data change.
3. The commit is idempotent and row-locked: a second confirmation cannot create duplicate
   people; a concurrent/late submit returns `ALREADY_EXECUTED`.
4. Session-expiry UX: an expired session returns a typed `SESSION_EXPIRED` with an Arabic
   notice + a validated `/login?returnTo=/imports/<id>` link — re-auth, then re-confirm.
5. Never run the commit from a script or SQL — only the principal via the UI.

## 12. Feedback migration (additive) — apply order

The feedback capability is the only new schema. Migration `0007` creates the `feedback`
table + `feedback_ref_seq` and touches no existing table.

```bash
# 1) Backup + verified rehearsal FIRST (section 5), then:
# 2) madrasa_test
MADRASA_ENV=test DATABASE_URL=postgresql://…/madrasa_test npx tsx src/db/migrate.ts
# 3) real DB (authorized additive migration only)
npm run db:migrate
# 4) seed the two RBAC permissions (idempotent, additive)
NODE_OPTIONS=--conditions=react-server npx tsx src/db/seed-feedback-rbac.ts
```

Verify afterward that every pre-existing domain table is unchanged (row counts /
content hashes) except migration metadata and the new (empty) feedback table.
