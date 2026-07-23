# Production Deployment Report — Scope v2

**Result: SUCCESS.** Migrations 0010–0015 applied to production, 129 milestones reconciled
one-to-one into 129 activities, new app image (commit `2f66d80`) deployed and healthy. All
retained data intact. No release tag. Principal acceptance remains **PENDING** until the
principal completes `/pilot` and submits feedback.

## Timing (UTC)

| Event | Time |
|---|---|
| Deploy start (image build) | 2026-07-23 19:49:47 |
| App stopped — downtime begins | 2026-07-23 19:54:32 |
| Migrations applied | 2026-07-23 ~19:56:45 |
| Backfill + reconciliation done | 2026-07-23 19:57:46 |
| New app up — downtime ends | 2026-07-23 ~19:57:55 |
| Persistence-test restart (~10 s blip) | 2026-07-23 19:59:33 |
| Deploy end (after smoke) | 2026-07-23 20:02:17 |

**Downtime ≈ 3 min 20 s** (single deployment window), plus a ~10 s blip during the
restart/persistence check.

## Applied commit and migrations

- Commit: `2f66d80` (app image `madrasa-app:0.1.0`).
- Migrations: **0010, 0011, 0012, 0013, 0014, 0015** (additive only).
- `program_milestones` never dropped or modified.

## Pre/post record counts

| Metric | Pre | Post |
|---|---|---|
| migration level | 0009 (10) | 0015 (16) |
| people | 54 | 54 |
| programs | 26 | 26 |
| program_milestones | 129 | 129 |
| program_activities | (absent) | 129 (all migrated 1:1) |
| feedback | 1 | 1 |
| stored_files | 10 | 10 |
| evidence_items | 2 | 2 |
| documents | 4 | 4 |
| users | 2 | 2 |
| audit_log | 88 | 90 (append-only) |

## Reconciliation

D-022 fingerprint F0 = `8d5375e0f610ee06cd80702b4f1427a3967cbf19884ef091820d2f5a77a382cf`
(count 129) — verified identical before backup, before migration, and after backfill.
`run-milestone-backfill.ts` reconciliation: every milestone mapped exactly once, no orphans,
no duplicates, no dangling refs, program association unchanged, weight/progress no drift,
26 programs covered, legacy table intact. Exit 0.

## Backup / restore

| Field | Value |
|---|---|
| Backup file | `/data/backups/weekly/full-20260723-195508.tar.gz.enc` |
| Size | 19,326,288 bytes |
| SHA-256 | `540b60281231c551380bb815a230255807320470319065d32fe40dd790393bc6` |
| Restore rehearsal | **PASS** into disposable DB — 66 tables, 54 people / 26 programs / 129 milestones / 1 feedback / 10 stored_files, 11 files on disk |
| Recovery manifest | `docs/RECOVERY_MANIFEST_20260723.md` |

## Docker health / restart

- `madrasa-prod-app-1`: **healthy** (image `2f66d80`); `madrasa-prod-db-1`: **healthy**.
- Restart + persistence: app restarted → healthy in ~12 s, data intact (54/129/129), login 200.

## Reachable /pilot URL

`http://192.168.0.48:3080/pilot` — verified reachable (login 200, /pilot 307 auth-gate,
authenticated smoke loaded the v2 checklist). This is the LAN retest route; the Tailscale
HTTPS path `https://<tailnet-host>/pilot` also fronts the same app on the host.

## Effective status of the temporary LAN route

**Unchanged from before this deployment.** The app is bound to `192.168.0.48:3080` exactly as
it was pre-deploy (`APP_BIND` in `.env.production`); the approved TEMPORARY LAN-retest change in
`compose.production.yml` was left untouched. `ALLOW_INSECURE_LAN_HTTP` semantics unchanged. No
network access was broadened.

## Post-deployment smoke (production, real browser)

- Login (sysadmin) → dashboard → `/pilot` (v2 checklist + task links).
- Module pages load < 500 with headings: plan, budget, facilities, committees, performance,
  reports, people, evidence.
- A program shows «الأنشطة — أساس حساب تقدم التنفيذ», not «المعالم الموزونة».
- Mobile RTL 390×844: `/pilot`, `/budget`, `/building/facilities`, `/reports` — no horizontal
  overflow.

## Exposure

- PostgreSQL: `5432/tcp → null` — not published.
- Ollama: `127.0.0.1:11434` — host-loopback only.
- App: `192.168.0.48:3080` only (same as pre-deploy).

## Retained data / feedback

All evidence, uploaded files (10 records / 11 files), feedback (1), audit history (append-only,
88→90), documents (4), users (2) preserved. No reset, reseed of operational data, delete, or
import.

## Deviations

1. **`seed.ts` ran during app cutover.** `docker compose up -d app` pulled in the `init`
   service (a declared dependency) whose command is `migrate && seed`. Migrate was a no-op
   (already applied); `seed.ts` then ran. `seed.ts` is idempotent reference-data seeding only
   (RBAC, 2 accounts via upsert, school/stages, calendar, committee/inspection templates,
   zones/floors, settings) — it creates no operational data and performs no imports. Verified
   immediately after: every operational count unchanged (people 54, programs 26, milestones
   129, activities 129, feedback 1, stored_files 10, users 2) and the milestone fingerprint
   still equals F0. No data corruption; the deviation was benign. To avoid triggering `init`
   on future app-only restarts, use `docker restart madrasa-prod-app-1` or
   `up -d --no-deps app`.

No other deviations. No preflight or deployment gate failed.

## Confirmations

- No official school data imported.
- No destructive reset, reseed of operational data, or delete.
- No new network exposure (PostgreSQL and Ollama remain unexposed; app binding unchanged).
- No release tag created.
- Principal acceptance remains **PENDING** until the principal completes `/pilot` and submits
  feedback.
