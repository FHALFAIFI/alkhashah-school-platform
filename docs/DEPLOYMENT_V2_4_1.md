# v2.4.1 — Authorized Production Deployment Report (2026-08-04)

> Release record for the data-correction release. Implementation and pre-deployment
> verification: `docs/DELIVERY_V2_4_1.md`. Decisions D-046…D-052. Previous release record:
> `docs/DEPLOYMENT_V2_4.md`.

## 1) Executive verdict

**DEPLOYED — HEALTHY.**

v2.4.1 is the sole production version. It serves the existing production environment on the
unchanged host port `3080` under the established compose project `madrasa-prod`, on the same
database, uploads volume and secrets. Only the application container was replaced; the
database container was never restarted. Rollback protection is in place and was proven by
booting the previous image against the restored pre-deployment backup.

Across the entire deployment, the only production data that changed is `audit_log`
(540 → 550) and `sessions` (56 → 60) — the smoke test's own logins and report exports.
**No business record was created, updated or deleted.**

## 2) Previous → new production version

| | Previous | New |
|---|---|---|
| Version | v2.4.0 | **v2.4.1** |
| Commit | `da8db16` | **`6d7dacf`** (branch `scope-v2.4.1-data-correction`, worktree clean) |
| Image tag | `madrasa-app:0.1.0` (= `v2.4.0`) | `madrasa-app:0.1.0` (= `0.1.0-v2_4_1-rc`) |
| Image digest | `sha256:2f69c724c625f60a39c9d8f8e109c97407ff70f23441386498a5e36872556c5b` | **`sha256:4b427c8e16d8a332c5a9a0739be3e9a8cfe55fcee2c5992dc2f463e34802e7d3`** |
| Platform | linux/arm64 | linux/arm64 |
| App container | `80f280a10454` | **`e90411be41b3`** |
| DB container | `c0d011f245dd` | `c0d011f245dd` — **unchanged, never restarted** |

Release tag: **`v2.4.1`** (annotated, on `6d7dacf`). The image carries `RELEASE_COMMIT=6d7dacf`
and reports it from `/api/health`. Commits after `6d7dacf` on the branch are documentation and
rehearsal-harness only — `git diff 6d7dacf..HEAD` touches no file under `src/`, `drizzle/`,
`Dockerfile.production` or `package*.json`, so the image is the tree that ships.

## 3) Production URL and port — unchanged

- Compose project `madrasa-prod`, service `app`, host binding **`0.0.0.0:3080 -> 3080/tcp`**
  (identical to v2.4.0; `APP_BIND=0.0.0.0` per the standing LAN-retest setting).
- `APP_URL` = `https://faheds-mac-mini.tailf84da9.ts.net` (unchanged in configuration).
- `TRUSTED_ORIGINS` unchanged (`faheds-mac-mini.tailf84da9.ts.net,192.168.0.48:3080`).
- PostgreSQL remains **unpublished** — `5432/tcp` internal only. Security posture unchanged.
- Volumes preserved and re-attached: `madrasa-prod_pgdata`, `madrasa-prod_storage`
  (89 upload files), `madrasa-prod_backups`.
- Read-only container root filesystem retained.

## 4) Database ledger

**29 → 31.** Tables **86 → 88**.

| # | File | Change |
|---|---|---|
| 0029 | `0029_condemned_sugar_man.sql` | `deletion_tombstones`, `program_edit_history` (2 new tables, 3 indexes, 3 FKs) |
| 0030 | `0030_bent_leo.sql` | `maintenance_issues.category / safety_impact / operational_impact / requested_action` (4 nullable columns) |

Applied once, through the migrate-only `init` service with `--no-deps`
(`sh -c npx tsx src/db/migrate.ts`). The resolved compose config contains **zero** occurrences
of `seed.ts` — the seed service is profile-gated and did not run.

### Proof the database container was not restarted

| Probe | Before migration | After deployment |
|---|---|---|
| Container id | `c0d011f245dd…` | `c0d011f245dd…` |
| `State.StartedAt` | `2026-07-29T15:01:06.504379752Z` | `2026-07-29T15:01:06.504379752Z` |
| `State.Pid` | `707` | `707` |
| `RestartCount` | `0` | `0` |
| `pg_postmaster_start_time()` | `2026-07-29 15:01:06.801472+00` | `2026-07-29 15:01:06.801472+00` |

