# Docker Homelab Deployment

Private homelab deployment of the school-management platform. English per the language policy;
the application stays Arabic/RTL. Companion: `docs/DOCKER_OPERATIONS.md` (day-2 ops),
`docs/CLEAN_PRODUCTION_BASELINE.md` (the clean reset + cutover/rollback).

## Architecture

```
        Principal's device (iPhone/laptop, on the tailnet)
                         │  HTTPS (Tailscale)
                         ▼
   Ubuntu / Mac-mini host ──  tailscale serve  → 127.0.0.1:3080
                         │
   ┌─────────────────────┴───────────── Docker (project: madrasa-prod) ──┐
   │  app  (Next.js, non-root)  ──internal──▶  db (postgres:16, NOT published) │
   │   127.0.0.1:3080 only                     volume: pgdata                  │
   │   volumes: storage, backups                                              │
   └──────────────────────────────────────────────────────────────────────────┘
                         │ (optional) host-gateway
                         ▼
             Ollama (native on host — Mac Metal / Ubuntu)
```

Non-negotiables enforced by this stack: **PostgreSQL is never published** (no `ports:` on `db`);
the **app binds `127.0.0.1:3080` only**; **no router ports, no public reverse proxy, no Tailscale
Funnel**; Ollama is not exposed. Remote access is exclusively via **Tailscale Serve** on the host.

## Files

| File | Purpose |
| --- | --- |
| `Dockerfile.production` | Multi-stage image: build → lean non-root runner with Chromium (Arabic PDF), poppler, pg-client. Health via `/api/health`. |
| `compose.production.yml` | `db` (internal), one-shot `init` (migrate + reference seed), `app` (localhost-only, read-only fs + tmpfs, healthcheck, log rotation, `restart: unless-stopped`). |
| `.env.production.example` | Template — **no secrets**. Copy to `.env.production` (git-ignored) and fill. |
| `.dockerignore` | Keeps secrets/data/build-output out of the image context. |

## 1) Ubuntu host preparation

```bash
sudo apt-get update && sudo apt-get -y upgrade
# Docker Engine + compose plugin
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # re-login afterwards
docker --version && docker compose version
```

Recommended host: 4 vCPU / 8 GB RAM / 40 GB disk (Chromium PDF rendering is the heaviest task).
A UPS is recommended (see power-outage recovery in `DOCKER_OPERATIONS.md`).

## 2) Environment / secrets

```bash
cp .env.production.example .env.production
# generate strong secrets:
#   POSTGRES_PASSWORD : openssl rand -base64 24
#   SESSION_SECRET    : openssl rand -hex 32
#   BACKUP_PASSPHRASE : openssl rand -base64 32   (store OFF the server; never in Git/backup)
nano .env.production
```

`.env.production` is git-ignored. Encryption keys are never committed and never placed inside a
backup archive.

## 3) Start the stack

```bash
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod up -d --build
```

Order: `db` becomes healthy → `init` applies **all migrations** then seeds **reference data only**
(RBAC, principal + administrator accounts, school identity/branding, official 1448-1449 calendar,
committee templates, the 8 official performance models + D-014 status, meeting types, system
inspection-template defaults, settings, numbering sequences) → `app` starts and passes its health
check. **No demo/operational rows are ever seeded.**

Initial credentials are written inside the container to `/data/storage/private/initial-credentials.txt`
(persisted in the `storage` volume). Retrieve, change the passwords on first login, enable TOTP,
then delete the file (see `DOCKER_OPERATIONS.md`).

## 4) Health verification

```bash
curl -fsS http://127.0.0.1:3080/api/health          # {"status":"ok","db":"up",...}
docker compose -p madrasa-prod ps                    # app + db healthy
```

Confirm PostgreSQL is **not** reachable from outside the Docker network:

```bash
docker compose -p madrasa-prod exec db pg_isready    # ok from inside
nc -vz 127.0.0.1 5432 || echo "closed on host — correct (db not published)"
```

## 5) Tailscale (host — private HTTPS, no Funnel)

Install on the **host**, not in the container. Do not run Tailscale inside the app container.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up                       # authenticate; join the dedicated school tailnet
sudo tailscale set --hostname school-server
# MagicDNS: enable in the tailnet admin console (DNS → MagicDNS)

# Verify the installed Serve syntax for YOUR version before running it:
tailscale version
tailscale serve --help

# Expose the local app privately over HTTPS (current syntax):
sudo tailscale serve --bg 3080
tailscale serve status                  # shows https://school-server.<tailnet>.ts.net → 127.0.0.1:3080
```

- **Never** `tailscale funnel` (that would expose it publicly) — do not use it.
- Restrict the principal (tailnet ACLs) to the school app only — **no** SSH, PostgreSQL, NAS,
  hypervisor, router, or Ollama access.
- Tailscale identity and the platform login are **separate**: being on the tailnet only reaches the
  login page; the principal still authenticates with username/password (+ optional TOTP).

Then set in `.env.production`:
```
APP_URL=https://school-server.<tailnet>.ts.net
TRUSTED_ORIGINS=*.ts.net          # or pin the exact device name
```
and restart the app: `docker compose -p madrasa-prod up -d app`.

## 6) Ollama (optional; platform works fully without it)

**Pattern A — Mac mini (Apple Silicon, recommended):** run Ollama **natively** on macOS for Metal
acceleration; the container reaches it via `host.docker.internal` (already wired with
`extra_hosts: host.docker.internal:host-gateway`). Set `AI_ENABLED=true`,
`OLLAMA_BASE_URL=http://host.docker.internal:11434`. Do **not** publish Ollama.

**Pattern B — Ubuntu:** either run Ollama natively on the host (same `host.docker.internal` URL) or
as a container. With an NVIDIA GPU, install the **NVIDIA Container Toolkit** and add a `deploy.resources`
GPU reservation to an Ollama service. With no accelerator, expect slower responses — AI stays optional;
every AI-dependent screen degrades gracefully with an Arabic notice and manual fallbacks.

## 7) Backups

See `DOCKER_OPERATIONS.md` for the daily/weekly/retention/checksums/off-site schedule and the
monthly disposable-restore rehearsal. `BACKUP_PASSPHRASE` must be stored **off the server** and
never inside the backup archive or Git.

## Quality Gate 8 (clean deployment proof)

Recorded in `docs/CLEAN_PRODUCTION_BASELINE.md`: empty volumes → build → db up → migrate → reference
seed → app up → health ok → principal login → Arabic RTL → **zero demo operational records** → import
pages present → building editor / template CRUD / asset archive / feedback work → Ollama graceful
failure → restart persistence → encrypted backup → disposable restore → **PostgreSQL not externally
reachable** → app localhost-only before Tailscale Serve.
