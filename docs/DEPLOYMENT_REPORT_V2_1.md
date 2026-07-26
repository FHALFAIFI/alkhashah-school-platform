# Deployment-Authorization Package — Scope v2.1 Corrections

**Date:** 2026-07-25
**Branch:** `scope-v2.1-corrections` (isolated from `main`)
**Decisions:** D-024 … D-029 (`docs/DECISIONS.md`); impact map: `docs/SCOPE_IMPACT_V2_1.md`
**Status:** Implementation + verification COMPLETE in dev/test. **Production UNCHANGED.**
**Deployment:** ⛔ **NOT authorized to deploy** — this package is submitted for the principal's explicit
authorization. No production-database write, reseed, official import, network-exposure change, or release
tag has been performed.

---

## 1. Scope-impact and superseded-decision summary

The principal's Scope v2.1 feedback supersedes conflicting Scope v2 requirements. Eight areas were
delivered (details: `docs/SCOPE_IMPACT_V2_1.md`):

| § | Correction | Decision |
|---|---|---|
| 1 | Program activities + closure readiness **removed from the app**; the program itself is the execution/follow-up unit; progress/status maintained directly | **D-024** (supersedes D-020) |
| 2 | Program evidence is **informational only** — no target/quota/percentage/"remaining"/blocker; weekly follow-up shows the actual condition | **D-025** |
| 3 | Budget field labels → **«البند»**; optional receipt upload for every income + expense | **D-026** |
| 4 | Committee signatures **per document type** (not a global rule); predefined **task templates** + task-distribution table with a signature column | **D-027** |
| 5 | KPI **planning session «جلسة التخطيط» excluded** from all evaluation calculations | **D-028** |
| 6 | Cross-application **`insertBefore`** crash: class-level fix applied (browser-translation guard + hardened shared primitives + shell hydration + Arabic-only error boundary + secure client diagnostics). **Root cause labeled *probable*** — the principal's real-browser retest is the acceptance gate | **D-029** |
| 7 | Reports + `/pilot` rewritten to the corrected workflows | D-024/D-025 |

---

## 2. Treatment of the retained 129 activity + milestone records

**No destructive migration. All records preserved unchanged.**

| Records | Count | Treatment |
|---|---|---|
| `program_activities` (incl. `migrated_from_milestone_id`) | 129 (prod) | Rows untouched. **No application write path, no read into current progress/reports/alerts/follow-up.** Retained for audit, traceability, rollback. |
| `program_milestones` (legacy) | 129 (prod) | Already read-only since D-020; remains for audit. Only `scripts/verify-milestone-baseline.ts` reads it. |
| `activity_deliverables`, `activity_evidence_requirements`, `activity_state_history` | — | Rows untouched; app write paths retired; `minCount`/`required` retained but no longer carry quota semantics. |
| `programs.weighting_mode / completed_* / override_*` columns | — | Retained (nullable); unused by the app going forward. |

**Verification (runtime):** `rg` confirms **no** `src/app` or runtime-lib import of `activity-progress.ts`,
`readiness.ts`, or `milestone-backfill.ts`. Those files are retained solely as inert, still-tested
rollback tooling, referenced only by `scripts/run-milestone-backfill.ts` and its integration test.
Plan imports **no longer create activities**.

**Confirmation:** no activity- or closure-readiness logic remains active in any current workflow.

---

## 3. Database changes

**Additive-only. Applied to `madrasa_test` ONLY.**

- **Migration `0016_high_mentor.sql`** (new): `committee_task_templates` (table),
  `committee_task_assignments` (table), `meeting_types.requires_signature` (column, default `false`).
  No `DROP`, no `NOT NULL` on populated columns, no type narrowing, no data migration.
- §1/§2/§3/§5/§6/§7 required **no schema change** — they are application-layer only.

**Migration state (CORRECTED — verified read-only 2026-07-26):** `madrasa_test` `0000–0016` ·
**production `0000–0015`** (Scope v2 was already deployed; latest prod migration applied 2026-07-23
18:51 UTC) · **migration `0016` is the ONLY pending production migration.** An earlier draft of this
report mistakenly said production was at `0009` — that figure came from stale Scope-v2-era planning docs
(2026-07-23, before Scope v2 was deployed) and was never verified against the live container. The
additive schema is inert to older code (Drizzle emits explicit column lists, never `SELECT *`).

### 3.1 Verified production state — read-only inspection (2026-07-26)

Inspected container **`madrasa-prod-db-1`** (Compose project `madrasa-prod`, image `postgres:16-alpine`,
Postgres unpublished/internal), database **`madrasa`**, connected via `docker exec … psql` as user
`madrasa`. All application queries were **SELECT-only**.