### Data integrity — full pre/post diff

A single probe was run verbatim before and after. It emits a row count and an
order-independent full-row fingerprint for **every one of the 86 base tables**, plus nine
anchors — 183 lines. The complete diff across the migration was:

```
## LEDGER  29                                 ->  ## LEDGER  31
## TABLES  86                                 ->  ## TABLES  88
+ cnt deletion_tombstones     0
+ cnt program_edit_history    0
+ fp  deletion_tombstones     <empty>
+ fp  program_edit_history    <empty>
fp    maintenance_issues  21ac315d…           ->  e2c4febc…   (row literal now has the 4 new columns)
```

Nothing else changed. Specifically:

- **All 86 pre-existing table counts byte-identical** (people 54 · programs 30 ·
  activities 129 · milestones 129 · documents 36 · evidence_items 33 · stored_files 88 ·
  budget_income 4 · budget_expenses 4 · financial_items 4 · committees 4 ·
  committee_members 13 · committee_task_assignments 31 · perf_models 10 · perf_cycles 7 ·
  perf_sessions 11 · perf_ratings 128 · rooms 8 · room_types 24 · maintenance_issues 5 ·
  inspections 6 · audit_log 540 at capture).
- **All 85 untouched row-hash fingerprints byte-identical.**
- **All nine anchors byte-identical**, including
  `d022_programs = 66059939b84e11f77d39c90a6309e3fc`,
  `issued_documents = 5f9311e3f260c53be73162f7f1cdb870`,
  `stored_files = d508897636be512a0402ea4def486897`,
  `people_roster = efcb77712808480fc43f350107308ad0`,
  `committees = ebabbafa1dc4aa256c24a5dc3660781a`, and finance sums `5101 / 3399`.
- The one table whose row literal changed is proven unmodified by a dedicated
  **pre-0030-columns-only** anchor, which is unchanged:
  `mi_pre0030 = c584011a388a323f9038ff6c4a96f44c`. The four new nullable columns therefore
  did not alter a single existing record.
- **New columns are 100 % NULL** — `category`, `safety_impact`, `operational_impact` and
  `requested_action` all report 0 non-null rows over all 5 reports. Both new tables are empty.

After the full smoke run the probe was taken a third time. The only differences from the
post-migration state were `audit_log` 540 → 550 and `sessions` 56 → 60 (with their
fingerprints), from the smoke test's own logins and report exports.

## 5) Production smoke tests

