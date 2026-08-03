# v2.4.0 — Authorized Production Deployment Report (2026-08-03)

> Release record for the round-6 corrective release. Implementation and pre-deployment
> verification: `docs/DELIVERY_V2_4.md`. Brief: `docs/BRIEF_V2_4_0.md`. Change map:
> `docs/SCOPE_IMPACT_V2_4.md`. Decisions D-041…D-045.

## 1) Executive verdict

**DEPLOYED — HEALTHY.**

v2.4.0 is the sole production version. It serves the existing production environment on
the unchanged host port `3080` under the established compose project `madrasa-prod`, on
the same database, uploads volume and secrets. The v2.3.0 application container was
replaced; no parallel user-facing environment remains. Rollback protection is in place and
was proven by booting the previous image against the restored pre-deployment backup.

## 2) Previous → new production version

| | Previous | New |
|---|---|---|
| Version | v2.3.0 | **v2.4.0** |
| Commit | `b47558c` | **`da8db16`** (branch `scope-v2.4-post-acceptance`, worktree clean) |
| Image tag | `madrasa-app:0.1.0` (= `0.1.0-v2_3-rc2`) | `madrasa-app:0.1.0` (= `v2.4.0` = `0.1.0-v2_4-rc`) |
| Image digest | `sha256:7f5ff14a54f0a7046a319dd8c6429ecf8e4726ee139bbb3e488dfeaae4d49a5a` | **`sha256:2f69c724c625f60a39c9d8f8e109c97407ff70f23441386498a5e36872556c5b`** |
| Platform | linux/arm64 | linux/arm64 |
| App container | `65981ff98d9b` | **`80f280a10454`** |
| DB container | `c0d011f245dd` | `c0d011f245dd` — **unchanged, never restarted** |

Release tag: **`v2.4.0`** (annotated, on `da8db16`).

## 3) Production URL and port — unchanged

- Compose project `madrasa-prod`, service `app`, host binding **`0.0.0.0:3080 -> 3080/tcp`**
  (identical to the v2.3 binding; `APP_BIND=0.0.0.0` per the standing LAN-retest setting).
- `APP_URL` = `https://faheds-mac-mini.tailf84da9.ts.net` (unchanged in configuration).
- PostgreSQL remains **unpublished** — `5432/tcp` internal only. Security posture unchanged.
- Volumes preserved and re-attached: `madrasa-prod_pgdata`, `madrasa-prod_storage`
  (88 upload files), `madrasa-prod_backups`.

## 4) Database ledger

**27 → 29.** Migrations `0027_tiny_harpoon.sql` (3 nullable columns + FK on `perf_models`)
and `0028_blue_kulan_gath.sql` (1 nullable column on `committee_task_assignments`). Tables
86 → 86 (no new tables). Applied once, via the migrate-only `init` service with `--no-deps`.

### Proof the database container was not restarted

| Probe | Before migration | After deployment |
|---|---|---|
| Container id | `c0d011f245dd…` | `c0d011f245dd…` |
| `State.StartedAt` | `2026-07-29T15:01:06.504379752Z` | `2026-07-29T15:01:06.504379752Z` |
| `State.Pid` | `707` | `707` |
| `RestartCount` | `0` | `0` |
| `pg_postmaster_start_time()` | `2026-07-29 15:01:06.801472+00` | `2026-07-29 15:01:06.801472+00` |

### Data integrity — full pre/post diff

A single probe (`baseline.sql`) was run verbatim before and after. It emits a row count and
an order-independent full-row fingerprint for **every one of the 86 base tables**, plus six
historical anchors. The complete diff was:

```
## LEDGER  27                                  ->  ## LEDGER  29
fp   committee_task_assignments  abe6e004…     ->  05c86bab…      (row literal now has the new column)
fp   perf_models                 77cfc99c…     ->  ab12bdd3…      (row literal now has the new columns)
+ newcol  committee_task_assignments.status       0
+ newcol  perf_models.archived_at                 0
+ newcol  perf_models.archived_by                 0
+ newcol  perf_models.archived_reason             0
```

Nothing else changed. Specifically:

- **All 86 table counts byte-identical** (people 54 · programs 30 · activities 129 ·
  milestones 129 · documents 35 · evidence_items 33 · stored_files 87 · income 4 ·
  expenses 4 · committees 4 · committee_members 13 · committee_task_assignments 31 ·
  perf_models 10 · perf_cycles 7 · perf_sessions 11 · perf_ratings 128 · rooms 8 ·
  room_types 24 · maintenance_issues 5 · inspections 6 · audit_log 513 at capture).
