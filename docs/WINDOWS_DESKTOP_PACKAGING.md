# Windows desktop edition — technical packaging runbook

Scope: the offline, one-click Windows x64 edition ("Father's App") in `desktop/`. The
Mac/Ubuntu Docker deployment (`Dockerfile.production`, `compose.production.yml`,
`scripts/backup-*.sh`, `scripts/restore.sh`) is unchanged and remains the production path.
End-user instructions (Arabic): `desktop/guide/دليل-الاستخدام.html`, also shipped in the
installer and opened from «مساعدة ← دليل الاستخدام».

## 1. Architecture

```
FathersApp.exe (Electron 45, main process: desktop/main/main.js)
 ├─ orchestrator (desktop/lib/orchestrator.js — no Electron dependency)
 │   ├─ PostgreSQL 16.15 (EDB binaries)  pg_ctl start/stop -D <data>   127.0.0.1:<port>, SCRAM, no socket
 │   ├─ bootstrap: migrate.cjs / seed.cjs  (esbuild bundles of src/db/migrate.ts, src/db/seed.ts)
 │   └─ node.exe (Node 24.22.3) desktop-server-entry.cjs → Next.js 16 standalone server.js
 │         127.0.0.1:<port>, IPC pipe to the launcher, authenticated readiness, job drain
 └─ BrowserWindow (sandboxed, no Node, no preload) → http://127.0.0.1:<port>
       every renderer request not addressed to that origin is cancelled
```

Installed (read-only, per-machine): `C:\Program Files\FathersApp\` (the server tree is installed by NSIS directly — electron-builder drops `node_modules` from `extraResources`)
`resources\{app.asar, server, node, pgsql, chromium, poppler, guide, BINARIES.lock.json, THIRD_PARTY_NOTICES.md}`.

Per-user data: `%LOCALAPPDATA%\FathersApp\`

| Path | Content |
| --- | --- |
| `postgres\data`, `postgres\postgres.log` | private cluster (relocated to an ASCII path if needed, §4) |
| `storage\` | attachments, generated documents (`STORAGE_DIR`) |
| `backups\weekly\full-*.tar.gz.enc` (+`.sha256`) | full encrypted backups (`BACKUP_DIR=backups`) |
| `backups\safety\` | automatic pre-upgrade / pre-restore safety copies (local only) |
| `config\secrets.bin` | DB passwords + backup key, DPAPI-protected (Electron `safeStorage`) |
| `config\state.json`, `config\settings.json` | bootstrap/migration state, ports, off-device folder |
| `run\session.json`, `run\launcher.lock` | runtime metadata (absent after a clean exit) |
| `logs\launcher.log`, `logs\server.log` | rotated at 5 MB; no secrets are logged |

## 2. Lifecycle guarantees

**Start** (`Orchestrator.start`): data-dir lock → stale cleanup → secrets → `initdb` (first
run only; atomic: staging dir renamed into place) → `pg_ctl start -w` → app role/db (once)
→ migrations **only when `drizzle/meta/_journal.json` changed**, preceded by a safety
backup when data exists → seed **only when the `users` table is empty** (so restored or
existing data is never re-seeded, even if `state.json` is lost) → `node.exe` server →
readiness.

**Readiness protocol.** The launcher generates a 256-bit token per launch and passes it to
the server process in its environment (removed before app code runs). The entry wraps
Next's request listener: `GET /__fathersapp/ready` answers only with the matching
`x-fathersapp-token` header (constant-time compare), otherwise 404. The entry reports
`ready` over the private IPC pipe only after `/api/health` returns `db: up`; the launcher
then independently re-verifies over HTTP that the listener knows the token and reports its
child's PID — a foreign process on the port cannot pass.

**Ports.** Both services bind 127.0.0.1 only. The last-used port is preferred (keeps the
browser origin — cookies, service worker, offline queue — stable); any conflict falls back
to an OS-assigned free port, with up to three retries.

**Stop** (window close / menu): server drains in-flight HTTP requests and background report
jobs (≤ 120 s; any job still running is marked `فشل` with «أُغلق التطبيق قبل اكتمال التوليد —
أعد المحاولة», the existing retry UI handles it) → daily automatic backup if due → `pg_ctl
stop -m fast -w` on our data directory (escalates to `-m immediate`, still scoped to it) →
metadata removed.

**Abnormal paths.**

| Event | Handling |
| --- | --- |
| Launcher crash / killed | server sees IPC disconnect and shuts itself down; next start stops our leftover PostgreSQL via `pg_ctl` and kills a leftover server only if its command line proves it is our entry |
| Windows shutdown / restart / log-off | `session-end` → synchronous fast `pg_ctl stop` (15 s); if Windows still kills us, WAL recovery on next start |
| Power loss | PostgreSQL crash recovery during the next `pg_ctl start -w` (fsync/full_page_writes on) |
| Interrupted first run | partial `initdb` never becomes `data`; seed re-runs only while `users` is empty |
| Second double-click | `requestSingleInstanceLock` → existing window restored and focused |
| Server crash while open | Arabic dialog: restart (same data) or close safely |
| Upgrade/uninstall while our PostgreSQL is orphaned | NSIS hook stops postgres.exe processes whose executable sits inside a Father's App install, using that install's `pg_ctl` — never other PostgreSQL, never a kill |

## 3. Security controls

- Authentication, RBAC, CSRF tokens, Argon2id, TOTP and the security headers/CSP are the
  unchanged application. Server actions: build-time `TRUSTED_ORIGINS=127.0.0.1` (same-origin
  only). Session cookie stays `Secure; HttpOnly; SameSite=Lax` — Chromium treats
  `http://127.0.0.1` as a secure context, verified by the E2E (`session-cookie-secure-httponly`).
