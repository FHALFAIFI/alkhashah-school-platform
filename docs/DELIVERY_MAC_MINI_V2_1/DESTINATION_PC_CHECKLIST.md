# Destination-PC (Principal's Local PC) Migration-Readiness Checklist

> **Data-gathering only. No migration is started, and nothing is copied, installed, restored, or
> deployed to the principal's PC by this package.** Complete this checklist and obtain explicit
> authorization before any host-PC migration is planned.

## A. Operating system & hardware

| # | Item | Requirement | Value (to fill) |
|---|---|---|---|
| 1 | OS and edition | Windows 11 Pro (Hyper-V/WSL2) or Linux (Docker native); Windows Home needs WSL2 | |
| 2 | CPU architecture | x86-64 or ARM64 (image is multi-arch via node:24 / postgres:16-alpine) | |
| 3 | RAM | ≥ 8 GB (16 GB recommended for app + Postgres + optional Ollama) | |
| 4 | Free disk space | ≥ 20 GB free (images + `pgdata` + `storage` + local backups) | |
| 5 | Storage reliability | SSD; SMART healthy; not a failing/near-full drive | |
| 6 | Docker / virtualization | Docker Desktop or Engine installed; virtualization enabled in BIOS; WSL2 backend on Windows | |

## B. Network & access

| # | Item | Requirement | Value (to fill) |
|---|---|---|---|
| 7 | Static LAN address | Reserved static IP or DHCP reservation for stable `APP_BIND`/`TRUSTED_ORIGINS` | |
| 8 | Router / firewall | Local firewall allows the app port on the LAN only; **PostgreSQL never exposed**; no inbound WAN port-forward | |
| 9 | Tailscale | Tailscale installed + logged into the same tailnet; `tailscale serve --bg 3080` for remote HTTPS (private tailnet, **no Funnel**) | |
| 10 | Local admin access | Administrator rights to install Docker, manage services, set startup | |
| 11 | Future remote support | Agreed method (Tailscale SSH / screen share) for maintenance | |

## C. Resilience & operations

| # | Item | Requirement | Value (to fill) |
|---|---|---|---|
| 12 | Backup destination | External disk or second Tailscale node for off-machine encrypted backups | |
| 13 | Power-loss handling | Postgres `stop_grace_period` honored; journaled filesystem | |
| 14 | UPS availability | UPS recommended (school PC may lose power) | |
| 15 | Automatic startup | Docker set to start on boot; compose `restart: unless-stopped` (already set) | |

## D. Pre-migration gate (do NOT start until all true)

- [ ] Principal has **accepted** Scope v2.1 on the Mac mini (acceptance checklist signed).
- [ ] Final release tag created (post-acceptance).
- [ ] A fresh encrypted backup taken and **restore-rehearsed** on the destination PC.
- [ ] Destination-PC rows A–C above filled and reviewed.
- [ ] Explicit written authorization to migrate to the host PC (separate from this authorization).
- [ ] Cutover window agreed; rollback path (keep Mac mini running until sign-off) confirmed.

## E. Migration outline (for later — not executed now)

1. Install Docker + Tailscale on the PC; reserve static LAN IP.
2. Copy the encrypted backup + `.env.production` (secrets) securely to the PC.
3. `docker compose … up -d --build` once to build the image and bring up an **empty** DB, then **stop**, drop the seeded DB, and `restore.sh` the production backup (so live data — not seed data — is what runs). Alternatively load the exported image and restore before first app start.
4. Verify with `RELEASE_CANDIDATE.md` §7 (17 migrations, fingerprint == F0, 129/129/0).
5. Repoint `APP_URL`/`TRUSTED_ORIGINS`/`APP_BIND`; enable Tailscale Serve.
6. Run in parallel with the Mac mini until the principal signs off, then decommission the Mac mini instance.