- **All 84 untouched row-hash fingerprints byte-identical.**
- **All six anchors byte-identical**, including the recorded D-022 legacy fingerprint
  `4572c57060e20c4b0de4db52545a8e3f` (matches every release since v2.1), issued-docs
  `ef4c0e6cc0a055911d0d07ae24b5abaa`, stored-files digest `041861a572ff1a9476e4d4b8ea7dc1cc`,
  and finance sums `5101 / 3499`.
- The two tables whose row literal changed are proven unmodified by dedicated
  **pre-migration-column-only** anchors, which are unchanged:
  `perf_models_pre0027 = 72a23bdf174e70d7dbc12592a8d48123`,
  `cta_pre0028 = 58805e67dfd43fc601226a4a2e3d3416`. The new nullable columns therefore did
  not alter a single existing record.
- **New columns are 100 % NULL** (all four report 0 non-null rows) — also the standing
  proof that `seed.ts` did not run. The resolved compose config contains zero occurrences
  of `seed.ts` (the seed service is profile-gated) and `init.command` is literally
  `sh -c npx tsx src/db/migrate.ts`.

## 5) Production smoke tests

Executed against the real deployed container on the production host:port
(`http://127.0.0.1:3080`) with a real form login — no bypass. Read-only by design: **no
business record was created, updated or deleted.** Where a check could only be demonstrated
by mutating real school data, it was verified on a disposable clone of the same day's
production data (restored from the pre-deploy backup, migrated to ledger 29, running the
same v2.4 image) and is marked *(clone)*.

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Login works | **PASS** | real form login as `admin` → `/dashboard` |
| 2 | Existing principal account works | **PASS** *(clone)* | principal-role account authenticates → `/dashboard`. On production the `principal` row is intact and active; the principal changed their own password on 2026-08-02 and it was deliberately not used — they confirm interactively via `/pilot` |
| 3 | Existing data is present | **PASS** | `/plan` 27 rows · `/people` renders · 54 people / 30 programs in DB |
| 4 | Uploaded files accessible | **PASS** | `GET /api/files/<id>` → 200, 180 832 B, xlsx content-type |
| 5 | Production ledger is 29 | **PASS** | `select count(*) from drizzle.__drizzle_migrations` → 29 |
| 6 | Budget remaining appears after expenditure | **PASS** | `/budget` shows «المتبقي», «تجاوز», «بلا مبلغ», «إجمالي المخصصات» |
| 7 | Expense ledger before/after allocation balance | **PASS** *(clone)* | ledger headers `["التاريخ","النوع","المتبقي قبل العملية","المبلغ","المتبقي بعد العملية","الرصيد النقدي الجاري"]`. On production the columns are allocation-gated by design and no live item currently has both an allocation and expenses, so the documented 4-column fallback renders — verified correct |
| 8 | Green right sidebar scrolls independently | **PASS** | `position: sticky`, `overflow-y: auto`, `height 900px`; aside `scrollTop 558`, `window.scrollY 0` |
| 9 | Sidebar retains position after navigation | **PASS** | scroll 600 → 630 after navigation → 630 after full reload; active link stays visible; `sessionStorage["madrasa-sidebar-scroll-v1"]` |
| 10 | Weekly follow-up shows truthful mixed states | **PASS** | «أسبوع 2026-W32 — 2 برنامجاً معتمداً مفتوحاً · حُدِّث هذا الأسبوع: 0 · مستحق المتابعة: 1»; 8-week selector; groups «بلا تحديث هذا الأسبوع (1)» / «لم يبدأ (1)»; per-program «لم يتم التحديث هذا الأسبوع» |
| 11 | Programs-by-responsible report includes names | **PASS** | CSV 200, 27 data rows, header `"مسؤول التنفيذ","م","البرنامج","المجال",…` |
| 12 | Programs-by-domain report includes names | **PASS** | CSV 200, 27 data rows, header `"المجال","م","البرنامج","المسؤول",…` |
| 13 | Printable program card accessible | **PASS** | «إصدار بطاقة تكليف المنفذ (PDF)» present on `/plan/<id>/report` (not issued — read-only smoke) |
| 14 | Homepage approval queue accessible | **PASS** | «بانتظار اعتماد المدير» = 22, three tabs: «برامج جديدة بانتظار الاعتماد (22)» / «اكتمال موثق بانتظار الإقفال (0)» / «طلبات تعديل (0)», inline «اعتماد» per row |
| 15 | Detailed committee report — member and task per row | **PASS** | `committee-members` 13 rows (13 memberships) · `committee-tasks` 31 rows (31 assignments) with header `"اللجنة","المكلَّف","الدور","المهمة","حالة التنفيذ","ملاحظات"`; committee report page renders |
| 16 | Unused evaluation forms can be deleted | **PASS** | on the unused non-official model: «حذف النموذج» offered with «السجلات المرتبطة: 0 موظف، 0 دورة تقييم، 0 جلسة، 0 تقدير، 0 شاهد، 0 تقرير مُصدَر» and «النموذج غير مرتبط بأي تقييم — يمكن أرشفته أو حذفه نهائياً». **Not executed** — no production record deleted |
| 17 | Used evaluation forms can be archived | **PASS** | on a used/official model only «أرشفة النموذج» is offered (delete correctly withheld). **Not executed** |
| 18 | Individual employee performance report available | **PASS** *(clone)* | 200, 3 tables, issuance button «إصدار التقرير التفصيلي (PDF)», all markers present (الدورة/الوزن/الدرجة/الجلسات/المعيار/التقدير/الشواهد/إقرار). Personal data not reproduced anywhere |
| 19 | School-wide performance report available | **PASS** *(clone)* | `/performance/analytics` 200, 20 tables, «إصدار تقرير المدرسة التفصيلي (PDF)» |
| 20 | Maintenance report PDF generates | **PASS** | `maintenance-register` PDF 200, magic `%PDF-`, 37 699 B |
| 21 | Performance report PDF authorization works | **PASS** | sysadmin is refused (D-013): `/performance/employees/<id>` renders **zero performance content** and logs the authorization error; principal-role is allowed: perf PDF 200 `%PDF-` 36 483 B |
| 22 | DOCX, CSV and PDF exports functional | **PASS** | csv 200/3 453 B · docx 200/10 352 B (`PK`) · pdf 200/44 544 B (`%PDF-`) |
| 23 | Audit logging works | **PASS** | `audit_log` written by v2.4: `login.success ×7`, `login.failed ×2`, `report.exported ×9` |
| 24 | No unexpected application errors | **PASS** | 0 console errors, 0 page errors. Container log contains exactly 2 error lines, both `لا تملك الصلاحية اللازمة لهذا الإجراء` — the D-013 denials deliberately triggered by check 21 |