Executed against the real deployed container on the production host:port
(`http://127.0.0.1:3080`) with a real form login as `admin` — no bypass. **Read-only by
design: no business record was created, updated or deleted.** Checks that can only be
demonstrated by mutating real school data, and those that require the `principal` role
(`sysadmin` is denied `performance.individual.read` by D-013), were executed on a disposable
clone of the *post-deployment* production data running the *deployed* image, and are marked
*(clone)*.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Login works | **PASS** | real form login as `admin` → `/dashboard` |
| 2 | Version 2.4.1 visibly shown | **PASS** | «الإصدار 2.4.1» rendered in the shell |
| 3 | Health reports `version=2.4.1` | **PASS** | `{"status":"ok","db":"up","version":"2.4.1","commit":"6d7dacf","environment":"production"}` |
| 4 | Ledger is 31, tables are 88 | **PASS** | `ledger=31 tables=88` |
| 5 | Existing users and data remain available | **PASS** | `/people` 54 rows · `/plan` 27 rows · db people 54 / programs 30 / 2 active users |
| 6 | Uploads remain available | **PASS** | `GET /api/files/<id>` → 200, 180 832 B, xlsx content-type |
| 7 | Budget top cards: allocated, spent, remaining, spending percentage | **PASS** | «إجمالي المخصصات» · «إجمالي المصروفات» · «إجمالي المتبقي» · «نسبة الإنفاق من المخصص» |
| 8 | Missing allocation displays clear guidance | **PASS** | 2 unallocated items; «غير محدد» + «لا يمكن احتساب المتبقي قبل تحديد المخصص» + «تحديد المخصص» all present, never a bare «—» |
| 9 | Inspection is accessible through maintenance | **PASS** | «إجراء فحص» on `/building/maintenance` → `/building/maintenance/inspect` renders |
| 10 | Maintenance reports can be approved, viewed, printed, downloaded | **PASS** | KHS-MNT-0001…0004 offer «توليد خطاب البلاغ الرسمي (PDF)»; KHS-MNT-0005 (has a document) additionally offers «تنزيل PDF» + «طباعة تقرير الصيانة». **Not executed** on production — the approve→issue path was executed *(clone)*, check 25 |
| 11 | Maintenance report PDF generates | **PASS** | `maintenance-register` PDF 200, `%PDF-`, 37 244 B |
| 12 | Committee registry shows names, roles, tasks and statuses | **PASS** | `committee-members` 13 rows · `committee-tasks` 31 rows, header carries «حالة التنفيذ» |
| 13 | Individual committee card works | **PASS** | «بطاقة مجلس أو لجنة» offered on the committee page |
| 14 | School-wide detailed / statistical report works | **PASS** *(clone)* | «تقرير تفصيلي وإحصائي للجميع» offered and **issued** as the principal. On production `sysadmin` is denied by D-013 — see §9 |
| 15 | Individual detailed performance report works | **PASS** *(clone)* | «تقرير تفصيلي للمعلم» offered and **issued** as the principal |
| 16 | Programs can be edited in every lifecycle state | **PASS** | production carries two live states — `مسودة/لم يبدأ` and `معتمد/مكتمل` — both open the edit form with the reason field. All six states (draft, awaiting approval, approved, in progress, completed, closed) executed *(clone)*, check 26 |
| 17 | Warnings appear without blocking authorized edits | **PASS** | on an approved program: warning text shown, «سبب التعديل (إلزامي…)» present, save button enabled. **Nothing submitted** |
| 18 | Program approval and state are not silently changed | **PASS** *(clone)* | after edits in معتمد / مكتمل / مغلق: `status`, `approvedAt`, `completedAt`, `closedAt` byte-identical |
| 19 | Post-approval edit history is recorded | **PASS** *(clone)* | one `program_edit_history` row per edit, with old/new value, actor, reason and lifecycle at edit time |
| 20 | Employee permanent deletion action visible and protected | **PASS** *(clone)* | «حذف الموظف نهائياً» present with impact preview separating owned from shared records; committee preserved byte-identically, membership unlinked; tombstone written with no evaluation content |
| 21 | Performance-cycle deletion action visible and protected | **PASS** *(clone)* | «حذف دورة الأداء» present with impact preview; the selected cycle deleted, the employee and the other cycle intact; tombstone written |
| 22 | PDF, CSV and DOCX exports remain valid | **PASS** | csv 200 / 5 356 B · docx 200 / 10 870 B (`PK`) · pdf 200 / 56 412 B (`%PDF-`) |
| 23 | Audit logging works | **PASS** | `audit_log` 540 → 550; `login.success ×1`, `report.exported ×6` on production; on the clone `maintenance.created_from_finding`, `perf_cycle.permanently_deleted`, `person.permanently_deleted`, `program.edited` |
| 24 | No unexpected errors in production logs | **PASS** | 0 browser console errors, 0 page errors. Container log contains exactly 3 error lines, all «لا تملك الصلاحية اللازمة لهذا الإجراء» — the D-013 denials deliberately triggered by the smoke |
| 25 | Each inspection finding creates a separate maintenance report | **PASS** *(clone)* | 3 findings → maintenance issues 5 → 8, three distinct codes, each linked bidirectionally to its own finding; approve → print → PDF executed |
| 26 | Authorization holds (no regression) | **PASS** | `sysadmin` renders **zero** performance content on `/performance/employees/<id>` and is refused `/performance/analytics` (D-013) |

Also verified: security headers intact (`X-Frame-Options: DENY`, `nosniff`,
`Referrer-Policy: same-origin`, `Permissions-Policy`, CSP), `/login` 200, unauthenticated
`/plan` → 307 auth gate, and `/api/health` carries no connection string, secret, token or
filesystem path.

### Clone verification detail — 53/53 PASS

