# v2.5.0 — Authorized Production Deployment Report (2026-08-06)

> Release record for the reporting / filtering / workflow / data-entry scope, including the
> post-deployment corrective fix for the two acceptance requirements that failed the smoke.
> Implementation record: `docs/DELIVERY_V2_5_0.md`. Previous release: `docs/DEPLOYMENT_V2_4_1.md`.

## 1) Executive verdict

**DEPLOYED — HEALTHY, after one corrective iteration.**

v2.5.0 is the sole production version. It serves the existing production environment on the
unchanged host port `3080` under the established compose project `madrasa-prod`, on the same
database, uploads volume and secrets. Only the application container was ever replaced; the
database container was never restarted at any point. Rollback protection is in place at every
step.

The deployment ran in three app swaps:

| Swap | Image | Commit | Why |
|---|---|---|---|
| 1 | `0410fdb3ce9f` | `f4920a7` | the authorized RC |
| 2 | `f90d7234ccd0` | `76c885b` | corrective fix for the two failed acceptance checks |
| 3 | `bcd629a54848` | **`39674ed`** | one label said «عتبة» where the export said «حد» |

**Across the entire deployment, not one production business record was created, updated or
deleted.** The final integrity probe against the pre-deployment baseline differs only by the
three migrations' own additive effects — no row count, no fingerprint and no anchor changed
otherwise. `audit_log` and `sessions` are also unchanged, because the authenticated smoke was
never run against production (see §9).

## 2) Previous → new production version

| | Previous | New |
|---|---|---|
| Version | v2.4.1 | **v2.5.0** |
| Commit | `6d7dacf` | **`39674ed`** (branch `scope-v2.5-reporting-workflows`, worktree clean) |
| Image tag | `madrasa-app:0.1.0` (= v2.4.1) | `madrasa-app:0.1.0` (= `0.1.0-v2_5_0-fix2-rc`) |
| Image digest | `sha256:4b427c8e16d8…` | **`sha256:bcd629a54848dd84fdbd2efff46dd23fcd5e91fefac2b792ed1cfc10f16722a1`** |
| Platform | linux/arm64 | linux/arm64 |
| App container | `e90411be41b3` | **`b25dd5048d04`** |
| DB container | `c0d011f245dd` | `c0d011f245dd` — **unchanged, never restarted** |

Release tag: **`v2.5.0`** (annotated, on `39674ed`). The image carries `RELEASE_COMMIT=39674ed`
and reports it from `/api/health`.

## 3) Production URL and port — unchanged

- Compose project `madrasa-prod`, service `app`, host binding **`0.0.0.0:3080 -> 3080/tcp`**.
- `APP_URL`, `TRUSTED_ORIGINS`, volumes, uploads and secrets untouched.
- PostgreSQL remains **unpublished** — internal `5432/tcp` only. Security posture unchanged.
- Volumes preserved: `madrasa-prod_pgdata`, `madrasa-prod_storage` (94 upload files),
  `madrasa-prod_backups`. Read-only container root filesystem retained.

## 4) Database ledger

**31 → 34.** Tables **88 → 89**.

| # | File | Change |
|---|---|---|
| 0031 | `0031_unknown_master_chief.sql` | `program_followups` — six nullable columns |
| 0032 | `0032_jittery_mister_sinister.sql` | new table `report_templates` |
| 0033 | `0033_v250_report_builder_permissions.sql` | data migration — 3 permissions, 6 grants |

Applied once, through the migrate-only `init` service with `--no-deps`
(`sh -c npx tsx src/db/migrate.ts`) running the **RC image**, before the app was swapped. The
resolved compose config contains **zero** occurrences of `seed.ts`. The corrective swaps
required no migration — the ledger stayed at 34.

### Proof the database container was not restarted

| Probe | Pre-deployment | After every swap |
|---|---|---|
| Container id | `c0d011f245dd…` | `c0d011f245dd…` |
| `State.StartedAt` | `2026-08-05T14:18:51.4377225Z` | `2026-08-05T14:18:51.4377225Z` |
| `State.Pid` | `728` | `728` |
| `RestartCount` | `0` | `0` |
| `pg_postmaster_start_time()` | `2026-08-05 14:18:51.787352+00` | unchanged |