- No listener on any non-loopback interface (asserted by the lifecycle harness against a
  real interface address); PostgreSQL `pg_hba` allows only `127.0.0.1/32` with SCRAM.
- App connects as non-superuser `madrasa` owning only its database; superuser password is
  used only for administration (create/rename databases during restore).
- Renderer: sandbox, context isolation, no Node, no preload, navigation restricted to the
  app origin, permissions denied except clipboard-write/fullscreen, `webRequest` cancels
  every non-app URL, spellcheck dictionary download disabled.
- Child processes run with a sanitized environment (PATH = System32 only); every tool is
  invoked by absolute path from the install folder.
- Installer is per-machine (`Program Files`), so binaries are not writable without elevation;
  CI asserts the `Users` ACL has no write rights.

## 4. Non-ASCII user profiles

PostgreSQL on Windows mishandles data-directory paths that are not representable in the ANSI
code page (e.g. an Arabic user name on an English-locale Windows). If `%LOCALAPPDATA%` is not
ASCII, the cluster root becomes the 8.3 short path; if 8.3 names are disabled, a per-user
`%ProgramData%\FathersApp\pg-<hash>` folder whose ACL is reset to the user + SYSTEM +
Administrators. The choice is stored in `state.json` and never changes afterwards. Dumps and
restores stream through Node (stdin/stdout), so no non-ASCII path reaches PostgreSQL tools.

## 5. Backup and restore

Format = Mac/Linux weekly backup (`db.dump` custom format, `package.json`, `storage/`) +
`manifest.json` (SHA-256 and size per member), gzip, then **byte-compatible** `openssl enc
-aes-256-cbc -pbkdf2 -iter 200000`. A desktop backup restores with `scripts/restore.sh` on the
server and a server weekly backup restores in the desktop app (manifest-less "legacy" mode).

Integrity: sidecar SHA-256 of the encrypted file; per-member hashes after decryption;
`pg_restore --list` on the dump; every new backup is fully verified right after creation.

Retention: newest 14 full backups, newest 5 safety copies (names matching
`full-YYYYMMDD-HHMMSS*.tar.gz.enc` only). Automatic backup: at the first close of each day.
Off-device: optional folder (USB / synced cloud folder); each copy is re-hashed.

Keys: random 256-bit backup key per installation, DPAPI-protected; exportable as a
recovery-key text file (prompted on first run until exported). Restore accepts this
machine's key, a recovery-key file, or a pasted key (e.g. the server's `BACKUP_PASSPHRASE`).

Restore order (any failure before the swap leaves live data untouched): verify → safety
backup → stop server → restore into a staging database → rename live DB to
`madrasa_prev_<stamp>` and staging to `madrasa` → swap `storage` (previous kept as
`storage.prev-<stamp>`) → migrate if the backup is older → start server.

## 6. Third-party runtimes and verification

`desktop/binaries.manifest.json` pins every archive by SHA-256; `scripts/fetch-binaries.mjs`
refuses mismatches and writes `BINARIES.lock.json` (per-file hashes of every shipped
exe/dll), which is shipped in the installer and uploaded with it.

