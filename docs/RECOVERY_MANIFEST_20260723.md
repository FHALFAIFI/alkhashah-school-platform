# Recovery Manifest — Scope v2 production deployment (2026-07-23)

Captured with the production app stopped (writes prevented). Read-only integrity snapshot
taken immediately before applying migrations 0010–0015.

## Backup artifact

| Field | Value |
|---|---|
| File | `/data/backups/weekly/full-20260723-195508.tar.gz.enc` (backups volume) |
| Size | 19,326,288 bytes |
| SHA-256 | `540b60281231c551380bb815a230255807320470319065d32fe40dd790393bc6` |
| Encryption | AES-256-CBC, PBKDF2 200k iters (`scripts/backup-lib.sh`) |
| Contents | full DB custom dump + uploaded files (weekly = DB + files) |

## Pre-migration database state (production `madrasa`)

| Item | Value |
|---|---|
| Migration level | 0009 (10 tracking rows) |
| people | 54 |
| programs | 26 |
| program_milestones | 129 |
| program_activities | (table absent) |
| feedback | 1 |
| stored_files | 10 |
| uploaded files on disk | 11 |
| audit_log | 88 |
| D-022 milestone fingerprint (F0) | `8d5375e0f610ee06cd80702b4f1427a3967cbf19884ef091820d2f5a77a382cf` (count 129) |

## Deployment target

| Item | Value |
|---|---|
| Source commit | `2f66d80` |
| Migrations | 0010, 0011, 0012, 0013, 0014, 0015 (additive only) |
| App image | `madrasa-app:0.1.0` (built from 2f66d80) |

## Prior verified backup (same cycle)

`full-20260723-190243.tar.gz.enc` — sha256
`63c42bbd2bc3d91cd5ad91a891f8a01edea1d8d4ff3f820e90f32cb3aa293e75` — restore rehearsal PASS.