### Data integrity — full pre/post diff

`scripts/v250-prod-probe.sql` emits a row count and an order-independent full-row fingerprint
for **every** base table, plus nine named anchors. It was run seven times across the
deployment. The complete cumulative diff, pre-deployment (ledger 31) → final (ledger 34):

```
## LEDGER  31  ->  34            ## TABLES  88  ->  89
cnt permissions        59 -> 62        (0033: three new permissions)
cnt role_permissions  115 -> 121       (0033: six new grants)
+ cnt report_templates   0             (0032: new table, empty)
fp  permissions       changed          (the three new rows)
fp  role_permissions  changed          (the six new rows)
fp  report_templates  <empty>          (new)
fp  program_followups changed          (0031: row literal gained six NULL columns)
anchor perms_v250       0 -> 6
```

Nothing else changed. Specifically:

- **Every other table count and fingerprint is byte-identical**, including `audit_log` and
  `sessions`.
- The one table whose row literal changed is proven unmodified by the dedicated
  **pre-0031-columns-only** anchor `pf_pre0031`, which is **unchanged** — the six new nullable
  columns altered no existing record.
- New columns are **100 % empty**: 0 of 5 follow-up rows carry any of the six values.
- All other anchors byte-identical: `d022_programs`, `people_roster`, `committees`,
  `stored_files`, `issued_documents`, `mi_pre0030`, and finance sums `income=5101 expense=3399`.

## 5) The two acceptance failures, and the corrective fix

The first swap deployed the authorized RC and the smoke found two of the 26 mandatory checks
failing. Both were real; neither was a rollback trigger; the fix was rolled forward.

### Issue 1 — the low-performance threshold had no on-screen control

The default of 70 worked and `?lowThreshold=` worked. What was missing was any way for the
principal to *reach* it: `showLowThreshold` was a component prop **no page ever passed**, so the
feature was real in the engine and invisible in the product.

The threshold is now a **first-class filter key**, which is what makes the shared panel render
it — so a future performance report that declares it gets the control automatically, and one
that forgets to declare it fails a test rather than shipping another invisible threshold.

- Label «حد الأداء المنخفض», helper text «يعرض الموظفين الذين تقل نتائجهم عن النسبة المحددة».
- Default **70**, accepted range **0–100**; non-numeric input falls back to the default and
  out-of-range input is clamped — never applied raw.
- Declared by `perf-results`, `perf-low-performers`, `perf-strengths-weaknesses` and
  `perf-distribution`; the report builder inherits it from the same declaration.
- `perf-distribution` gained a «دون الحد» column — the statistical report now answers the
  threshold question too, because a control that changes nothing on screen is not a control.
- Applied to screen rows, result count, the named low-performer table, all four export formats,
  and saved templates (the value round-trips through template serialization).
- **The generated report header states the threshold always, including at the default.** A list
  of names below a threshold the file never mentions cannot be checked by whoever reads it later.
- Excel exports carry the active filters on a separate sheet; the data sheet stays a pure table
  so spreadsheet imports do not break.

### Issue 2 — a blank financial amount saved as NULL

The v2.1 §H rule («all fields optional») had swallowed the amount itself, so a transaction could
be recorded that enters no total, no balance and no spending percentage — present in the ledger,
absent from every number. The rule still holds for the descriptive fields: source, purpose,
invoice number, supplier, notes and attachment all remain optional.

`src/lib/finance/amount.ts` is now the single definition used by income, expense and allocation
alike. It rejects blank, whitespace, `null`, `undefined`, non-numeric text, negative, **zero**,
precision finer than one halalah, and anything beyond `MAX_MONEY_AMOUNT`. Message:
«مبلغ العملية مطلوب ويجب أن يكون أكبر من صفر».

**The rejection is on the server.** The regression suite drives the real Server Actions with
hand-built `FormData` — no browser, no HTML `required`, which is exactly the shape of a forged
request — and asserts that when validation fails **neither a business row nor an audit row is
written**. The `required` attribute in the forms is a convenience, not the control.