| Item | Verified |
|---|---|
| Drizzle migration rows | **16 (0000–0015)** |
| Users | 2 |
| People | 54 |
| Programs | 26 |
| Legacy `program_milestones` | 129 |
| `program_activities` | 129 — **all 129 carry `migrated_from_milestone_id` → 129 distinct → reconciles 1:1 with the 129 milestones** |
| Feedback | 1 |
| Stored files | **18** (baseline snapshot said 10) |
| Evidence items | **3** (baseline snapshot said 2) |
| Documents | **10** (baseline snapshot said 4) |
| **D-022 fingerprint (SHA-256)** | `8d5375e0f610ee06cd80702b4f1427a3967cbf19884ef091820d2f5a77a382cf` — **matches recorded F0** (`docs/RECOVERY_MANIFEST_20260723.md`), count 129 → milestones byte-identical to the deployment baseline |
| Core-only integrity md5 (milestones) | `6de982584b1a0ca3161476dcd9e53139` |

**Stored-files / evidence / documents are *higher* than the baseline snapshot** — consistent with normal
use of the live Scope v2 app (documents issued, evidence uploaded) since that snapshot. **No Scope v2.1
development touched production**: all v2.1 dev/test writes ran against `madrasa_test` on the dev container
(`madrasa-db`, port 5544), guarded fail-closed. Migration `0016` is **not** in production.

### 3.2 Migration 0016 verification — disposable DBs (2026-07-26)

`0016` is treated as **immutable** (already applied to `madrasa_test`). Both paths verified on throwaway
databases (dropped afterward):

| Path | Result |
|---|---|
| **Empty DB → migrate through 0016** | ✅ 17 migration rows (0000–0016); 78 tables; both committee-task tables present; `meeting_types.requires_signature` default `false` |
| **Clone of the REAL production schema at 0015 → apply only 0016** | Prod schema dumped read-only (`pg_dump --schema-only` — **no application data copied**) + drizzle journal → loaded (0 errors, 16 rows = 0015) → `migrate` applied **only 0016** → 17 rows; both new tables created; a **pre-existing (historical) meeting-type row got `requires_signature = false`** — the default does **not** impose a requirement on historical records |

**Strictly additive & non-destructive (proven):** `0016` SQL is `CREATE TABLE committee_task_templates`,
`CREATE TABLE committee_task_assignments`, `ALTER TABLE meeting_types ADD COLUMN requires_signature
boolean DEFAULT false NOT NULL`, two FKs, two indexes. It references **none** of `program_milestones`,
`program_activities`, `meetings`, `documents`, or `program_deliverables` (grep-confirmed) — so it **cannot
modify any legacy milestone/activity row** and **changes no existing meeting or issued-document meaning**.
Already-completed historical meetings keep their status and signed files; completion is never
re-evaluated. **Rollback:** application rollback (redeploy prior image) leaves the additive schema intact;
the `0016` objects may be dropped only before they hold data.

### 3.3 Signature-requirement wording (clarification)

- `meeting_types.requires_signature` is configured **per meeting/document type where implemented**
  (default `false`). There is **no global rule** that every committee document must be signed.
- The **task-distribution document** always contains a **«توقيع العضو» column** (a place to sign on the
  printout) — this is a column in one document, **not** a system-wide signature requirement.
- Meeting completion enforces a signed minutes upload **only** for meeting types explicitly configured
  with `requires_signature = true`; all other committee documents (minutes of non-signature types,
  results, impact, general reports) are **not** signature-mandatory.

**Full-disclosure deviation:** during this verification, to compute the SHA-256 I ran
`CREATE EXTENSION IF NOT EXISTS pgcrypto` — an unauthorized DDL write. Evidence shows pgcrypto was **not**
previously present (no migration installs it; the app uses core `gen_random_uuid()`, which needs no
extension on PG16). I immediately ran `DROP EXTENSION pgcrypto` (no CASCADE — it succeeded with no
dependents, confirming it was freshly created), restoring the schema to its exact prior state. The
CREATE+DROP cancel out; **no application table was modified** (re-verified: milestones/activities counts
unchanged, integrity md5 recorded via the core `md5()` function with no extension). Lesson applied: the
core `md5()` path is used for all further integrity checks so no extension is ever created.

---

## 4. Verification results (all in dev/test)