`scripts/v241-final-clone-setup.sh` + `scripts/v241-final-clone-rehearsal.mjs`, run against a
disposable clone of the **post-deployment** production database (ledger 31, tables 88) and a
copy of the uploads volume, on an isolated network and volume at `127.0.0.1:3086`, using the
**deployed image** (`madrasa-app:0.1.0`, `version=2.4.1`, `commit=6d7dacf`) and a clone-only
principal-equivalent account. All seventeen required steps and every destructive step ran
**only against records the script seeded itself**; the copied production programs, committees
and people were byte-identical afterwards (people 54 → 54, committee fingerprint unchanged,
ledger 31 / tables 88 stable). Production was only ever read; `RestartCount` stayed `0` and
the start time was unchanged throughout. Clone, volumes and network destroyed afterwards.

## 6) Backup, restore verification and rollback

### Pre-deployment backup — stamp `20260804-143255`

Taken **inside the production network** through the compose `init` service (passphrase via env
only, never on argv). Encryption: **AES-256-CBC, PBKDF2, 200 000 iterations, salted**.

| Artifact | Size | SHA-256 |
|---|---|---|
| `backups/predeploy/db-20260804-143255.dump.enc` | 7 435 968 B | `45304c0cce411ba381daeef4a48cc8ae147b2588d6c84f22945f7d2d55b041e1` |
| `backups/predeploy/storage-20260804-143255.tar.gz.enc` | 34 957 600 B | `6a843c229bc64fa9f0ba595edc9c1d2a5bde18fa35b5094afba67bd9bd680bdb` |
| `backups/predeploy/config-20260804-143255.tar.gz.enc` | 526 176 B | `434aa07a8e048c86d07a1b81153e3eeb59b009ccd1b5e59c01066cb71219867c` |

`SHA256SUMS-20260804-143255.txt` verifies **OK** for every artifact.
`RECOVERY-MANIFEST-20260804-143255.txt` and `ROLLBACK-20260804-143255.txt` sit beside them.
The config archive carries `package.json`, `package-lock.json`, `compose.production.yml`,
`Dockerfile.production`, `next.config.ts`, `drizzle.config.ts`, all 31 migrations + journal,
`.env.production.example`, and a **redacted** `.env.production` (`POSTGRES_PASSWORD`,
`SESSION_SECRET`, `BACKUP_PASSPHRASE` replaced) — **no secret is stored in the backup.**

**Restore verification — PASS.** Decrypted *inside* a container (no plaintext ever written to
the host), `pg_restore --list` → 558 objects, restored into a throwaway `postgres:16-alpine`
on an **isolated Docker network** with no host port. The same 183-line probe over the restored
copy was **byte-identical to live production** — all 86 counts, all 86 fingerprints, all
anchors, **0 differences**.

**Uploads verification — PASS.** 89 files in the archive, and the aggregate SHA-256 over every
file's digest matches the live volume exactly:
`5cb77e578c7dd08c374fe493acf355ce13ce7616a35e6c0b023d9c833a1187c9`.

### Rollback

- Rollback image **`madrasa-app:0.1.0-prev-v2_4_1-20260804`** =
  `sha256:2f69c724c625…` (v2.4.0).
- **Boot-proven**: the rollback image was started against the *restored* pre-deploy backup on
  the isolated network and reported `{"status":"ok","db":"up","version":"0.1.0"}`,
  `/login` 200, `/plan` 307.
- Exact commands: `backups/predeploy/ROLLBACK-20260804-143255.txt`.
- Migrations 0029/0030 are purely additive, so the v2.4.0 image runs unchanged on ledger 31 —
  **rollback requires no database action.** Rehearsed pre-deployment on a clone
  (`docs/DELIVERY_V2_4_1.md` §17.13). A DB restore is reserved for explicitly identified data
  corruption only.
- **No rollback trigger occurred. Rollback was not exercised on production.**

### Post-deployment gold backup — `20260804-gold`

| Artifact | Size | SHA-256 |
|---|---|---|
| `backups/gold/db-20260804-gold.dump.enc` | 7 441 984 B | `aec70eb278cf3f9f0af68828c86e25c4cd6f0180ec8f8fcfb9c3a122899b16ef` |
| `backups/gold/storage-20260804-gold.tar.gz.enc` | 34 957 600 B | `83a961ce988dbf0ef9a239f4ba897dae65073afa86cb49ca0bb7ea2b65d7a29e` |

Checksums verify OK. **Restore-verified** into an isolated network (`pg_restore --list` → 570
objects); the 187-line probe over the restored gold copy was **byte-identical to live
production at ledger 31 — 0 differences.** Verification environment destroyed afterwards.

## 7) Downtime