Removing an item's allocation remains possible, but is now an **explicit intent**
(`removeAllocation`) rather than the side effect of a field left empty — so the capability is
kept while the blank submit that silently wiped an allocation is closed.

### Two further defects found while proving the fixes

1. **`Field` rendered `type="number"` with no `step`**, so the browser's default `step=1`
   rejected «12.50» silently — no message, no request, the save simply appeared not to happen.
   Every money input in the platform was unable to accept the halalah the finance module
   computes in. `step`/`min` are now supported and passed by all money fields.
2. A forged `1e30` was refused with "amount required" instead of "over the limit" — the format
   check swallowed the value before the bound check could report the real reason.

### And one found by the smoke after the corrective swap

The filters panel chip still said «عتبة الأداء المنخفض» while the exported header said
«حد الأداء المنخفض» — two names for one filter. Fixed in `39674ed`; both now read the shared
definition. This is why swap 3 exists.

## 6) Production smoke tests — 26 / 26

Executed against the **deployed image** on a disposable clone of the **post-deployment
production database** (ledger 34, tables 89) plus a copy of the uploads volume, on an isolated
network at loopback `127.0.0.1:3087`, with a clone-only principal account.

| # | Check | Result |
|---|---|---|
| 1 | Shell shows «الإصدار 2.5.0» | **PASS** |
| 2 | Weekly follow-up has no percentage entry | **PASS** — 0 progress inputs |
| 3 | Weekly screen and report show the same data | **PASS** — screen 11 = report 11 |
| 4 | Programme editing visible before approval | **PASS** |
| 5 | Editing available in every lifecycle state | **PASS** — all four live states |
| 6 | Programmes by responsible person: one / several / all | **PASS** — 1 / 5 / 28 |
| 7 | Programmes by domain: one / several / all | **PASS** — 7 / 12 / 28 |
| 8 | Programme names appear in both reports | **PASS** |
| 9 | Committee reports separate committees clearly | **PASS** — 41 rows, 4 committees, no merged cells |
| 10 | Committee names, members, roles, tasks appear | **PASS** |
| 11 | Detailed meeting registry available | **PASS** |
| 12 | Teachers and administrative staff filtered separately | **PASS** — 4 / 2 of 6 |
| 13 | Individual performance report visible | **PASS** |
| 14 | All-employees report shows names | **PASS** |
| 15 | Low performers appear by name | **PASS** — explained empty state (nobody under 70 in this data) |
| 16 | Default threshold 70 and editable | **PASS** — control present, value 70, helper text, editable |
| 17 | Report builder available | **PASS** |
| 18 | Saved templates work | **PASS** — saved, re-ran, audited |
| 19 | Filtered PDF and CSV use the same active filters | **PASS** — csv 1 617 B carries the filter, pdf 49 247 B `%PDF-` |
| 20 | Employee deletion completes | **PASS** |
| 21 | Performance-cycle deletion completes | **PASS** |
| 22 | Unused evaluation-form deletion completes | **PASS** |
| 23 | Optional fields save blank where intended | **PASS** — person saved with only a name |
| 24 | Financial amount remains mandatory | **PASS** — blank rejected, no row written |
| 25 | Audit logging works | **PASS** |
| 26 | No unexpected application errors | **PASS** — 0 console errors, 0 page errors |

Harness: `scripts/v250-smoke.mjs`. Every destructive step created and removed its own record;
all production-copied tables were byte-identical afterwards.

Against **live production** directly (unauthenticated, read-only): `/api/health` reports
`version=2.5.0 commit=39674ed environment=production`; `/login` 200; `/plan`, `/reports` and
`/reports/builder` all 307 to the auth gate; security headers intact (`X-Frame-Options: DENY`,
`nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy`, CSP); `/api/health` leaks no
connection string, secret, token or path; container log carries **0 error lines** since the swap.

### Harness honesty notes

- Check 18 is **timing-flaky**: it failed on one of four runs when the builder's name box had
  not attached before it was filled. The template flow itself was proven deterministically —
  row created, listed, re-run, audited. Product behaviour is correct; the harness step needs a
  firmer wait.