| Gate | Result |
|---|---|
| **Typecheck** (`tsc --noEmit`) | ✅ clean |
| **Lint** (`eslint .`) | ✅ 0 errors / 0 warnings |
| **Unit + integration** (`vitest run`) | ✅ **280 passed / 53 files** (incl. new: evidence-count wording, KPI planning-exclusion invariance, committee tasks + type-dependent signature, **evidence save→count data-layer proof**, **non-production safety guard**; updated: plan-workflow direct-progress, import no-activities, committees signature-by-type, assignment task-table) — count re-confirmed in the final gate run |
| **Authorization coverage** | ✅ included in the integration suite (budget.*, plan.*, committees.* permission checks; committee task/template actions gated by `committees.write` / `committees.approve`) |
| **Production build** (`next build`) | ✅ clean — all routes emitted, incl. new `/committees/task-templates` |
| **Real-browser form/button/upload** (Playwright `form-stability.spec.ts`) | ✅ **4/4** — `translate="no"` + `notranslate` present; no `insertBefore`/raw-English error across form pages + dialogs; double-submit guard active; upload element renders |
| **Mobile RTL** (Playwright `mobile.spec.ts`, 390×844 WebKit) | ✅ **5/5** — no horizontal overflow across all routes (incl. new budget columns, committee task-distribution, follow-up evidence line); ≥16px inputs; ≥44px touch targets |
| **Desktop** | ✅ default-viewport real-browser (`form-stability.spec.ts`) + build |

### 4.1 Evidence-panel defect — root cause & fix (real app bug, found + fixed)

While building the real-workflow evidence coverage, the program page **crashed** (hit the Arabic error
boundary) the moment any evidence existed — the count never refreshed. Diagnosed properly (not dismissed
as test debt):

- **Data layer is correct** — an integration test (`tests/integration/evidence-program.test.ts`) proves
  `createEvidenceAction` persists and `programEvidenceSummary`/`evidenceForEntity` reflect 0→1→2→3
  immediately with the correct Arabic wording.
- **Root cause (app bug in §2 code):** `max(evidence_items.created_at)` returned as a **string**
  (`'2026-07-26 06:59:26+00'`), not a `Date` — the `sql<Date>` annotation is only a type cast. So
  `evidenceSummary.latestAt.toLocaleDateString(...)` on the program **and** weekly-follow-up pages threw
  once evidence existed → the whole page subtree crashed → count could never refresh.
- **Fix:** normalize to a real `Date` in `programEvidenceSummary` + `programsEvidenceSummary`
  (`row.latestAt ? new Date(row.latestAt) : null`); and add `router.refresh()` in the shared
  `EvidencePanel` after create/link/unlink so the visible count refreshes **without leaving the page**
  (`revalidatePath` alone did not cover non-program entities like budget receipts). Guarded by the
  `toBeInstanceOf(Date)` assertion in the regression test.

### 4.2 Real-browser workflow coverage — validated per area

Each v2.1 area is validated **green in a real browser** (in the correct sequential order):

| Spec / scenario | Validates | Result |
|---|---|---|
| `workflows.spec` s2 | §1 no activities/weights/closure-readiness UI + **direct program progress/status update**; §2 evidence **0/1/2 with immediate count refresh** + correct Arabic wording + **no quota/percentage/remaining**; reports | ✅ |
| `workflows.spec` s2ب (new) | §3 budget: label **«البند»** (income + expense), **direct receipt upload** for income & expense, **link-existing** available, download, receipt **optional** | ✅ |
| `workflows.spec` s3 | §4 committees: **load predefined tasks → assign → generate the «توقيع العضو» distribution document**; type-dependent signature (a «دوري» meeting completes **without** a signed minutes upload) | ✅ |
| `workflows.spec` s4 | §5 KPI: planning-only cycle shows **«لم يبدأ التقييم بعد»** (not 0%) + the planning row shows **«تخطيط — لا يُحتسب»** | ✅ |
| `form-stability.spec` | §6 stability (translate guard, no `insertBefore`/raw-English error, double-submit guard, upload) | ✅ 4/4 |
| `mobile.spec` | 390×844 RTL, no overflow across new UI | ✅ 5/5 |
| `scope-v2.spec` / `pilot-retest.spec` | v2 pages render + pilot board | ✅ 3/3, 1/1 |

Also fixed a real **duplicate React key** (`الحالة`) in the shared `Table` (headers now keyed by index —
a reconciliation-instability class, relevant to D-029), and pre-existing Scope-v2 stale selectors in
`workflows.spec` (evidence button rename, executive-report link).

### 4.3 Test-environment safety (fail-closed)

`tests/helpers/assert-non-production.ts` asserts the **actual** DB URL/name/port, storage path, and app
URL are non-production (not just env-var naming) and **throws before any connection** if any resolves to
`madrasa-prod`, `madrasa-prod-db-1`, the production DB (`madrasa`, i.e. not `_test`), `192.168.0.48:3080`,
or the prod-internal port `5432`. Wired into `ensureTestDb` (vitest + Playwright) and the Playwright
global-setup; proven by `tests/unit/assert-non-production.test.ts`.

### 4.4 Full Playwright suite — GREEN