Also verified: security headers intact (`X-Frame-Options: DENY`, `nosniff`,
`Referrer-Policy: same-origin`, `Permissions-Policy`, CSP), `/login` 200, unauthenticated
`/plan` → 307 auth gate, `/api/health` → `{"status":"ok","db":"up","version":"0.1.0"}`.

## 6) Backup, restore verification and rollback

### Pre-deployment backup — stamp `20260803-065900`

Taken **inside the production network** through the compose `init` service (passphrase via
env only, never on argv). Encryption: **AES-256-CBC, PBKDF2, 200 000 iterations, salted**.

| Artifact | Size | SHA-256 |
|---|---|---|
| `backups/predeploy/db-20260803-065900.dump.enc` | 7 341 008 B | `69be9554c08625dda4c2e3b7fef8c4bd6ff6f413028fcced51d1e56bbd43cc11` |
| `backups/predeploy/storage-20260803-065900.tar.gz.enc` | 34 908 688 B | `d926b57e4efb2a26c234f658847c9885df0e8ea977c83535596a897436ba8154` |
| `backups/predeploy/config-20260803-065900.tar.gz.enc` | 492 688 B | `f24c57a2f7c5fb0123f5e866809fa5f287cf0796d40d1e9ccb3feb689c48a17b` |
| `backups/predeploy/RECOVERY-MANIFEST-20260803-065900.txt` | 2 966 B | `b483bd35de80523c1d8e9cda2a4aa66c3c263a8a8222c6ec1aa74a7380f2b0a1` |

`SHA256SUMS-20260803-065900.txt` verifies **OK** for every artifact. The config archive
carries `package.json`, `package-lock.json`, `compose.production.yml`,
`Dockerfile.production`, `next.config.ts`, `drizzle.config.ts`, all 29 migrations + journal,
`.env.production.example`, and a **redacted** `.env.production` (`POSTGRES_PASSWORD`,
`SESSION_SECRET`, `BACKUP_PASSPHRASE` replaced) — **no secret is stored in the backup**.

**Restore verification — PASS.** Decrypted *inside* a container (no plaintext ever written
to the host), `pg_restore --list` → 557 objects, restored into a throwaway
`postgres:16-alpine` on an **isolated Docker network** with no host port. The same
`baseline.sql` probe over the restored copy was **byte-identical to live production** —
all 86 counts, all 86 row fingerprints, all anchors, zero differences.

**Uploads verification — PASS.** 88 files in the archive, and the aggregate SHA-256 over
every file's digest matches the live volume exactly:
`37a850c3ac88e87085659bd60f001099550bf4872cdc51e80aed85ae733ee3a8`.

### Rollback