- Two earlier harness bugs produced **false results** and were fixed before the numbers above
  were trusted: check 24 first "passed" because a loose selector clicked the expense form's
  button instead of the income form's, and check 18 failed because «تشغيل» also matches the
  sidebar's «مركز التشغيل التجريبي».

## 7) Automated gates

| Gate | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm test` | **1042 / 1042** across 103 files (975 / 100 at the RC) |
| `npm run build` | success |
| `npx playwright test tests/e2e/zzzzz-v250-corrective.spec.ts` | **9 / 9** |
| `npm run test:e2e` (full) | 80 passed, **11 pre-existing failures**, 8 skipped |

The 11 full-suite failures are **not caused by this work** — verified by stashing the changes and
re-running the report specs, which fail identically on the untouched tree. They are stale
expectations on this branch (one literally asserts «الإصدار 2.4.1») from the v2.5.0 §14 reports
reorganisation; the delivery record already noted the suite was never run end to end. Fixing
them is follow-up work, listed in §10.

New regression suites:
- `tests/unit/finance-required-amount.test.ts` — 20 assertions on the amount schema
- `tests/integration/finance-required-amount.test.ts` — 29 assertions incl. forged requests,
  and "no business row and no audit row on failure"
- `tests/integration/perf-low-threshold.test.ts` — 17 assertions: declaration, default 70,
  60 vs 80 changing the matching **names**, safe normalization, export parity, template retention
- `tests/e2e/zzzzz-v250-corrective.spec.ts` — 9 browser scenarios

## 8) Backup, restore verification and rollback

Three encrypted backup sets were taken — one before the migration, one before each corrective
swap — plus the gold set. **AES-256-CBC, PBKDF2, 200 000 iterations, salted**; the passphrase is
passed by environment only, never on argv. Taken **inside the production network** through the
compose `init` service, because production PostgreSQL is unpublished and a host-side backup
would silently capture the *development* database instead.

### Gold backup — `20260806-gold`

| Artifact | Size | SHA-256 |
|---|---|---|
| `backups/gold/db-20260806-gold.dump.enc` | 8 128 960 B | `ed8d2724da0db562fc4f491b3d6f4e88e21dbf400cb676dcb0200b7705f94d51` |
| `backups/gold/storage-20260806-gold.tar.gz.enc` | 35 660 624 B | `cdf63443b936d4a3a22b072874e4f4bfefe08ef10f9ee7979e7b5fb34939a3aa` |
| `backups/gold/config-20260806-gold.tar.gz.enc` | 578 400 B | `e64c49b22fce956ec6d8f031a1b199a5f50c8831d6003dc7b8412eb47aea22d0` |

Checksums verify **OK**. **Restore-verified**: decrypted *inside* a container (no plaintext ever
written to the host), restored into a throwaway `postgres:16-alpine` on an `--internal` Docker
network with no host port — `pg_restore --list` → **578 objects** — and the full probe over the
restored copy was **byte-identical to live production, 0 differences**. Uploads verified by
aggregate digest over every file: `2a81ec86737a…` on both sides. Environment destroyed after.

The config archive carries `package.json`, `package-lock.json`, `compose.production.yml`,
`Dockerfile.production`, `next.config.ts`, `drizzle.config.ts`, all **34** migrations, and a
**redacted** `.env.production`. The backup script aborts if a real secret ever reaches the
staged config tree — **no secret is stored in any backup.**

### Rollback

- `madrasa-app:0.1.0-prev-v2_5_0-20260806` = `4b427c8e16d8` (**v2.4.1**) — full rollback.
- `madrasa-app:0.1.0-prev-v2_5_0-fix1-20260806` = `0410fdb3ce9f` (RC).
- `madrasa-app:0.1.0-prev-v2_5_0-fix2-20260806` = `f90d7234ccd0` (first corrective).
- Migrations 0031–0033 are additive, so **rollback needs no database action** — demonstrated
  live: the v2.4.1 image ran healthy against the already-migrated ledger-34 database for the
  entire window between the migration and the first app swap.
- **No rollback trigger occurred. Rollback was not exercised on production.**

## 9) Not executed — stated, not implied

**The authenticated smoke was never run against live production.** Every authenticated check
above was executed on a disposable clone of post-deployment production data running the deployed
image. Two reasons: a deployment smoke must not delete a real employee, a real performance cycle
or a real evaluation form; and no production credentials were entered, by instruction
(credentials are to be entered locally by the owner, never pasted into a transcript or a file).

This is why production `audit_log` and `sessions` are unchanged — a stronger integrity result
than v2.4.1's, but it also means **the owner's own authenticated pass on `http://<host>:3080` is
still outstanding.** To complete it:

```bash
cd "/Users/fahedalfify/Developer/School/Father's File"
MODE=production BASE=http://127.0.0.1:3080 PG=madrasa-prod-db-1 \
  SMOKE_USER=<user> SMOKE_PASSWORD=<password> node scripts/v250-smoke.mjs
```

In `MODE=production` the script writes nothing to business data; the deletion and blank-field
checks report `DEFERRED` and verify affordance only.

## 10) Known limitations

1. **The full Playwright suite has 11 pre-existing failures** on this branch, unrelated to this
   deployment and unchanged by it. Mostly stale selectors from the §14 reports reorganisation,
   plus one asserting the old version string. They should be brought up to date before the next
   release, so the suite can serve as a gate again.
2. **Smoke check 18 is timing-flaky** (1 failure in 4 runs) — harness, not product.
3. **Building the release image on the production host restarts the production app.** During the
   first corrective build the OS killed the app container **5 times** between 09:47:47 and
   09:49:20 under memory pressure; `restart: unless-stopped` recovered it each time in
   89–393 ms, `ExitCode=0` (not an OOM kill by Docker), and the database was never touched. The
   second build, run after tearing down the verification clone to free memory, caused **zero**
   restarts. Build off-host, or free memory first — and never during school hours.
4. **`perf-distribution`'s «دون الحد» column** is new. Saved templates created before this
   release do not select it; they keep working and simply omit the column.
5. **Tailscale Serve is still not configured**, so the HTTPS production URL is not served;
   access is plain HTTP on the LAN binding. Tailnet-wide admin action, outside the agent's
   reach. Gate C5 stays deferred (D-018).
6. Authorization denials still surface as a generic error boundary rather than an explicit
   "not authorized" page. No data leaks. Pre-existing.
7. Permanent deletion remains **irreversible** except by restoring a backup.
8. The **D-049 sweep is still partial** beyond the 202 sites D-053 removed.
9. `madrasa-prod-init-1`, an exited one-shot container from the v2.3 deployment, is still
   present. Harmless; left untouched.
10. Not delivered in this scope and still the owner's call: §11.3 filter-responsive budget
    summary cards, and §12.4 "evaluation form optional on a performance cycle"
    (`perf_cycles.model_id` is `NOT NULL` — a data-model decision, not a validation tweak).

## 11) Environment cleanup

Every temporary environment created during this deployment was destroyed: three backup
restore-verification databases, three verification clones (app + Postgres + two volumes each),
and their isolated networks. **0 stray containers, 0 stray volumes, 0 stray networks.**
Only one application is user-facing: `madrasa-prod-app-1` on `0.0.0.0:3080`.
`madrasa-prod-db-1` publishes nothing.

Preserved as required: the production database volume, uploads, all backups, the three rollback
images, the gold backup and all deployment evidence
(`storage/private/v250-deploy/`, git-ignored — it contains real school data).

## 12) Baseline

**v2.5.0 is the current production baseline.** The next release compares against:
ledger **34**, tables **89**, image `sha256:bcd629a54848…`, commit `39674ed`, tag `v2.5.0`,
D-022 programme anchor `21484d06ab2c19ad6be4fcf33b51401c`,
`pf_pre0031` anchor `5e2bf4c82f7e9b244cb27f9c71906a2f`,
uploads aggregate `2a81ec86737a6a82d59f6cb981a4cc553f6b8f6d4fc0ce6ac6801eb240e7d323`.