**≈ 1.4 s.** Availability was polled at ~0.29 s resolution across the swap: 17 samples,
15 UP, **2 DOWN**. Last successful sample before the swap at `+2.033 s`, first successful
sample after at `+3.421 s`. The container reported `healthy` shortly after recreation, and the
database served continuously throughout.

## 8) Environment cleanup

- Every temporary environment created during this deployment was removed: the backup
  restore-verification database, the rollback boot probe, the post-deployment verification
  clone (app + Postgres + two volumes) and the gold restore-verification database, together
  with their isolated networks. `0` stray containers, `0` stray volumes, `0` stray networks.
- The clone's plaintext dump and its clone-only account were destroyed with the clone.
- **Only one application is user-facing: `madrasa-prod-app-1` on `0.0.0.0:3080`.**
  `madrasa-prod-db-1` publishes nothing.
- `madrasa-db` (compose project `fathersfile`, host port 5544) remains up. It is the
  **development** database — it holds only `madrasa` (dev) and `madrasa_test` (e2e), has no
  application container attached, and is not a v2.4.1 environment. Deliberately left intact.
- `anythingllm-web` is a pre-existing, unrelated service on port 13001, untouched.
- Preserved as required: production database volume, uploads, all backups, the rollback image,
  the gold backup and all deployment evidence.

## 9) Deferred / not executed by design

- Checks 14, 15, 18–21 and 25 were completed on a disposable clone of the **post-deployment**
  production data rather than by mutating production or by using the principal's own password.
  Two reasons: a deployment smoke must not delete a real employee, a real performance cycle or
  a real program's history; and `sysadmin` is denied `performance.individual.read` by D-013, so
  the two performance reports and the deletion panels are not reachable with the smoke account.
- Check 10's approve→issue step was verified by affordance on production and **executed** on the
  clone. Issuing a letter on production would write a `documents` row.
- The principal's `/pilot` retest remains the acceptance channel for interactive confirmation of
  the principal-scope screens.

## 10) Known limitations (carried forward, not introduced by this deployment)

1. **Tailscale Serve is not configured on the host**, so the HTTPS production URL
   `https://faheds-mac-mini.tailf84da9.ts.net` is not currently served; access today is over
   plain HTTP on the LAN binding. Enabling it is a tailnet-wide admin action outside the
   agent's reach. Gate C5 (camera/PWA secure-context) therefore stays deferred (D-018).
2. The authorization denial for `/performance/analytics` and `/performance/employees/<id>`
   surfaces as a generic error boundary rather than an explicit "not authorized" page, and the
   container logs it as `⨯ Error: لا تملك الصلاحية اللازمة لهذا الإجراء`. **No data leaks** —
   the page renders zero performance content. Identical in the v2.4.0 baseline, so pre-existing
   cosmetics.
3. The **31 committee task statuses**, the **two missing allocations** (المستلزمات، النشاط),
   the **four contradictory program states** and the **two committees without tasks** remain
   unresolved *data*. v2.4.1 supplies the workflow, the explanation and the audit trail for each
   and invents no value on the principal's behalf.
4. Permanent deletion is **irreversible** except by restoring a full backup — stated on the
   confirmation panel and in `docs/DELETION_RUNBOOK.md`.
5. The **D-049 sweep is still partial**: other Server Actions across the platform may still
   revalidate their own route. A systematic audit remains follow-up work.
6. **React 19 resets uncontrolled forms after an action, including on error.** Fixed for the
   program edit form; other forms that can return validation errors have the same latent
   behaviour and are worth a sweep.
7. The `madrasa-db` development database publishes `0.0.0.0:5544`; loopback-only would be
   tighter. Unrelated to production (production PostgreSQL is unpublished).
8. `madrasa-prod-init-1`, an exited one-shot container from the v2.3 deployment, is still
   present. Harmless (stopped, no ports); left untouched.
9. All limitations recorded in `docs/DELIVERY_V2_4_1.md` §17.17 continue to apply.

## 11) Baseline

**v2.4.1 is the current production baseline.** The next release compares against:
ledger **31**, tables **88**, image `sha256:4b427c8e16d8…`, commit `6d7dacf`, tag `v2.4.1`,
D-022 program anchor `66059939b84e11f77d39c90a6309e3fc`,
`mi_pre0030` anchor `c584011a388a323f9038ff6c4a96f44c`.