| Runtime | Version | Pin source |
| --- | --- | --- |
| Node.js | 24.22.3 | equals nodejs.org `SHASUMS256.txt` |
| PostgreSQL (EDB) | 16.15-1 | trust-on-first-use on a GitHub Windows runner (run 43627935944); EDB publishes no checksum file — **re-verify against an independent download before a real release** |
| Chrome Headless Shell | 149.0.7827.55 (Playwright 1.61.1 revision 1228) | Google Chrome-for-Testing bucket |
| Poppler | 26.02.0 (poppler-windows) | project GitHub release |
| VC++ 2015–2022 runtime | from the runner's Visual Studio redistributable folder | app-local deployment, hashes recorded in the lock file |

`scripts/check-pe-deps.mjs` parses the PE import tables of every bundled exe/dll/node addon
and fails if a dependency is neither alongside it nor a Windows system DLL. The VC++ runtime
is deliberately not treated as a system DLL, which is how CI (whose runners have the VC++
runtime installed) still proves clean-machine compatibility. `poppler-glib.dll` and
`poppler-cpp.dll` are excluded (unused; glib not shipped).

Native modules (`@node-rs/argon2`, `sharp`) are N-API and installed as their `win32-x64-msvc`
variants because the standalone build runs on Windows.

## 7. Building

On Windows x64 (or let `.github/workflows/windows-desktop.yml` do it):

```bash
npm ci
```

```bash
node desktop/scripts/prepare-app.mjs
```

```bash
node desktop/scripts/fetch-binaries.mjs
```

```bash
node desktop/scripts/fetch-binaries.mjs --vc-runtime "<VS>\VC\Redist\MSVC\<ver>\x64\Microsoft.VC14x.CRT"
```

```bash
node desktop/scripts/check-pe-deps.mjs desktop/vendor desktop/build/server/node_modules
```

```bash
cd desktop && npm ci --ignore-scripts && npx electron-builder --win nsis --x64 --publish never
```

Output: `desktop/dist/FathersApp-Setup-<version>-x64.exe`. `prepare-app.mjs` fails closed if
the app tree contains `reference_files`, private storage, backups, `.env*`, credentials,
office/image documents, docs/tests/scripts, or any symlink.

## 8. Tests

| Test | Where | What |
| --- | --- | --- |
| `tests/unit/desktop-edition.test.ts` | Vitest (all OS) | openssl interop both ways, wrong key, tar round trip incl. Arabic/long names, GNU tar compatibility, traversal/truncation rejection, secrets/recovery key, retention, ports, job-constant contract, installer hook content |
| `desktop/tests/lifecycle-harness.cjs` | Linux (system PG) and Windows CI (bundled runtimes) | first run, health, loopback-only, token-guarded readiness, PDF via bundled Chromium, backup, tamper + wrong-key rejection, restore, clean stop, warm restarts, crash recovery, seed-once |
| `desktop/tests/electron-e2e.mjs` | Linux/Xvfb and Windows CI (installed exe, firewalled) | real window, single instance, login, Secure cookie, PDF/XLSX/DOCX export, renderer network blocked, graceful close stops PostgreSQL, 3 warm cycles, hard-kill recovery |
| `FathersApp.exe --self-test=<json> [--self-test-backup]` | Windows CI / support | full launch, health, login page, window render, verified backup, clean stop, timings |
| `verify` job | fresh Windows runner | install, ACL, shortcut, cold/warm benchmarks (system-only PATH), upgrade with data kept, crash + orphaned PostgreSQL upgrade with an unrelated PostgreSQL service running, Arabic data path, uninstall keeps data |

Not automatable on hosted CI (manual checklist before handing the installer to the school):
a real reboot/shutdown with the app open, SmartScreen behaviour of the unsigned installer,
a truly clean Windows 10/11 machine (no Visual Studio, no Node, no PostgreSQL), an
Arabic-locale Windows with an Arabic user name, and a restore of a real server backup on
the principal's laptop (principal's explicit action only).

## 9. Signing (open)

The installer and executables are not code-signed (no certificate provisioned). Windows
SmartScreen will warn on first run. Before distribution, sign with an organisation
certificate (`CSC_LINK`/`CSC_KEY_PASSWORD` for electron-builder, or Azure Trusted Signing).
