# Recovery Manifest — Scope v2.1 Production (Mac mini)

| Field | Value |
|---|---|
| **Date / time** | 2026-07-26, ~11:25–11:32 Asia/Riyadh |
| **Compose project** | `madrasa-prod` |
| **Source commit** | `8fb59c17d1d82e2bd7c4825013bb8e5dbf5050f5` (branch `scope-v2.1-corrections`) |
| **Application image** | `madrasa-app:0.1.0` |
| **Image ID / digest** | `sha256:a492d908bcfb8e97d578eea5b71f186e42e09b14c85f0fa2cb194d1b9a5e529a` |
| **Image config digest** | `sha256:e218e7685d6132d69fe80e93dadcee233cf4a14d963246916fdeb4df4ae9816f` |
| **Rollback image (prev v2)** | `madrasa-app:0.1.0-prev-v2-20260723` = `sha256:d6df008b3a3859d821921a68921db6a36e030177930112b44ae05801d23e4a4a` |
| **Migration level** | `0016` (`0016_high_mentor`, hash `83a4babb057b4cc8d339510edba1d3c4bcd05096b64e38eac49fffbda1ebaeb1`) — 17 journal rows |
| **DB counts (post-deploy)** | users 2 · people 54 · programs 26 · milestones 129 · activities 129 · feedback 1 · stored_files 18 · evidence 3 · documents 10 · audit_log 146 · committees 3 · committee_members 10 · committee_templates 6 · committee_task_templates 0 · committee_task_assignments 0 · budget_income 2 · budget_expenses 1 · perf_cycles 6 · perf_sessions 2 · perf_ratings 38 · meeting_types 5 (all `requires_signature=false`) |
| **Public tables** | 78 (was 76 at 0015; +committee_task_templates, +committee_task_assignments) |
| **D-022 milestone fingerprint (F0)** | `8d5375e0f610ee06cd80702b4f1427a3967cbf19884ef091820d2f5a77a382cf` (count 129) — unchanged pre/post migration |
| **Milestone/activity reconciliation** | 129 milestones ↔ 129 activities via `migrated_from_milestone_id`, 129 distinct, 0 orphans (1:1) |
| **Uploaded files** | 19 physical files in `madrasa-prod_storage` (≥ 18 `stored_files` rows), readable |
| **Backup filename** | `backups/weekly/full-20260726-rc-v2_1.tar.gz.enc` |
| **Backup size** | 21,106,304 bytes |
| **Backup SHA-256** | `11eafe7929ce49d7727840f174d8902b3965aa50a51ae3bd64e42a31cf558642` |
| **Encryption** | OpenSSL AES-256-CBC, PBKDF2, 200,000 iterations, salted — passphrase = `BACKUP_PASSPHRASE` (in `.env.production`, NOT in this package) |
| **Archive layout** | `db.dump` (pg_dump custom format) · `package.json` · `env.example` · `storage/` — compatible with `scripts/restore.sh` |
| **Restore rehearsal** | PASS — restored into a disposable DB on the dev container; 76 tables, all counts identical, reconciliation 129/129/0, fingerprint == F0, 19 files readable; disposable DB dropped |

## Restore requirements

- Docker + Docker Compose, Postgres 16 image (`postgres:16-alpine`).
- `openssl` (AES-256-CBC / PBKDF2) to decrypt.
- `BACKUP_PASSPHRASE` (from the operator's `.env.production`) — **without it the backup cannot be decrypted.**
- Target DB must be empty/replaceable. `scripts/restore.sh` uses `pg_restore --clean --if-exists --no-owner`.

## Restore command (documented — operator action)

```bash
# 1) bring up an empty target DB (compose `db` service), then:
scripts/restore.sh backups/weekly/full-20260726-rc-v2_1.tar.gz.enc \
  "postgresql://madrasa:<PASSWORD>@localhost:5432/madrasa" ./storage-restored
# 2) verify: migration rows = 17, milestone fingerprint == 8d5375…a382cf, reconciliation 129/129/0
```
