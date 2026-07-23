# Production Deployment Plan — Scope v2 (migrations 0010–0015)

**Status:** READY FOR OWNER AUTHORIZATION. Nothing in this plan has been executed against
production. Production remains at migration **0009** with its retained legitimate pilot data
(54 people, 26 programs, 129 milestones) fully intact.

**Authorization required before any step below runs.** Permission denial in the working
environment is not the deployment control — the control is this completed plan plus the owner's
explicit go-ahead.

---

## 1. What will change

**Additive migrations only** — 0010, 0011, 0012, 0013, 0014, 0015. No `DROP`, no column
narrowing, no data rewrite. New objects:

| Migration | Adds |
|---|---|
| 0010 | `evidence_versions`; `evidence_items.version/archived_*`; `people.employee_type` |
| 0011 | `program_activities`, `activity_deliverables`, `activity_evidence_requirements`, `activity_state_history`; `programs` weighting/completion/override/archive columns |
| 0012 | `perf_signed_report_versions`; `perf_sessions` narrative + `evaluation_completed_at` |
| 0013 | `committees.assignment_doc_id/signed_assignment_file_id`; `committee_members.effective_*/end_reason` |
| 0014 | `budget_income`, `budget_expenses` |
| 0015 | `facility_checklist`, `facility_room_links` |

`program_milestones` is **never written to or dropped** — it remains the read-only rollback
source (D-020). Its physical removal is a later, separately approved cleanup migration.

**Verified migration paths (both clean, run on disposable `_test` databases):**
- Empty database → all 16 migrations → 76 tables.
- Production-schema clone (0009 + prod's 10 tracking rows) → applies **only 0010–0015** →
  16 tracking rows, all new tables present, `program_milestones` untouched.

---

## 2. Reconciliation controls (D-022 — approved baseline 129)

The milestone→activity backfill is a **data step**, run once after 0011, gated by the baseline
controls:

1. **Before backup:** `verify-milestone-baseline.ts` must report count == **129** and print
   the source fingerprint F0.
2. **Immediately before the backfill:** re-run it with F0; count must still be 129 **and** the
   fingerprint must match F0. Any drift → STOP and report; never accept a new count.
3. Run `backfillMilestonesToActivities()` (idempotent — safe to re-run).
4. Run `reconcileMilestoneMigration()`; **every** row must pass: 129 mapped exactly once, no
   orphans, no duplicates, no dangling refs, program association unchanged, weight/progress
   carried without drift, legacy table row-count still 129.
5. Programs stay in **equal weighting mode**; legacy `weight=20` is preserved on each activity
   for traceability only. The one 4-activity program (Σ=80) is valid under equal mode and would
   only block completion if a user later switches it to custom mode.

If step 1 or 2 shows anything other than 129 + matching fingerprint, deployment stops before
touching production.

---

## 3. Ordered runbook (execute only after authorization)

```
# 0. Confirm health
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod ps

# 1. Baseline check #1 (must print 129 + fingerprint F0)
docker compose ... exec -T app \
  env NODE_OPTIONS=--conditions=react-server npx tsx scripts/verify-milestone-baseline.ts

# 2. Fresh encrypted backup + checksum (record both)
docker compose ... exec -T app npm run backup:weekly
docker compose ... exec -T app sh -c 'sha256sum /data/backups/weekly/full-<STAMP>.tar.gz.enc'

# 3. Disposable restore rehearsal (must print «نجحت بروفة الاستعادة»)
docker compose ... exec -T app npm run restore:rehearsal

# 4. Apply schema migrations 0010–0015 (additive; init service, migrate only — NOT seed)
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm --no-deps init npx tsx src/db/migrate.ts

# 5. Baseline check #2 with F0 (count still 129, fingerprint unchanged)
docker compose ... exec -T app npx tsx scripts/verify-milestone-baseline.ts <F0>

# 6. Backfill milestones → activities (idempotent)
#    then reconcile; abort on any failing row
docker compose ... run --rm --no-deps init \
  env NODE_OPTIONS=--conditions=react-server npx tsx scripts/run-milestone-backfill.ts

# 7. Deploy the new application image (UI cutover), then health-check
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod up -d --build app
docker compose ... ps
```

**Never run `src/db/seed.ts` against production** — it is paired with migrate in the `init`
service for first-boot only; re-running it against live data is prohibited. Use the migrate-only
invocation above.

> Note: step 6 references `scripts/run-milestone-backfill.ts`, a thin wrapper that calls
> `backfillMilestonesToActivities()` then `reconcileMilestoneMigration()` and exits non-zero on
> any failing reconciliation row. It is authored at deployment time so the backfill is a single
> reviewed command; the underlying functions are already implemented and tested.

---

## 4. Rollback (D-023)

**Preferred: application rollback.** Redeploy the previous app image; leave the additive schema
in place. Old code is unaffected because Drizzle emits explicit column lists (never `SELECT *`),
so the new tables/columns are inert to it. This is the default and safest path once any new data
exists.

**Schema rollback (drop the 6 migrations' objects)** is permitted **only**:
- before those tables/columns contain any production-created data, **or**
- after that data has been exported and its restoration verified.

Rollback must **never** destroy newly created activity, KPI signed-report, committee assignment,
budget, facility, or report records. "Clean production" means production **with** its retained
legitimate pilot data — never an empty database.

If a full restore is ever required, decrypt and restore the verified weekly archive into a fresh
volume per `docs/BACKUP_RESTORE_AR.md`.

---

## 5. Recovery evidence captured this cycle (2026-07-23)

| Item | Value |
|---|---|
| Encrypted weekly backup | `/data/backups/weekly/full-20260723-190243.tar.gz.enc` (19,326,288 bytes) |
| SHA-256 | `63c42bbd2bc3d91cd5ad91a891f8a01edea1d8d4ff3f820e90f32cb3aa293e75` |
| Disposable restore rehearsal | **PASS** — 66 tables, 2 users, 10 file records / 11 files restored |
| Prior verified backup | `full-20260723-141549…` sha256 `38095ed26a4b78bb5a3f88891bb3b3521ac73d2e9c193e09925a7b1b97c7c37d` (also PASS) |
| Production DB state | migration 0009, 54 people / 26 programs / 129 milestones — unchanged |
| PostgreSQL exposure | none (not published; internal network only) |
| Ollama exposure | host-only (`host.docker.internal`), not published |
| Release tag | none created |
| Official data imported by agent | none (both real batches were committed by the principal on 2026-07-21) |

---

## 6. Pre-authorization gate checklist (scope §13)

- [x] Unit, integration, authorization, migration tests — **272 vitest pass**
- [x] Empty-database migration test — 16 migrations → 76 tables (disposable DB)
- [x] Current-schema migration test — 0010–0015 onto a prod-schema clone, milestones untouched
- [x] Legacy-to-activity reconciliation — proven on the 129-shaped fixture, idempotent
- [x] Typecheck, lint, production build — all clean
- [ ] Playwright end-to-end / real-button / mobile-RTL — see `docs/VERIFICATION_V2.md`
- [x] Encrypted DB + files backup, checksum recorded
- [x] Successful disposable restore
- [x] Documented + rehearsed rollback (this file, §4)
- [x] PostgreSQL and Ollama remain unexposed
- [x] Existing feedback, files, audit history, volumes preserved
- [x] No official school data imported by the agent
- [x] No release tag