- Rollback image **`madrasa-app:0.1.0-prev-v2_4-20260803`** = `sha256:7f5ff14a…` (v2.3 rc2).
- **Boot-proven**: the rollback image was started against the *restored* pre-deploy backup
  on the isolated network and reported `{"status":"ok","db":"up"}`, `/login` 200, `/plan` 307.
- Exact commands: `backups/predeploy/ROLLBACK-20260803-065900.txt`.
- Migrations 0027/0028 are additive-nullable, so the v2.3 image runs unchanged on ledger 29
  — **rollback requires no database action**. A DB restore is reserved for explicitly
  identified data corruption only.

### Post-deployment gold backup — `20260803-gold`

| Artifact | Size | SHA-256 |
|---|---|---|
| `backups/gold/db-20260803-gold.dump.enc` | 7 343 312 B | `a56ddf2006c2fea423e69c5f87552c548cc09cc2b2e02033fc61411670b93e7c` |
| `backups/gold/storage-20260803-gold.tar.gz.enc` | 34 908 688 B | `d97ff549b6a3b12208bef2fb3a70cc4e234d1f376e52904e8d430365610efdc6` |

Checksums verify OK. **Restore-verified** into an isolated network (`pg_restore --list` →
558 objects); the probe over the restored gold copy was **byte-identical to live
production at ledger 29**. Verification environment destroyed afterwards.

## 7) Downtime

**≈ 0.2 s.** Availability was polled at 0.2 s resolution across the swap: 36 samples,
35 UP, **1 DOWN**; the next successful sample landed 0.3 s later. The container reported
`healthy` 6 s after recreation. The database served continuously throughout.

## 8) Environment cleanup

- No v2.4 acceptance/rehearsal environment was left running from the release work — the
  clone rehearsal of 2026-08-02 had already been destroyed.
- Every temporary environment created *during this deployment* was removed: the backup
  restore-verification DB, the rollback boot probe, the functional-verification clone
  (app + DB) and the gold restore-verification DB, together with their isolated networks.
  The temporary credentials copy used for the smoke was deleted.
- **Only one application is user-facing: `madrasa-prod-app-1` on `0.0.0.0:3080`.**
  `madrasa-prod-db-1` publishes nothing.
- `madrasa-db` (compose project `fathersfile`, host port 5544) remains up. It is the
  **development** database — it holds only `madrasa` (dev) and `madrasa_test` (e2e), has no
  application container attached, and is not a v2.4 acceptance environment. It was
  deliberately left intact; see §10.
- Preserved as required: production database volume, uploads, all backups, the rollback
  image, the gold backup and all deployment evidence.

## 9) Deferred / not executed by design

- Checks 16 and 17 were verified by affordance and server-side guard, **not executed** — a
  deployment smoke must not delete or archive real evaluation forms.
- Check 13 verified the program-card access point without issuing a document (issuing would
  write a `documents` row).
- Checks 2, 7, 18, 19 were completed on a disposable clone of the same day's production
  data rather than by mutating production or by using the principal's own password.
- The principal's `/pilot` retest (21 v2.4 tasks) remains the acceptance channel for the
  interactive confirmation of the principal-scope screens.

## 10) Known limitations (carried forward, not introduced by this deployment)

1. **Tailscale Serve is not configured on the host** (`tailscale serve status` → "No serve
   config"), so the HTTPS production URL `https://faheds-mac-mini.tailf84da9.ts.net` is not
   currently served. This predates the deployment; access today is over plain HTTP on the
   LAN binding. Gate C5 (camera/PWA secure-context) therefore stays deferred (D-018).
2. **`TRUSTED_ORIGINS` is stale**: it lists `192.168.0.171:3080` while the Mac mini's DHCP
   lease is now `192.168.0.48`. Pre-existing and unchanged by this deployment; a router DHCP
   reservation is the durable fix.
3. The individual-performance authorization denial surfaces as a generic
   «تعذّر إتمام العملية» error boundary rather than an explicit "not authorized" page, and
   the HTTP status is 200. **No data leaks** — the page renders zero performance content.
   The guard line is identical in the v2.3 baseline, so this is pre-existing cosmetics.
4. The `madrasa-db` development database publishes `0.0.0.0:5544`; loopback-only would be
   tighter. Unrelated to production (production PostgreSQL is unpublished).
5. `madrasa-prod-init-1`, an exited one-shot container from the v2.3 deployment, is still
   present. Harmless (stopped, no ports); left untouched to avoid unnecessary changes.
6. All limitations recorded in `docs/DELIVERY_V2_4.md` §12 continue to apply.

## 11) Baseline

**v2.4.0 is the current production baseline.** The next release compares against:
ledger **29**, tables **86**, image `sha256:2f69c724c625…`, commit `da8db16`, tag `v2.4.0`,
D-022 anchor `4572c57060e20c4b0de4db52545a8e3f`.