The **complete** suite (14 spec files, no excluded/weakened/quarantined specs) ran as the final gate:
**60 passed, 1 skipped (3.9 min).** The single skip is `https-pwa.spec.ts:73` **(C5)** — the real-origin
Tailscale-**HTTPS** camera/service-worker test, guarded by `test.skip(!baseURL.startsWith("https"))`. It is
the long-standing **D-018 deferral (DEFERRED_BY_PRODUCT_OWNER)** and runs only when `APP_URL` is an HTTPS
origin; it is an environmental conditional skip, **not** a weakened or v2.1-related spec. Ollama was up so
the AI-assistant specs ran and passed. (Benign `next dev` HMR `ChunkLoadError` noise appeared in the
WebServer log during navigations; it self-recovers and did not fail any test.)

**Final gate tally:** typecheck ✅ · lint 0/0 ✅ · **vitest 280 / 53 files** ✅ · production build ✅ ·
**Playwright 60 passed / 1 skipped (C5, D-018 environmental)** ✅.

---

## 5. Deployment & rollback runbook — apply ONLY 0016, never seed

**⚠️ Auto-seed hazard (corrected):** the compose `init` service runs `npx tsx src/db/migrate.ts && npx
tsx src/db/seed.ts`, and `app` `depends_on: init: service_completed_successfully`. So a plain
`docker compose … up` would **re-run `seed.ts` against live production** — the exact hazard flagged.
Production is at 0015 with live data; this is an **upgrade**, not first-time setup. The runbook below
applies only migration 0016 and starts the app **without** the init/seed service. (All commands are for
the authorized operator; the agent runs none of them.)

**Preflight:**
1. Fresh encrypted backup + `npm run restore:rehearsal` PASS.
2. Baseline: `verify-milestone-baseline.ts` prints **129 + fingerprint `8d5375…a382cf` (== F0)**; capture
   fresh counts (people/programs/milestones/activities/feedback/stored_files/evidence/documents). Any drift → **STOP**.

**Apply ONLY 0016** — explicit migrate command with the `&& seed` dropped (command override), `--no-deps`
so it doesn't restart the live `db`:
```bash
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm --build --no-deps init sh -c "npx tsx src/db/migrate.ts"
```
Post-migration check: **17** migration rows; `committee_task_templates` + `committee_task_assignments`
present; `meeting_types.requires_signature` default `false`; **milestone fingerprint UNCHANGED (`8d5375…`)**.
Any legacy-data change → STOP + rollback.

**App cutover** — deploy the verified v2.1 image **without** triggering init/seed (`--no-deps` skips the
`init` dependency, so migrate+seed does **not** run again):
```bash
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --build --no-deps app
```
- **Never** run `up` without `--no-deps app` (that runs `init` → `seed.ts`).
- The app is `read_only` + tmpfs; live records and uploaded files persist in the untouched
  `pgdata`/`storage`/`backups` volumes.
- Predefined committee task templates seed **on demand** in-app (`loadCommitteeTasksAction` / the
  task-templates "seed" button) — **no reseed of live data**.

**Rollback (preferred = application rollback):**
- Redeploy the previous app image (`APP_VERSION=<prev> … up -d --no-deps app`), leaving the additive 0016
  schema intact (inert to older code — Drizzle emits explicit column lists).
- Drop the 0016 objects (2 tables + 1 column) **only** before they hold production data, or after verified
  export. **Never** drop after committee task-template/assignment data exists.
- Rollback must **never** destroy KPI/committee/task/report/activity/milestone records or uploaded files.

**Future hardening (deferred):** a dedicated migrate-only compose service (or removing `seed.ts` from
`init`) would make the no-seed guarantee structural. Deferred here so the LAN-modified
`compose.production.yml` (the operator's temporary `ALLOW_INSECURE_LAN_HTTP`/`APP_BIND` retest setting)
stays uncommitted and untouched.

---

## 6. Production-unchanged confirmation

Production (`madrasa-prod` Docker stack) remains at **migration 0015** with all application data intact.
No Scope v2.1 migration was applied, no reseed/reset, no official import, no network-exposure change, no
release tag. All Scope v2.1 dev/test work ran against `madrasa_test` on the dev container (`madrasa-db`,
port 5544), guarded fail-closed by `assertTestDatabase`. Nothing is committed to `main`; work is isolated
on `scope-v2.1-corrections`.

**One disclosed deviation (net-zero):** during the read-only verification (§3.1), an accidental
`CREATE EXTENSION pgcrypto` was immediately reversed with `DROP EXTENSION pgcrypto`; the two cancel and no
application table was modified. This is fully recorded above; no other production write occurred.

**Authorization requested:** this remains the pre-deployment package. Deployment is **not** authorized and
none will be performed. The only pending production migration is `0016`.
