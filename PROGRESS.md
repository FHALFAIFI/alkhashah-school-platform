# PROGRESS — سجل التقدم

> Resume protocol: read this file top-to-bottom, then `git log --oneline -20`, `git status`, `docs/DECISIONS.md`, and `docs/TEST_RESULTS.md`. Continue from the last checkpoint — never restart.

## Latest checkpoint — **v2.6.0 CORRECTIVE ROUND after the reopened ARM64 gate (2026-08-09), NOT DEPLOYED**

The isolated ARM64 gate reopened the release: three browser scenarios failed over direct
HTTP/1.1 (finalize badge, «مستبعد» visibility, an in-app navigation) while passing over
HTTP/2, and the owner declared the exact empty-category URL an explicit acceptance
condition. Both corrective changes were authorized and are implemented on this commit;
digest `sha256:413b90d9…` (25cc24c) is **superseded** — preserved as historical evidence,
never deployable; none of its candidate-specific evidence carries over.

**D-069 — the root cause of the whole «الواجهة لا تتحدث بعد الحفظ» lineage, found and
fixed.** In production builds, the post-action `router.refresh()` was silently discarded by
the client router whenever a `loading.tsx` boundary sat in the tree — an upstream Next 16.2
defect (vercel/next.js#86151; fixed only in 16.3). The server always answered with a
complete, well-formed flight body (proven by header-replay and slow-read probes); the
client dropped it, applying ~2/6 by timing luck — always in dev, practically always over
HTTP/2. This was the v2.2.1 «UI does not refresh after save» issue and the v2.3 "never e2e
against host `next start` (env quirk)" note, neither of which was an environment quirk.
Shipped together (D-069 in `docs/DECISIONS.md`): `(app)/loading.tsx` removed;
`prefetch={false}` on all 84 app links (the v16 per-action refetch storm of every
in-viewport link — vercel/next.js#93210 — was saturating HTTP/1.1's six connections);
verified refresh (per-render `data-render-stamp` + bounded 3-attempt retry in the
`useRefresh*` hooks); and refresh-independent visible outcomes — row decisions publish
their returned status to a client store (~60 ms to a visible «مستبعد» in both the card and
the table), and the §I watcher polls a lightweight JSON endpoint
(`/api/reports/instances/[id]/job`; no overlap, explicit timeout/error states, unmount
cleanup) with exactly one verified refresh at the terminal state, outcome rendered
client-side from the poll payload.

**D-068 acceptance condition:** `?category=&report=maintenance-register` (both orderings)
resolves the report independently, derives its catalog category, and redirects to the
canonical URL; five cases distinguished (none/valid/empty/unknown/mismatch); no phantom
chip possible. E2E block in `zzzzz-v260-filters.spec.ts` proves title, seeded row, exact
count and chip absence for every rendering case.

**Evidence so far (isolated port 3199, production build, plain HTTP/1.1 — production and
:3080 untouched):** focused browser probes ×3 each — exclusion badge visible in ~60 ms,
server counters reconciled by the single refresh, state correct after revisit, undo works;
finalize badge appears 3/3 with zero document reloads; batch-page navigation ~80 ms 3/3.
Full Playwright suite against the production build over HTTP/1.1: 144 passed / 1 named
skip / 3 failed only in a locator of the new D-068 block (fixed; block then 15/15) —
running the suite against `next start` at all was impossible before this fix. Full
validation (3× external suite + vitest + dev-mode suite), CI on the new SHA, the
replacement multi-platform image (now amd64+arm64 in one manifest list, smoke runs the
pushed digest itself), nine regenerated DOCX samples, and the complete repeated ARM64 gate
follow this checkpoint.

**Follow-up in the same round — Next.js 16.3.0.** Commit `3c4a156` validated fully green
locally (external ×3 147 passed each, vitest 1203/1203, dev suite 147/1-skip) but went red
on **both** CI triggers at one step: a sidebar navigation right after the login action,
CI runners only. That is the second half of the D-069 upstream defect — a navigation
dispatched while a server action is settling is discarded by the router's action queue —
fixed upstream only in Next 16.3.0 (vercel/next.js#95391); removing `loading.tsx` widens
the vulnerable window on slow machines, which is why only CI (and potentially the school's
slowest clients) could hit it. Upgraded next + eslint-config-next to 16.3.0 (stable,
2026-08-03), kept every app-level change and the `loading.tsx` removal, replaced one
`window.location.href` internal navigation with `router.push` for the new 16.3 lint rule
(evidence manage UI). See the D-069 addendum in `docs/DECISIONS.md`. Full validation
repeats on 16.3.0 before the replacement candidate is cut.

## Superseded checkpoint — **v2.6.0 — RC READY, AWAITING DEPLOYMENT AUTHORIZATION (2026-08-09), NOT DEPLOYED**

Final SHA: the head of `feat/v2.6-reporting-platform` (the commit carrying this checkpoint).
All seven CI jobs green on **both** triggers; run URLs, counts and the immutable arm64
digest are recorded in **PR #1** — per-run values cannot live inside the commit that
produced them. Vitest **1203/1203** across 118 files locally (1200 + 3 CI skips);
Playwright **140 passed · 0 failed · 0 did not run · 1 skipped** across 141 tests.

**What changed since the NOT READY checkpoint.** D-066 was filed as an unfixable framework
defect with an operational workaround. It was neither. The App Router identifies a page by a
key built from `Object.fromEntries(new URLSearchParams(search))`, which keeps only the **last**
occurrence of a repeated query key — so `?domain=أ&domain=ب` and `?domain=ب` are the same page
to the router, and it never asks the server. The platform now writes a multi-value filter as
**one** parameter with a U+001F-separated list, so every distinct selection is a distinct
page. Reading still accepts the old shape and the stored shape is unchanged, so no link,
template or instance breaks and no migration is needed.

Root-causing it exposed two more real defects in the approved scope, both fixed:
**D-068** — «التصنيف» shared the parameter name `category` with the reports centre's
navigation, so **«بلاغات الصيانة» came back empty however many issues existed** whenever it
was opened from the centre; and the session-filter restore re-applied a filter the user had
just removed. Column reordering and hiding in the report builder failed by the same
mechanism as D-066 and are fixed with it.

**Open product defects: none.** The `test.fixme` that held D-066's reproduction is now a
passing test.

**The arm64 binary has still never been executed.** The CI runtime smoke is a runner-native
amd64 build of the same Dockerfile and commit: it proves the code migrates, boots and answers
`/api/health` with the right version and commit, not that the pushed arm64 image runs. Running
it on the Mac mini against an isolated database on a temporary port is the **first mandatory
pre-swap gate** and it awaits Fahad's authorization.

Full account: `docs/DELIVERY_V2_6_0.md` §1, §5a, §5b, §5, §10; decisions D-065…D-068.

## Superseded checkpoint — **v2.6.0 REPORTING PLATFORM — RC ON BRANCH (2026-08-08), NOT DEPLOYED**

Branch `feat/v2.6-reporting-platform` (base `0488f1a` = main = v2.5.0 docs tip), Draft PR #1.
Spec: `docs/requirements/v2.6-reporting-platform-specification.md`; decisions **D-055…D-060**.
**Production and port 3080 untouched throughout.** Deployment sequence and rollback prepared
in `RUNBOOK.md` («المرشَّح القادم — v2.6.0») — awaiting explicit owner authorization.

- **What v2.6 adds:** report *instances* — a fourth artifact class over the one catalog:
  draft → **finalized with a unique locked-counter number** (`KHS-RPT-<hijri>-NNNN`) and a
  frozen `SnapshotDoc` → archived. DB-level immutability **triggers** (migration 0035)
  reject any content mutation or deletion of a non-draft instance; ZIP is the sole
  replaceable output (signed copy arrives late — D-060). Composite types (periodic /
  final-term / executive) are ordered sections bound to catalog reports (D-056). Five
  protected base templates in code + custom copies in DB (D-058). «مكتب التعليم» removed
  from identity/templates/rendering; ministry source data untouched (D-057). Exports:
  RTL DOCX with real editable header/footer and **mixed portrait/landscape sections**
  (proven: both MediaBoxes in one PDF via named CSS pages + preferCSSPageSize), XLSX with
  summary+per-section sheets and safe sheet names, verified flat-name ZIP. Background
  generation via `after()` + `report_jobs` (one active job per instance, stale takeover,
  Arabic failure reasons, idempotent outputs — D-059). Archive UI at `/reports/archive`
  with search, live draft preview off the same SnapshotDoc, signed-copy upload, print
  preview serving the *exact* PDF HTML.
- **Migrations 34 → 36** (0034 five additive tables; 0035 hand-written triggers+index,
  idempotent). Upgrade rehearsal scripted (`scripts/ci-migration-upgrade-test.sh`):
  v2.5.0 ledger 34 → 36 with byte-checked markers and a live trigger-rejection probe —
  PASS locally. Rollback stays app-only (new tables ignored by the older image).
- **Real v2.5.0 defect found and fixed by the v2.6 stress audit:** every export beyond
  200 rows silently lost the rest (`runReportForExport` → `paginate` → `clampPageSize`
  capped at the screen page size; truncation flag only raises at 5000). Fixed; pinned by
  `tests/integration/export-full-rows.test.ts`.
- **First CI pipeline** (`.github/workflows/ci.yml`): lint/typecheck, vitest with a
  Postgres 16 service, clean + upgrade migration jobs, production build, and a synthetic
  sample-artifacts job (9 reports × PDF/DOCX/XLSX/ZIP + print HTML + screenshots — all
  five base templates over a 60-row/13-column landscape table, multi-section periodic,
  chart, and empty-report samples; `scripts/v260-ci-artifacts.ts`).
- **Perf (§J)** `scripts/v260-perf-audit.ts`: preview 11–27 ms, archive search 3 ms,
  frozen-snapshot render <1 ms, docx 17 ms, xlsx 5 ms, pdf 1 241 ms (background); 5 100-row
  stress case truncates *declaredly* — all within targets.
- **Tests:** baseline 1042/103 green → v2.6 adds ~100 more (lifecycle+trigger refusals,
  snapshot frozen while source data changes, filter isolation, D-013 hiding, outputs/job
  idempotency, stale retry, signed-copy ZIP, exporter XML/structure inspection, render
  injection, catalog-wide privacy pin, identity D-057 pins incl. filesystem scan).
- **Pending:** real-Microsoft-Word acceptance of DOCX (structural validation done; a
  human must open the files in Word), owner-authorized deployment, principal acceptance.

**Verdict: DEPLOYED — HEALTHY**, after one corrective iteration. Full record:
**`docs/DEPLOYMENT_V2_5_0.md`** (implementation record: `docs/DELIVERY_V2_5_0.md`).
Tag `v2.5.0` on `39674ed`; image `madrasa-app:0.1.0` = `sha256:bcd629a54848…`;
host port **3080** unchanged; ledger **34**, tables **89**; the database container was
**never restarted** (pid 728, RestartCount 0) at any point.

- **Not one production business record was created, updated or deleted.** The cumulative
  integrity probe against the pre-deployment baseline differs only by the three migrations'
  own additive effects — `audit_log` and `sessions` included, because the authenticated smoke
  ran on a clone rather than on production.
- **Smoke 26/26** on a disposable clone of post-deployment production data running the deployed
  image. Interruption ≈1.03 s (migration swap), ≈0.77 s and ≈0.78 s (corrective swaps).
- **Gold backup `20260806-gold`** restore-verified into an isolated environment — 578 objects,
  **0 differences** from live production; uploads aggregate digest matches exactly.
- **Two acceptance requirements failed the first smoke and were fixed forward** (§5 of the
  deployment record):
  1. the low-performance threshold had **no on-screen control** — `showLowThreshold` was a prop
     no page ever passed. It is now a first-class filter key (label «حد الأداء المنخفض»,
     default 70, range 0–100), applied to screen, count, names, all four export formats and
     saved templates, and the exported header states it **always**;
  2. a **blank financial amount saved as `NULL`**. `src/lib/finance/amount.ts` is now the single
     definition for income, expense and allocation; rejection is **server-side** (proven with
     forged `FormData`, asserting that neither a business row nor an audit row is written).
- **Two further defects found while proving the fixes:** `Field` rendered `type="number"` with
  no `step`, so the browser silently rejected «12.50» — every money input was unable to accept
  a halalah; and a forged `1e30` was refused with the wrong reason.
- **Gates:** typecheck 0 · lint 0 · **1042/1042 vitest across 103 files** · build success ·
  Playwright **9/9** on the new corrective spec.
- **Outstanding:** the owner's own **authenticated pass on production** (credentials are entered
  locally, never pasted into a transcript — command in §9 of the deployment record), and the
  **11 pre-existing Playwright failures** on this branch, which are unrelated to this
  deployment and were verified unchanged by stashing the fixes.

---

## Previous checkpoint — **v2.5.0 READY FOR DEPLOYMENT (2026-08-05)**

**Verdict: READY — awaiting the owner's explicit authorisation.** Full record:
**`docs/DELIVERY_V2_5_0.md`**. Branch `scope-v2.5-reporting-workflows`, RC image
`madrasa-app:0.1.0-v2_5_0-rc` = `sha256:0410fdb3ce9f…`. Deployment sequence in `RUNBOOK.md`.

- **Gates.** typecheck 0 · lint 0 · **975/975 vitest across 100 files** · build success ·
  clone rehearsal **49/49** · rollback **PASS, no database action** · RTL/visual **100/100**
  (25 surfaces × 4 widths) · exports **27/27** · security **22 assertions, 3 findings fixed** ·
  performance **17 surfaces, 9–73 ms**.
- **Migrations 31 → 34, tables 88 → 89.** 0031 six nullable/defaulted columns on
  `program_followups`; 0032 `report_templates`; 0033 a **data migration** adding three
  permissions and granting them — necessary because the seed service is profile-gated and never
  runs in production. Additive only; rollback needs no database action (proven by booting
  v2.4.1 against the migrated database).
- **D-053.** All 202 `revalidatePath` call sites removed from the application layer; clients
  refresh themselves after the result settles. Confirmed on the RC image against production
  data: edits save *and their messages appear*, follow-ups record, deletes complete and
  navigate.
- **D-054.** The weekly follow-up records an observation, not progress: the manual percentage
  is gone everywhere and the weekly axis no longer overwrites programme progress or state.
- **Two scope items deliberately not delivered** (owner's call, not silent omissions):
  §11.3 filter-responsive budget cards — the cards now declare their scope instead; and §12.4
  "form optional on a performance cycle" — `perf_cycles.model_id` is NOT NULL and a cycle
  without a form cannot be evaluated at all.
- **Production untouched by the work itself**, with one disclosed exception: the production
  *app* container was killed by the host OS during the RC image build and auto-restarted
  (~0.4 s) on the same v2.4.1 image. The database was never restarted and no data changed.
  Lesson recorded: do not build a release image on the machine serving production.

## Deployed baseline — **v2.4.1 DEPLOYED to production (2026-08-04)**

**Verdict: DEPLOYED — HEALTHY.** Full record: **`docs/DEPLOYMENT_V2_4_1.md`**.

- **Production baseline is now v2.4.1**, tag `v2.4.1` (annotated, on `6d7dacf`), image
  `madrasa-app:0.1.0` = `sha256:4b427c8e16d8…`, ledger **31**, tables **88**, host binding
  unchanged at `0.0.0.0:3080` under compose project `madrasa-prod`.
- **Migrations 0029 + 0030** applied through the migrate-only `init` service. Both purely
  additive: 2 new empty tables, 4 nullable columns that are 100 % NULL. The **database
  container was never restarted** (same id, `StartedAt`, `Pid`, `RestartCount 0`,
  `pg_postmaster_start_time` unchanged).
- **Nothing else in the database changed.** A 183-line probe (86 counts + 86 fingerprints +
  9 anchors) run before and after differed only by the ledger, the two new tables and the
  `maintenance_issues` row literal; the `mi_pre0030` anchor proves no existing report row was
  touched. Across the whole deployment only `audit_log` (540 → 550) and `sessions` (56 → 60)
  moved — the smoke test's own logins and exports. **No business record was created, updated
  or deleted.**
- **Interruption ≈ 1.4 s** (17 samples at ~0.29 s, 2 DOWN). App-only recreate.
- **Backups.** Pre-deploy `20260804-143255` (db + uploads + redacted config, AES-256-CBC /
  PBKDF2 200k) — restore-verified byte-identical to production, uploads digest matched
  (89 files). Gold `20260804-gold` — restore-verified byte-identical at ledger 31.
- **Rollback image** `madrasa-app:0.1.0-prev-v2_4_1-20260804` (= v2.4.0), boot-proven against
  the restored backup. **App-only; no database action.** Not exercised — no trigger occurred.
- **Smoke: 26/26 PASS.** Read-only on production as `admin`; the mutating and principal-only
  checks (both performance reports, permanent deletion, inspection → separate reports,
  program editing in all six states) ran **53/53 PASS** on a disposable clone of the
  post-deployment data using the deployed image, then destroyed. Container log holds exactly
  3 error lines, all the D-013 denials the smoke triggered on purpose.
- **Still the principal's to supply** (the platform invents nothing): the 2 missing budget
  allocations, the 4 contradictory program states, the 31 NULL committee task statuses, and
  tasks for the 2 empty committees.
- Next: the principal's `/pilot` retest is the acceptance channel.

### Pre-deployment record — v2.4.1 final consolidated scope

- The v2.4.1 branch carries the data-correction
  release **plus** the principal's final confirmed requirements. Full record:
  **`docs/DELIVERY_V2_4_1.md` §17**; decisions **D-050 · D-051 · D-052**; deletion procedure
  and recovery: **`docs/DELETION_RUNBOOK.md`**.
- **What the final scope added.**
  - **Permanent lifecycle deletion** (`lib/lifecycle-delete.ts`): «حذف الموظف نهائياً» and
    «حذف دورة الأداء». Owned lifecycle erased; every shared institutional record survives
    with its link nulled. Built from the real FK graph — the linked login account is
    deactivated and unlinked, never deleted, because `audit_log.actor_id` and a dozen
    `NO ACTION` keys point at it. Requires `performance.individual.read` as well, so
    `sysadmin` (denied it by D-013) cannot destroy what they may not read.
  - **Program editing in every lifecycle state** (`lib/plan/program-edit.ts`): state warns,
    never blocks; reason mandatory past draft; field-level history; approval and lifecycle
    never changed implicitly. `plan.override` guards removed — that permission was never
    granted to any role, so they were absolute blocks.
  - **Inspection under maintenance** (`/building/maintenance/inspect`): «إجراء فحص» in the
    maintenance area, explicit result count, four post-save paths, **one separate report per
    finding**, per-finding duplicate prevention, richer formal report + signature block.
  - Budget top summary gains a spending-percentage card and explains why remaining cannot be
    computed instead of showing a misleading zero; expense reports gain balance-before.
    School-wide performance report restructured into the four required sections; labels
    adopt the principal's wording.
- **Two defects found by the new gates and fixed before the RC — both would have shipped:**
  1. *Every* program edit would have been rejected as stale — the concurrency guard compared
     a millisecond JS `Date` against a microsecond `timestamptz`. Caught by the state-matrix
     integration test; typecheck, lint and review all passed it.
  2. A rejected save silently erased everything typed. React 19 resets an uncontrolled form
     after its action completes **including on error**, so the first save without a reason
     wiped all 25 fields and the second reported «لا تغييرات لحفظها». Visible only in a real
     browser; fixed with controlled inputs, asserted in the browser scenario.
  A third was closed in the security review: `actionableFindings` was exported from a
  `"use server"` module, making it a public endpoint with no permission check.
- **Migrations 0029 + 0030 — ledger 29 → 31, both purely additive** (2 new tables, 4 nullable
  columns). No row written, deleted or rewritten. Rollback to v2.4.0 still needs no DB action.
- **Production-clone rehearsal 53/53 PASS** on a clone byte-identical to production
  (18 anchors incl. 4 whole-table fingerprints). Migration applied through the same
  migrate-only init production uses: ledger 29→31, tables 86→88, every anchor still
  identical, the four new columns 100% NULL on all production-copied reports. All
  destructive steps ran only on records the harness seeded; people count returned to 54 and
  the committee fingerprint was unchanged. Harness:
  `scripts/v241-final-clone-setup.sh` + `scripts/v241-final-clone-rehearsal.mjs`.
- **The rehearsal found two more D-049 recurrences — both fixed and re-verified**: inspection
  actions invalidated `/building/maintenance`, the ancestor segment of the new inspect page
  (findings were created, the result panel never appeared); and the maintenance page's
  approve-and-issue invalidated its own route (letter issued, links never appeared). Fixed by
  revalidating nothing + client refresh, and by an explicit redirect. **Both passed 909
  vitest and 101 Playwright scenarios on `next dev` first** — the rehearsal-on-the-real-image
  rule is now proven twice.
- **Rollback rehearsal PASS**: v2.4.0 booted against the clone *after* v2.4.1 wrote to it —
  health ok, all sections render, v2.4.1-created records visible, ledger stays 31, only
  `audit_log +1` (the login). **Rollback is app-only, no DB action.**
- RTL/visual **64/64** at four widths on the RC against production data; page timings 673–986 ms
  including the person page with its deletion impact preview (900 ms).
- **Production untouched**: RestartCount 0 both containers, ledger 29/86, `audit_log` 540, all
  18 anchors identical to the session start. The clone, its volumes and network were destroyed.
- RC image **`madrasa-app:0.1.0-v2_4_1-rc`** built from `6d7dacf` (Chromium-1228, no
  `src/lib/ai`, 31 migration files) — digest recorded in `docs/DELIVERY_V2_4_1.md` §17.16.
- Gates: typecheck 0 · lint 0 · **vitest 909/909 (94 files)** · build ✓ · `drizzle-kit check`
  clean · Playwright incl. 9 new principal-role scenarios.
- **Still waiting on the principal (unchanged — the system must not invent these):**
  allocations for المستلزمات and النشاط; the correct operational state for اليوم الوطني,
  متابعة الأداء المبنية على البيانات, التطوير المهني بالأثر and رياضيات الإتقان; the actual
  status of the 31 committee tasks; and the missing tasks for اللجنة الإدارية للمدرسة and
  لجنة التوجيه والإرشاد.

## Previous checkpoint — **v2.4.1 READY FOR DEPLOYMENT (2026-08-03)** — NOT deployed

- **Production is still on v2.4.0.** v2.4.1 is a data-correction release: it gives the
  principal a visible, audited workflow for the three production DATA preconditions the v2.4
  investigation identified, and fabricates no value on their behalf. Full record:
  **`docs/DELIVERY_V2_4_1.md`**.
  - Branch `scope-v2.4.1-data-correction`, head **`a8e1cf3`** (base `c5d13f8` = v2.4.0).
  - RC image **`madrasa-app:0.1.0-v2_4_1-rc`** =
    `sha256:b2f9b613fd07cd55dd7d4db05d0462ada26a6faec095009fead15be40698f1ce`
    (`RELEASE_COMMIT=a8e1cf3`, chromium-1228, no `src/lib/ai`, 29 migration files).
  - **No migration.** Ledger stays **29**, tables **86** — verified unchanged on the clone
    before and after the rehearsal. Rollback is app-only, **no DB action** (rehearsed).
  - Gates: typecheck 0 · lint 0 · **vitest 806/806** · **Playwright 92 passed / 1 standing
    skip (C5, D-018) / 0 failed** · build ✓ · `drizzle-kit check` clean.
  - **Production-clone rehearsal 42/42 PASS** on a byte-identical clone of production data
    (26 anchors + 5 content fingerprints matched). Production containers never touched —
    RestartCount 0, `audit_log` still 540, D-022 fingerprint
    `ff753b94d10cc9ab16d35b56641c5fbc` unchanged.
  - Extra validation harnesses: `scripts/v241-clone-rehearsal.mjs` (42 checks),
    `scripts/v241-visual-audit.mjs` (52/52 at four widths),
    `scripts/v241-pdf-audit.ts` (15/15 PDFs/CSV/DOCX).
- **D-049 — the reason this phase mattered.** The clone rehearsal found that
  `revalidatePath()` for the route the user is currently on cancels the still-streaming
  Server-Action response, so a save commits but the screen never updates. It reproduces on
  the **deployed v2.4.0 image** too — it is the long-standing «الواجهة لا تتحدث بعد الحفظ»
  complaint from v2.2.1, and what v2.3 filed as an environment quirk. `next dev` completes
  the stream before the refetch lands, which is why 92 green e2e tests never saw it. Fixed
  for the surfaces this release touches; a full sweep is follow-up work. **Any future release
  touching Server Actions must be rehearsed on the production image against cloned production
  data, not on the dev server.**
- **D-048 (High, fixed):** the reports centre exposed a named employee's evaluation result
  under `performance.read`, which `sysadmin` holds while D-013 denies them
  `performance.individual.read`. Raised to the individual permission; a unit test now fails
  any report pairing a named person with a result column.
- **Waiting on the principal (the system must not invent these):** allocations for
  المستلزمات and النشاط; the correct operational state for اليوم الوطني, متابعة الأداء
  المبنية على البيانات, التطوير المهني بالأثر and رياضيات الإتقان; the actual status of the
  31 committee tasks; and the missing tasks for اللجنة الإدارية للمدرسة and
  لجنة التوجيه والإرشاد.
- **Not done, by convention:** the annotated tag `v2.4.1` (created at deployment, as in
  v2.2/v2.3), the gold backup, and the host-PC migration.

## Previous checkpoint — **v2.4.0 DEPLOYED TO PRODUCTION (2026-08-03)** — current production baseline

- **Authorized production promotion executed 2026-08-03.** v2.4.0 replaced v2.3.0 in the
  existing production environment (same URL, host port `3080`, database, uploads, secrets
  and compose project `madrasa-prod`). Release tag **`v2.4.0`** at commit `da8db16`.
  Full record: **`docs/DEPLOYMENT_V2_4.md`**.
  - Image `madrasa-app:0.1.0` = `madrasa-app:v2.4.0` =
    `sha256:2f69c724c625f60a39c9d8f8e109c97407ff70f23441386498a5e36872556c5b`.
  - Rollback image **`madrasa-app:0.1.0-prev-v2_4-20260803`** = `7f5ff14a…` (v2.3 rc2),
    boot-verified against the restored pre-deploy backup. Rollback needs **no DB action**.
  - Migration ledger **27 → 29** (0027, 0028). All 86 table counts, all 84 untouched
    row-hash fingerprints and all 6 historical anchors byte-identical; the 4 new columns
    are 100 % NULL. **The database container was never restarted** (pid 707, postmaster
    start `2026-07-29 15:01:06+00`, RestartCount 0 throughout).
  - Observed interruption ≈ **0.2 s** (single failed sample at 0.2 s polling).
  - Encrypted pre-deploy backup `backups/predeploy/*-20260803-065900*` (DB + uploads +
    redacted config + manifest + checksums), restore-verified byte-identical to live
    production in an isolated Docker network. Post-deploy **gold backup**
    `backups/gold/*-20260803-gold*`, also restore-verified byte-identical.
  - Production smoke: all 24 required checks satisfied (§5 of `docs/DEPLOYMENT_V2_4.md`);
    0 console errors, 0 page errors, 0 unexpected container errors.
- **Round-6 post-acceptance corrective release** on branch `scope-v2.4-post-acceptance`
  (base `b47558c` = previously deployed v2.3.0). Brief `docs/BRIEF_V2_4_0.md` (source package
  `fathers-app-review-2026-08-01.zip` verified byte-identical to HEAD before work);
  change map + root causes `docs/SCOPE_IMPACT_V2_4.md`; decisions **D-041…D-045**;
  full delivery report **`docs/DELIVERY_V2_4.md`** (verdict: READY → DEPLOYED).
- **P0 fixes:** budget remaining everywhere + per-expense «المتبقي قبل/بعد» + halala-exact
  math (D-043) + snapshot-before-hard-delete; weekly follow-up made truthful (D-042 —
  week-snapshot page/report, «لم يتم التحديث هذا الأسبوع», createdAt no longer reset, empty
  progress no longer zeroes); sidebar sticky-scroll + retention + collapsible sections
  (root cause `lg:static` in min-h-dvh flex — no migration); eval-form archive/delete
  (D-041, migration **0027**).
- **P1:** homepage queue «بانتظار اعتماد المدير» (3 real-state tabs, inline audited approve);
  by-owner/by-domain program reports with NAMES (+ *-summary aggregates); program card
  access points + enriched report; committee task status (migration **0028**) +
  «سجل المجالس واللجان التفصيلي» (docType committee_registry, member-per-row) + un-merged
  registry reports; employee/school detailed performance documents (docTypes
  employee_performance_report / overall_performance_report) + cycle selector page;
  inspection→maintenance offer/dedup/bidirectional links + completed «بلاغ صيانة» letter
  + one-step «اعتماد البلاغ وإصدار التقرير» (D-045).
- **P2:** page numbers on every PDF; Word identity via getWordHeader in all docx routes +
  IBM Plex font; /documents labels from central registry. **Security hardening (D-044):**
  performance PDFs now require `performance.individual.read` to download and are hidden
  from /documents without it (closed a pre-existing session-report gap).
- **Gates:** typecheck 0 · lint 0 · **vitest 738** · build ✓ · **Playwright 76/1skip/0fail**
  (e2e drift fixed spec-side for renamed report button, regrouping follow-up rows, exact
  «اعتماد البلاغ»; two real UI gaps found by e2e fixed app-side: silent delete success →
  redirect, duplicated restore button). `/pilot` rewritten to **21 v2.4 tasks** (draft key v3).
- **Clone rehearsal PASS (2026-08-02):** read-only prod dump (ledger 27/86 tables,
  anchors D-022 `4572c570…` + issued-docs `f34e3f0f…` matched) → migrations applied twice:
  **only diff ledger 27→29**, all 30 counts + 7 fingerprints byte-identical, new columns
  100% NULL, idempotent. **RC image `madrasa-app:0.1.0-v2_4-rc` = `2f69c724c625…`**:
  migrate-only init 29/86 on fresh DB, AI absent, Chromium **-1228** (PDF probe
  `PDF-OK %PDF-`), sharp/postcss overrides, boots on the migrated clone (health ok/db-up,
  login 200, gate 307). Clone + disposable DBs dropped, dump deleted.
- **Rollback:** additive-nullable migrations — v2.3 image runs unchanged on ledger 29;
  app-only retag, **no DB action** (procedure in DELIVERY_V2_4 §9).
- **STOPPED:** deployment, release tag, gold backup, host-PC migration all await explicit
  owner authorization + principal acceptance (encrypted pre-deploy backup + restore
  verification happens at deploy time inside the prod network, as v2.2/v2.3).

## Earlier checkpoint — v2.3.0 DEPLOYED to production (Mac mini) 2026-07-31 — READY FOR PRINCIPAL ACCEPTANCE TESTING

- **DEPLOYED under explicit owner authorization.** Full record: `docs/DEPLOYMENT_V2_3.md` §7.
  Running image **`madrasa-app:0.1.0` = `0.1.0-v2_3-rc2` = `sha256:7f5ff14a54f0…`** (digest
  verified on the container). Migration **23 → 27**, tables 83 → 86. **db container never
  restarted** (StartedAt 2026-07-29T15:01:06Z, RestartCount 0 throughout).
- **Backup `20260731-112756`** (db+storage+SHA256SUMS, encrypted inside the prod network,
  passphrase never echoed): checksums OK, 547 pg objects / 166 tar entries, **test-restored**
  into an isolated DB where the full 35-line baseline (23 counts + 12 fingerprints) was
  **byte-identical to live production**. Rollback image `0.1.0-prev-v2_3-20260731` (= ab259dd8).
- **Data preserved:** post-migration diff was exactly {ledger 23→27, tables 83→86,
  fp_maintenance changed by the documented D-036 mapping} and NOTHING else — D-022
  `4572c570…` and issued-docs `f34e3f0f…` unchanged; income/expense sums 7601/4699 unchanged.
  D-036 exact (معتمد:3/مغلق:2 + history rows), D-037 24 room types, D-034 labels, new columns
  100% NULL. Live-data note: plan_budget_items was 2 at deploy time (4 in the §2 rehearsal —
  user deletion in the interim; verified against the day-of baseline).
- **Incident found in smoke and fixed forward:** PDF export 500 — unpinned `npx playwright@1`
  in Dockerfile.production downloaded browser build -1234 while locked playwright 1.61.1
  expects -1228. Fixed by installing browsers from the app's own node_modules; rebuilt as
  rc2 (`7f5ff14a…`), in-container `PDF-OK %PDF` proof, broken first RC tag deleted
  (digest 877f2343… recorded in docs). App-only swap; no DB action.
- **Authenticated read-only smoke (real admin login, no bypass, no business writes):**
  8 module pages render, `/pilot` shows the **21 v2.3.0 retest tasks**, D-036 badges in
  «بلاغات الصيانة», «إرسال ملاحظة» in the header, **PDF 200 %PDF 44,541B / DOCX 200 / CSV
  200**, 0 console errors. Performance pages = D-013 sysadmin exclusion → principal via /pilot.
- **STOPPED:** no release tag, no gold backup, no host-PC migration until principal
  acceptance. Rollback = retag prev image, app-only restart (functional on ledger 27;
  cosmetically degraded on the mapped D-036 statuses).

## Earlier checkpoint — v2.3.0 PHASES A–E IMPLEMENTED, ALL AUTOMATED GATES GREEN (2026-07-31) — packaging/deployment prep remaining
- **Brief:** principal's 5th round, recorded verbatim in `docs/BRIEF_V2_3_0.md`; Phase A inventory +
  gap analysis in `docs/SCOPE_IMPACT_V2_3.md`; decisions **D-032…D-040**. Branch from `6ce990b`
  (deployed v2.2.1, production at migration 23). **Production untouched.**
- **B1 dates (D-033, `25d2c1d`):** dual-calendar `DateField` (هجري أم القرى/ميلادي selector, Hijri
  entry by day/month-name/year selects, one canonical Gregorian ISO value, dual line under field,
  browser-remembered mode) wired through `Field type="date"` → all pickers upgraded at one point;
  `lib/dates` gains Intl-probed inverse conversion + validation (16 unit tests incl. two full Hijri
  years round-trip); `optionalIsoDate` zod across budget/evidence/tasks/performance/committees;
  report date columns render dual on screen + CSV/XLSX.
- **B2 uploads (D-032, `1148975`):** `stored_files` acceptance columns (migration **0023**);
  `saveUploadedFile` decides from the uploader's DB role — principal auto-accepted («قبول تلقائي
  بواسطة المدير»), others «قيد الاعتماد» pending manual «اعتماد يدوي بواسطة المدير»; scope
  `reports` exempt; `CurrentUser.roleKeys`; principal queue on /evidence; 6 integration tests.
- **B3 finance (`7632ab8`):** migration **0024** (income invoice number + updated_by both tables);
  update actions with `record_versions` snapshot + قبل/بعد audit detail; `/budget/items/[id]`
  drill-down (running-balance ledger, user attribution, edit/delete inline); clickable per-item
  cards with «آخر عملية»; calc gains lastOperation/ledger/top-spenders/near-exhaustion lists.
- **B4+B5 building (D-036/D-037, `61d4457`):** migration **0025** — `room_types` registry (24
  system types + aliases; «مختبر علوم» now matches «معمل» rooms), `inspection_findings` (severity
  from frozen snapshot, حرج ⇒ critical, target date/responsibility/close/one-click complaint),
  maintenance lifecycle columns + append-only `maintenance_status_history` + documented legacy
  status mapping (rehearse on clone!); `recordInspection()` unifies online+offline (fixes the
  offline missing-snapshot hole); transparent readiness rewrite (لم يبدأ/جاهز/يحتاج معالجة/غير
  جاهز + per-item why); transition machine مسودة→معتمد→تم الإرسال→تحت المعالجة→نتيجة→مغلق with
  «لم يتم الإصلاح» closure requirements; `/building/maintenance/[id]` detail page.
- **C (`31dba1d`, `9332dec`, `ce0945c`):** identity centralized (principalName/Title + logos via
  admin UI — «حسين» nowhere in code) and wired into ALL 7 generators + Word; `/api/reports/export`
  gains **pdf|docx** for all 54 registry reports (filters shown, page numbers, thead repeat, §7
  filename); rules-based KPI analytics (`lib/performance/analytics`, threshold setting, min-sample
  guard) + `/performance/analytics` + `/performance/employees/[personId]`; template registry
  **14→29 doc types** (generator docTypes reconciled); `generateProgramCard` (§20, offline QR) +
  `generateMaintenanceLetter` (§18, refuses drafts, linked via documentId).
- **D (`a3827b7`):** «اعتماد وإقفال»→«اعتماد» everywhere incl. derived labels (D-034; migration
  **0026** updates the two permissions.name_ar rows; history NOT rewritten); sketch 40dvh/50dvh +
  ⤢ expand (viewBox math untouched); collapsible persistent `<Tutorial>` on 6 module pages with
  current-workflow steps; «إرسال ملاحظة» moved into the sticky header; dashboard monitoring cards
  (programs by lifecycle + delayed via Hijri conversion, complaints, findings, readiness %, cash/
  remaining/warnings, pending files, incomplete evaluations per D-013) + 14-day upcoming list;
  facilities renamed «المرافق المطلوب توفيرها أو تحسينها» (D-038).
- **E (`d952f07`, D-035):** AI runtime fully deleted (~3,100 lines — lib/ai, api/ai, assistant
  pages/components, AI settings, health checks incl. pilot-status per-render probe); env/compose/
  playwright config cleaned; `ai_*` tables kept dormant; SWOT import preserved (verified AI-free);
  dead perf functions removed; production build passes with zero AI references.
- **Gates at E end:** typecheck 0 · lint 0 · **vitest 682** · production build ✓. Migrations
  0023–0026 applied to `madrasa_test` ONLY — **production remains at ledger 23 (file 0022)**;
  4 pending prod migrations, all additive except documented D-034 label UPDATEs + D-036 status
  mapping (both rehearse-and-verify on clone first).
- **F: clone rehearsal 23→27 PASS** (`31a741c`, `docs/DEPLOYMENT_V2_3.md` §2): all counts +
  D-022 `4572c570…` + issued-docs `f34e3f0f…` byte-identical, D-036 mapping exact
  (معتمد:3/مغلق:2 + one history row each), D-037 24 room types, D-034 both labels, new columns
  100% NULL, idempotent, app boots on the migrated clone; clone dropped, dump deleted.
- **F: full Playwright GREEN — 72 passed / 1 skipped (C5 D-018) / 0 failed, 3.8 min** (§4 of
  the deployment doc). Drift was spec-side only: 4 date selectors → `#<name>-input`
  (dual-calendar DateField), س5 rewritten to the real B5 maintenance lifecycle
  (مسودة→اعتماد→إرسال→معالجة→تسجيل الإصلاح→إغلاق on `/building/maintenance/[id]`), ج8 asserts
  «مغلق»+«تم الإصلاح», nav «بلاغات الصيانة», and س6 (assistant) deleted per D-035.
  **Environmental finding documented in §4:** external `next start` on the macOS host aborts
  Server-Action response streams (RSC stream never completes → useActionState stuck pending);
  reproduced identically on the v2.2.1 baseline in an isolated worktree ⇒ NOT a v2.3
  regression; `next dev` runner and the production Docker container are both unaffected. The
  e2e gate stays on the standard dev webServer as in every prior release.
- **REMAINING (Phase F):** §27 delivery-evidence report + principal retest checklist (`/pilot`
  update), build & verify `madrasa-app:0.1.0-v2_3-rc` image + tag rollback image, fresh
  encrypted pre-deploy backup + restore verification (prod network), controlled Mac mini
  deployment (migrate-only init; db container never restarted) — **deployment awaits explicit
  authorization**. No release tag, no gold backup, no host-PC migration until principal
  acceptance.

## Earlier checkpoint — CORRECTIVE PATCH v2.2.1 DEPLOYED to production 2026-07-30 — CONDITIONALLY READY
- **DEPLOYED.** Commits `e88add8` + `936c7c0` (+ docs `f946de8`), image `madrasa-app:0.1.0-v2_2_1-rc`
  `sha256:ab259dd83a3a…` (digest verified on the running container). Migration **22 → 23**, tables
  still 83. ~4 s app stop→start; **db container never restarted** (StartedAt 2026-07-29T15:01:06Z,
  RestartCount 0). Full report: `docs/DEPLOYMENT_REPORT_V2_2_1.md`.
- **Migration identity resolved:** `0022_steep_joystick.sql` is the 23rd file (drizzle names 0-based,
  the ledger counts 1-based). No file overwritten (`git log --diff-filter=M -- drizzle/*.sql` = 0),
  23 unique files / 23 unique journal entries, exactly one migration applied. Content = 3 nullable
  `ADD COLUMN` (`programs.completion_note`, `program_closure_history.from_status`/`to_status`); 0 hits
  for drop/truncate/delete/rename/insert/seed.
- **Seed proof:** resolved compose has 0 seed/bootstrap/reset hits, `seed` service absent from the
  resolved config (profile-gated), init command literally `sh -c "npx tsx src/db/migrate.ts"`,
  migration log one line, roles 2 / perms 59 / users 2 unchanged, new columns 100% NULL.
- **Backup `20260730-090911`** (db + storage + SHA256SUMS + RECOVERY-MANIFEST): checksums OK,
  decrypts to exact byte sizes, `pg_restore --list` 547 objects, tar 160 entries, **test-restored**
  into an isolated DB where all 30 counts and all 8 fingerprints matched production exactly.
  Passphrase never echoed/logged/argv'd; resolved compose config deleted after inspection.
- **Data preserved:** every historical count unchanged; D-022 `4572c57060e20c4b0de4db52545a8e3f`,
  docs `a4a8b924c7fcbf34273cfc14c6aa6aef`, per-snapshot `33|a3ca8492…`, perf `6b1bb98c…`, ratings
  `b6f4a99e…`, storage `80|72db544f…`, rooms `8|890cb6c4…`, geometry `10|119e7b88…` — ALL MATCH.
  Programs/history fingerprints **excluding the temp test record** = exact pre-patch baselines
  (`428723ee…`, `707cf603…`) → no pre-existing record changed. Finance 5101/3699 unchanged.
- **Smoke (real `admin` account, no bypass):** sketch 23/23 (+ / − / fit / reset / limits / wheel /
  pan / bounds / floor switch / room nav / pointer-leak / 0 non-GET / 0 console errors; mobile
  390×844 incl. touch drag). Lifecycle 30/30 on temp program `71fce774-…`: قيد التنفيذ → مكتمل →
  مغلق (read-only) → مكتمل → قيد التنفيذ, no-evidence/empty-note closure, 3 duplicate stale submits
  → **0** extra history rows, legacy pre-patch closed program verified **read-only and untouched**,
  3-state filters + completed/closed/transition reports OK.
- **Cleanup:** temp program archived by **exact captured ID** (guards: ID in URL + marker in title);
  hidden from /plan and the active/completed/closed reports; its append-only history retained and
  documented. Evidence 30/30 and files 80 untouched (no repeat of the v2.2 evidence-archiving error).
- **CONDITIONALLY READY — 3 pre-existing (not regression) issues:** (1) **UI does not refresh after
  a Server Action** — data saves correctly but the screen needs a manual refresh; reproduced on the
  untouched pre-existing `updateProgramExecutionAction` (POST 200, `progress=42` in SQL, card still
  showed 0٪). Codebase already documents this in `evidence-panel.tsx:51-57` and fixes it there with
  `router.refresh()`; the 4 lifecycle forms need the same ~4-line follow-up (NOT applied — outside
  approved scope). (2) `programs-closed`/`programs-reopened` report modes don't exclude archived
  records → the archived temp program still shows in «البرامج المعاد فتحها». (3) **Ollama is
  LAN-reachable** (`0.0.0.0:11434` via the `com.fahad.ollama-serve` LaunchAgent — the 07-29 reboot
  undid the session-scoped Stage-1 fix); raised before deploying, **owner chose to defer**.
- **STOPPED:** no release tag, no gold backup, rollback images retained
  (`madrasa-app:0.1.0-prev-v2_2_1-20260730` = `b13382d15423`), no host-PC migration, not marked
  finally accepted. Rollback = retag the prev image only (migration 0022 is nullable-additive, so
  the old image runs fine on ledger 23; no DB action).

## Earlier checkpoint — CORRECTIVE PATCH v2.2.1 READY, NOT DEPLOYED (2026-07-30)
- **Two post-deployment issues fixed on the branch; production untouched.** RC head `936c7c0`
  (`e88add8` sketch + `936c7c0` workflow). Full report: `docs/CORRECTIVE_PATCH_V2_2_1.md`.
- **Issue 1 — /building sketch controls** were broken by 6 compounding defects (MIN_SCALE=1
  made −/⟲ no-ops; CSS transform mixed px into viewBox units; `pinch-zoom` touch-action gave
  pinch to the browser; no wheel handler; no fit-to-view; controls under the sticky header +
  pointer-map leak killing room taps). Rewritten as viewBox-based math in
  `src/lib/building/viewer-view.ts` (scale 0.5–8, window clamped, zoom-at-point, fit) with 4
  labeled controls at the bottom corner, wheel + pinch, per-floor view reset.
- **Issue 2 — three-state program workflow** قيد التنفيذ ← «تعليم البرنامج كمكتمل» ← مكتمل ←
  «إقفال البرنامج نهائياً» ← مغلق, with «إعادة فتح» (→ مكتمل, never straight to تنفيذ) and
  «إعادة للتنفيذ». State derived only from completedAt/closedAt — no evidence/percentage/
  mandatory-field gates (D-024/D-025). Close now REQUIRES completion first. Closed = read-only
  server-side (execution/followup/change-request/evidence-write refused; registry locks
  evidence unlink) while view/report/print/export stay. Legacy-closed programs (production has
  3, completedAt NULL) reopen via COALESCE backfill from their closure moment — rehearsed on a
  real one. History table now records from/to; actions اكتمال/إقفال/إعادة فتح/إعادة للتنفيذ;
  append-only preserved. UI: «حالة البرنامج» card + completed banner + 3-state filter on
  /plan + «البرامج المكتملة» report + from/to in the transitions report.
- **Migration 0022 (`0022_steep_joystick.sql`) is 3 nullable ADD COLUMNs, nothing else** —
  old image runs fine on the migrated schema, so rollback = retag app image only.
- **Gates:** tsc 0 · eslint 0/0 · build ✓ · **vitest 644** (+34) · **Playwright 76 pass /
  1 skip** (C5) incl. new building-viewer + program-lifecycle specs.
- **Clone rehearsal PASS:** fresh prod pg_dump → `madrasa_patch_clone_test` → migrate 22→23:
  all counts + 4 fingerprints byte-identical (legacy fp `4572c570…` ✓), new columns 100% NULL;
  real app on :3082 with clone-only login ran the full workflow incl. reopening a REAL
  legacy-closed program (completed_at backfilled to exactly its old closed_at) — 23/23 checks.
  Clone dropped, dumps deleted.
- **STOPPED before production.** Patch plan + rollback in the report doc (§7–8): build
  `0.1.0-v2_2_1-rc`, tag rollback image, fresh backup, migrate-only init, ~60–90s downtime,
  db container never restarted. Awaiting explicit go-ahead.

## Earlier checkpoint — v2.2 DEPLOYED to production (Mac mini) 2026-07-29 — CONDITIONALLY READY
- **DEPLOYED.** RC `548a3c9` (code frozen `80a1b9c`), image `madrasa-app:0.1.0-v2_2-rc`
  `sha256:b13382d15423…` (digest verified before start AND on the running container). Migration
  **18 → 22**, tables 78 → 83. Full report `docs/DEPLOYMENT_REPORT_V2_2.md`.
- **NOT rebuilt:** the approved image was retagged to `madrasa-app:0.1.0` AFTER tagging the rollback
  image — rebuilding would have changed the approved digest. `init` therefore ran the new image
  (it had to: migrations 0019-0022 exist only there).
- **Seed proof (6 ways):** resolved compose config has 0 hits for seed.ts/bootstrap/reset/truncate/
  drop/reseed; the `seed` service isn't even in the resolved config (profile-gated); init command is
  literally `sh -c 'npx tsx src/db/migrate.ts'`; migration output was one line; reference tables
  unchanged (roles 2, perms 59, school 1, calendar 16, models 10); all 5 new tables EMPTY and all new
  columns 100% NULL.
- **Data preserved:** every historical count identical. Fingerprints ALL unchanged — D-022
  `4572c57060e20c4b0de4db52545a8e3f`, issued-docs `c9383e4b0fea0f460560effedeaff7bd`, per-snapshot
  `31|3c5c339204c4eca630894eaec850365a`, perf results `2a23344f21effe96820150692dd23d8a`, storage
  digest `6a24925358…`. Finance back at baseline 5000/2700/2300 after cleanup.
- **Backup:** fresh `backups/predeploy/*-20260729-135708` (db+storage+SHA256SUMS+RECOVERY-MANIFEST).
  Verified: checksums OK, decrypts, `pg_restore --list` 502 objects, tar 73 files, **test-restored**
  (78 tables, ledger 18, 54/26/129/129/15/9/31/72/339) with both fingerprints matching.
- **Infra unchanged:** app `0.0.0.0:3080`; **pg unpublished**; **Ollama 127.0.0.1:11434, LAN refused**;
  **db container NEVER restarted** (StartedAt 2026-07-26T09:36:52Z, RestartCount 0). App log clean.
- **Smoke test with the `admin` (sysadmin) account** — real login, no backdoor. PASS: auth/nav,
  programs (create/close-without-evidence/reopen/archive), finance (school-level income+expense,
  per-item math `10|100|999|-989|تجاوز`, overrun warning does NOT block, **receipt on an
  already-saved record = H5 regression**), reports (8 section links + 5 reports + filters + print +
  CSV/Excel), **templates (section+column reorder/hide/rename/width, sample preview, ACTUAL-RECORD
  preview with the «معاينة فقط» banner, version comparison read-only, publish, PDF 83KB, Word 9KB)**,
  committees/meetings/building.
- **NOT TESTABLE by me: performance cycle/session pages (F4b-e)** — sysadmin is excluded from
  individual performance data by **D-013**, so both pages 403 correctly. Handed to the principal.
  (I first reported these as PASS; that was wrong — I was asserting against the 403 error page.)
- **Cleanup:** all temporary records archived. **Mistake made and fixed:** I also archived ONE
  pre-existing evidence item (`e2862d41`, created 07-27) by selecting on recency; caught it (active
  25→24), identified it by date and **restored it** via «استعادة الشاهد». Active evidence back to 25;
  soft-delete never touches links so nothing was lost. **Kept on purpose:** the two standard financial
  items المستلزمات/النشاط (required by §6C to render the cards).
- **SWOT: PREVIEW VERIFIED, NOT COMMITTED.** Batch `0fa04c75-53aa-49ea-a7b2-e2dcbd13e198`, type
  `plan_swot`, status «معاينة», 24 rows all «جاهز», row types = **swot only**, breakdown
  **6 قوة / 7 ضعف / 5 فرصة / 6 تهديد**. `plan_swot_items` still 0; programs/KPIs/risks untouched.
  Principal commits or cancels.
- **STOPPED:** no release tag, no rollback image deleted, no gold backup, no host-PC migration, not
  marked finally accepted. LAN IP is `192.168.0.48`; TRUSTED_ORIGINS still says .171 (dead config,
  not a fault).

## Earlier checkpoint — v2.2 OPERATIONAL PREPARATION (Stages 1-3) — READY FOR CONTROLLED DEPLOYMENT (2026-07-29)
- **RC head `80a1b9c`**; plan `docs/DEPLOYMENT_PLAN_V2_2.md`. **App NOT deployed** — production still
  migration 18, 78 tables, 26/15/9/31, containers Up 46h/2d, 0 audit rows.
- **STAGE 1 — Ollama corrected (the only production-host change).** Root cause was
  `launchctl setenv OLLAMA_HOST 0.0.0.0:11434` (session-global), inherited by a hand-started
  `ollama serve` on ttys002. Fixed BOTH source and process: `launchctl setenv OLLAMA_HOST
  127.0.0.1:11434` + kill 53007 + restart detached. Now `127.0.0.1:11434` only (PID 7095).
  **Verified:** loopback serves models AND a real `/api/embed` call; LAN `.48:11434` refused from a
  container (separate netns), from the host, from the app container, and Tailscale `.63` refused;
  app health ok + auth gate ok; **containers NOT restarted** (StartedAt/RestartCount identical);
  pg unpublished; 0 audit rows. **No functional loss:** AI_ENABLED=false, and the app container can
  still reach Ollama via `host.docker.internal` (Docker Desktop proxies from the host stack →
  loopback). Open WebUI (native host process) still 200. Rollback documented. NOTE: `launchctl
  setenv` is session-scoped — after a reboot Ollama defaults to loopback anyway; a LaunchAgent would
  make it a guarantee (recommended, not applied).
- **STAGE 2 — full-workbook re-import PROVED UNUSABLE, controlled path built.** On a fresh clone at
  migration 22 the full workbook commit **FAILS** on `programs_year_seq_unique`; transaction aborts,
  batch stays «معاينة», clone bit-for-bit unchanged (safe, but SWOT can never arrive that way).
  Built import type **`plan_swot`** (`parseSwotWorkbook` / `commitSwotRows` / `rollbackSwotBatch`,
  commit `80a1b9c`): reads one sheet, writes one table, refuses when no plan year exists, never
  overwrites official text, never re-attributes a pre-existing row to a later batch.
  **Rehearsal PASS:** preview 24 (6/7/5/6) row-types=swot only → commit 24; programs 26, KPIs 15,
  risks 9, deliverables 26, budget 2, roadmap 312, documents 31, doc fingerprint `c9383e4b…` all
  unchanged; 2nd import idempotent (same ids); manual edit survived a 3rd import; wrong workbook
  rejected at preview; rollback removed only its own 24. +4 integration +1 e2e tests.
- **Gates after Stage 2:** typecheck 0 · lint 0/0 · build ✓ · **vitest 610** · **Playwright 73 pass /
  1 skip**. Clone destroyed, dumps deleted.
- **STAGE 3 — plan only, nothing executed.** Target image pre-built and verified:
  `madrasa-app:0.1.0-v2_2-rc` (`sha256:b13382d15423…`), linux/arm64 with postcss 8.5.24 + sharp
  0.35.3 native binaries. Migration 18 → 22. seed.ts unreachable (proved 4 ways). 23-item
  authenticated smoke list. Baselines to compare: 26/129/129/54/31/15/9, D-022 fp
  `4572c57060e20c4b0de4db52545a8e3f`, docs fp `c9383e4b0fea0f460560effedeaff7bd`.
- **Live LAN IP is `192.168.0.48` again** (drifted .48→.171→.48). `TRUSTED_ORIGINS` still says .171 —
  dead config, NOT a fault (Next checks allowedOrigins only when Origin≠Host).
- **VERDICT: READY FOR CONTROLLED MAC MINI DEPLOYMENT.** No release tag, no gold backup, no
  production migration, no container restart, no workbook re-import, no host-PC migration.

## Earlier checkpoint — SCOPE v2.2 FINAL GAP CLOSURE — verdict CONDITIONALLY READY (2026-07-29)
- **Commit `ba72f73`** on `scope-v2.1-corrections`. Full report
  `docs/SCOPE_V2_2_FINAL_GAP_CLOSURE.md` (13 sections). **Production UNTOUCHED** — migration 18,
  78 tables, 26/129/129/54/31, doc fingerprint `c9383e4b…`, 0 audit rows in 24 h, containers not
  restarted. **NOT deployed, no release tag, no gold backup.**
- **All five disclosed gaps closed.** (1) **§E2 column/section editing UI** — closed registry
  `src/lib/templates/structure.ts` (9 sections, per-type columns); the renderer now honours
  order/visibility/heading/label/width in HTML **and** PDF **and** Word; RTL editor panels with
  ▲▼ reorder, show/hide, rename, width; new route `/api/templates/preview?format=pdf|docx`.
  (2) **§E5 version comparison** — pure `diff.ts` covering all twelve required aspects plus section
  headings and column widths; GET-driven, read-only (test asserts zero buttons in the diff table).
  (3) **§E4 actual-record preview** — `records.ts` with 13/14 doc types, per-type read permission,
  `load()` re-derives the eligible query so wrong-type / archived / non-existent ids are refused
  (IDOR); no document issued, no version created, record byte-identical, audit row says so; amber
  «معاينة فقط» banner; sample fallback for خطاب رسمي عام.
- **(4) Report coverage (D-030).** **SWOT is real**: the workbook production actually imported has a
  populated «التحليل الرباعي» sheet the importer never read — parsing the real file yields **24
  items (6/7/5/6)** alongside the same 26 programs / 15 KPIs / 9 risks production holds. New
  `plan_swot_items` (**migration 0021**, additive), importer support (unique `(year, code)`,
  `onConflictDoNothing`, never re-attributes an existing row to a later batch), `/plan/swot`, two
  reports, deep link, sidebar entry. **Meeting attendance = NOT APPLICABLE** — no attendance model
  by product decision, verified against the production schema (no attend/present/absent/quorum
  column exists); a guard test forbids an attendance-named report. Section↔report matrix rebuilt and
  **enforced by test** over every route; +7 reports (KPIs, follow-up, tasks, calendar, feedback,
  swot-register, swot-by-category) → **53 reports / 13 categories**.
- **(5) Dependency evidence.** Full **21** (16 high/5 mod/0 crit) · runtime-only **10** (9 high/1 mod)
  · dev-only **11 packages**. Those collapse to **3 root advisories**. Fixed via `overrides`:
  postcss 8.4.31→**8.5.24**, sharp 0.34.5→**0.35.3** (verified inside a freshly built prod image with
  linux-arm64 binaries) — runtime 13→10. Remaining: brace-expansion (high, transitive, **unreachable**
  — no glob pattern anywhere), uuid (moderate, exceljs uses v4 only), esbuild (dev-only, `--serve`
  never run) — each ACCEPTED with reason and refused-fix rationale. **Corrected two earlier claims:**
  "no direct advisory" ≠ clean, and dev deps **are** in the production image (`npm ci` without
  `--omit=dev`; `tsx` is genuinely needed by `init`).
- **Clean undisturbed cycle — ALL GREEN:** `rm -rf node_modules && npm ci` · typecheck 0 · lint 0/0 ·
  build ✓ · **vitest 606/606** (was 527) · **Playwright 72 pass / 1 skip** (skip = C5 D-018) ·
  clone migration rehearsal 18→22 with every count identical, D-022 + doc fingerprints MATCH, all 5
  new tables **empty** and all new columns 100% NULL (seed did not run), idempotent · restart
  rehearsal PASS on the new image · backup rehearsal PASS · restore rehearsal PASS **twice** (fresh
  backup + the held real 2026-07-27 predeploy artifact: checksums OK, 78 tables, ledger 17).
  All rehearsal artifacts destroyed; no real data written to the repo.
- **VERDICT: CONDITIONALLY READY.** No gap open, no gate failed, no code work left. Two conditions,
  neither of which I may perform: **(a) Ollama is NOT loopback-only** — still `*:11434`, reachable
  unauthenticated on the LAN, pre-existing (K.1), fix = `OLLAMA_HOST=127.0.0.1:11434` + restart
  Ollama only; **(b) the principal's Arabic acceptance pass**. Operational note: SWOT ships with an
  empty table in production until the principal re-imports the plan workbook (their manual action) —
  the section says so in Arabic rather than showing an unexplained empty screen.

## Earlier checkpoint — SCOPE v2.1 FINAL-DEMO CORRECTIONS (round 4) — DEPLOYED to production (2026-07-27)
- **Principal's 4th feedback round** (final-demo corrections) implemented on top of deployed v2.1
  (`8fb59c1`, prod migration `0016`, image `a492d908…`). Corrective commit **`1bbf797`** on
  `scope-v2.1-corrections`. Full report `docs/DELIVERY_MAC_MINI_V2_1/CORRECTIONS_REPORT_20260727.md`.
- **A** program archive (dormant `programs.archivedAt` cols — no migration) + Arabic confirm + restore;
  new `/plan/classifications` manage page (rename/reassign — **no program deleted**); archived hidden
  from lists/selects/reports/exports. **B** «مرجع الدفع»→«رقم الفاتورة» (now shown) + optional invoice
  attachment (reuses secure storage+evidence pipeline) + «البند» select (المستلزمات/النشاط) + **per-item**
  allocated/spent/remaining — each item independent via `plan_budget_items` (corrected 2026-07-27, commit
  `02a5a19`; clone-verified 5000/3000→1200/3800 & 800/2200; edit/delete recompute only the affected item).
  **C** shared
  `BackButton` (history-or-fallback) on perf session/cycle + plan. **D** «الإجراءات»→«التوصيات» (perf);
  finalize/close a perf session with **ZERO evidence** — signed-report + all-rated + evidence gates
  removed (issue-report + D-014 kept; existing completed sessions unchanged). **E** classifier memoized
  (React `cache()`, N→1/request) + single-shot guarded evidence refresh + async mkdir + SQL GROUP BY
  count (measured ~30ms→~4.5ms for an 8-caller render). **F** committee assignment doc rebuilt into two
  independent lists «أعضاء اللجنة» + «مهام اللجنة» — members shown without tasks, no throw on empty.
  **G** minutes drop «الصفة», add «التوقيع»; committee النتائج/الأثر (`committee_impacts`) removed from
  workflow/exports/close-gate (0 prod rows; table + rows preserved). **H** all user-facing business
  fields optional + null-safe «بدون عنوان» (`src/lib/format.ts`); internal/security/audit/identity kept.
- **Migration `0017`** (additive, forward-only): `budget_income.amount` + `budget_expenses.amount` →
  nullable. **No seed; 0000–0016 not rerun.** Rehearsed on a **production clone**: 17→18, counts
  unchanged (26/129/129), milestone fingerprint **`8d5375…a382cf` UNCHANGED**, idempotent.
- **ALL GATES GREEN:** typecheck 0 · lint 0/0 · build ✓ · **vitest 287** (was 280; +6 B4 per-item, +1) ·
  **Playwright 60 pass / 1 skip** (skip = C5 D-018). 6 existing tests rewritten to the corrected behavior.
- **Pre-deploy encrypted backup taken + verified** (`backups/predeploy/*-20260727-114825`; SHA-256 in
  `SHA256SUMS-20260727-114825.txt`; 502 DB objects / 58 files; restore-verified). Prod baseline
  26/129/129/54; **exposure unchanged** (pg `5432/tcp` unpublished, Ollama `127.0.0.1:11434`, app
  `0.0.0.0:3080` = existing LAN binding). LAN `compose.production.yml` diff still **uncommitted**.
- **DEPLOYED to production 2026-07-27 (authorized).** Migration **0016→0017** (migrate-only, NO seed;
  fingerprint `8d5375…` unchanged; all counts unchanged; only 0017 added). App image `a492d908…` →
  **`fc8654e2…`** (built from commit `49ac5b6` = `02a5a19` B4 + `68c2f26` docs + `49ac5b6` test-count fix).
  Full Playwright 60/1-skip pre-deploy; fresh encrypted backup `backups/predeploy/*-20260727-131643`
  (SHA-256 recorded, 502 objs/58 files, verified). Exposure UNCHANGED (pg 5432 unpublished, Ollama loopback,
  app `0.0.0.0:3080` existing LAN binding). Rollback image tagged `madrasa-app:0.1.0-prev-v2_1-20260727`
  (= a492d908). Restart-persistence PASS; login/auth-gating smoke PASS on loopback + `192.168.0.171:3080`.
  **NO release tag; host-PC migration NOT started.** Authenticated UI acceptance = principal via `/pilot`
  (I don't hold the changed principal password; did not impersonate/write business data to prod).
  **Live LAN IP `192.168.0.171`** — keep `TRUSTED_ORIGINS`/`APP_BIND` matched on any future redeploy.

## Earlier checkpoint — SCOPE v2.1 CORRECTIONS DELIVERED to dev/test (2026-07-25)
- **Principal's 3rd feedback round (Scope v2.1) supersedes conflicting Scope v2.** Recorded as
  **D-024 … D-029** (`docs/DECISIONS.md`); impact map `docs/SCOPE_IMPACT_V2_1.md`; deployment package
  `docs/DEPLOYMENT_REPORT_V2_1.md`. Branch `scope-v2.1-corrections` (NOT committed to main). **Production
  untouched.**
- **D-024 (supersedes D-020):** activities + «جاهزية الإقفال» closure readiness **removed from the app**;
  the **program** is the execution/follow-up unit — `programs.progress`/`executionStatus` maintained
  directly (`updateProgramExecutionAction` + weekly follow-up progress input; `recomputeProgramProgress`
  and the activity CRUD/UI/engine callers removed). Deleted `activity-actions.ts`, `activities-ui.tsx`,
  `progress.ts`, and the obsolete `activity-workflow.test.ts`. Plan imports **no longer create activities**.
  The **129 `program_activities` + 129 legacy `program_milestones`** (and activity_deliverables/
  evidence_requirements/state_history + programs.weighting_mode/completed_*/override_* columns) are
  **preserved unchanged** — no runtime path reads them (verified by grep); retained for audit/rollback.
- **D-025:** program evidence is informational only — removed every target/quota/%/"remaining"/blocker
  (`computePackageReadiness`, `checkRequiredEvidence`, worklist `evidenceGaps`, dashboard «تنبيهات نقص
  الشواهد», AI required/missing framing). Weekly follow-up + program page show the actual condition via
  `evidenceCountPhrase` (0/1/2/3-10/≥11 correct Arabic) + latest upload date + open-evidence link.
- **D-026:** budget labels «الغرض/التخصيص» & «المستلزمات/البنود» → **«البند»**; inline receipt upload
  **and** link-existing for every income + expense (reuses `EvidencePanel` on `?إيراد=`/`?مصروف=`;
  income receipt support added; neutral non-blocking framing).
- **D-027:** committee signatures **per meeting/document type** (`meeting_types.requires_signature`,
  default false — the global `completeMeetingAction` gate is now type-conditional; report text softened).
  New predefined **task-template** system (`committee_task_templates` seeded from `committeeTemplates.duties`)
  + per-committee **task distribution** (`committee_task_assignments`): load → edit/exclude/reorder →
  assign to members → generate the **task-distribution table with «توقيع العضو» column** (reworked
  `assignment-form.ts`) → frozen snapshot. New `/committees/task-templates` management page.
- **D-028:** KPI planning session «تخطيط» excluded at the single choke point (`cycleProgress`, adds
  `evaluated`); shows «لم يبدأ التقييم بعد» not 0%; per-session planning row «تخطيط — لا يُحتسب».
- **D-029:** `insertBefore` root cause = browser auto-translation (no `translate="no"`) + password-manager
  injection + shell Hijri hydration. Fixed at shared-primitive level (layout/global-error `translate="no"`
  + `notranslate`; hardened `SubmitButton`/`Field`/`Select`/`TextArea`/`Labeled`; `suppressHydrationWarning`
  on the shell date; `(app)/error.tsx` never shows the raw English exception — logs it, shows Arabic recovery).
- **Migration `0016` (additive, `madrasa_test` only):** 2 committee-task tables + `meeting_types.requires_signature`.
  **Production is at `0000–0015`** (Scope v2 already deployed; verified read-only 2026-07-26 on
  `madrasa-prod-db-1`: 16 migration rows, D-022 fingerprint `8d5375…` matches recorded F0, count 129,
  people 54/programs 26/milestones 129/activities 129 1:1/feedback 1; stored_files 18/evidence 3/documents 10
  are normal live-app growth). **`0016` is the only pending production migration.** (An earlier v2.1 draft
  wrongly said prod was at 0009 — stale v2-era text, never verified; corrected.)
- **ALL GATES GREEN (continuation, 2026-07-26):** typecheck ✅ · lint 0/0 ✅ · **vitest 280 pass (53 files)** ✅ ·
  production build ✅ · **full Playwright 60 passed / 1 skipped** (the skip is C5 real-HTTPS camera —
  D-018 environmental deferral, `test.skip(!https)`; not a v2.1 weakening). Real-workflow browser coverage
  validated per area: s2 (§1 direct progress + §2 evidence 0/1/2 immediate refresh + no-quota), s2ب (§3
  budget «البند» + income/expense receipts), s3 (§4 load predefined tasks→assign→generate «توقيع العضو»
  doc + type-dependent signature), s4 (§5 planning-only «لم يبدأ التقييم بعد»). `/pilot` rewritten to v2.1.
- **Real bug found + fixed:** evidence `latestAt` was a string not a Date (`max(created_at)` via `sql<Date>`
  is only a cast) → program/followup pages crashed once evidence existed → fixed (normalize to Date in
  programEvidenceSummary/programsEvidenceSummary + `router.refresh()` in EvidencePanel for reactive count;
  regression test `tests/integration/evidence-program.test.ts`). Also fixed a duplicate React key (`الحالة`)
  in the shared Table (keyed by index now) + the meeting-UI type-dependent signature gap.
- **Test-safety:** `tests/helpers/assert-non-production.ts` fails closed if any test resolves to
  madrasa-prod/madrasa-prod-db-1/prod DB/192.168.0.48:3080/port 5432 (checks actual values, not env-var
  naming); wired into vitest + Playwright; proven by `tests/unit/assert-non-production.test.ts`.
- **Production: verified read-only at 0015 (2026-07-26), now OFF-LIMITS** (no further prod access until
  deployment authorization). D-022 fingerprint `8d5375…a382cf` matched F0; counts confirmed
  (54/26/129/129 1:1/1; stored_files 18/evidence 3/documents 10 = live growth). Disclosed net-zero
  deviation: accidental `CREATE EXTENSION pgcrypto` then `DROP` (no data touched). **0016 is the ONLY
  pending prod migration.** Corrected deploy runbook (apply only 0016, NEVER seed — `init` runs
  migrate&&seed so use `run … init sh -c "migrate.ts"` + `up -d --no-deps app`) in `docs/DEPLOYMENT_REPORT_V2_1.md` §5.
- **Committed** at this validated gate (see final commit hash), excluding the temporary LAN
  `compose.production.yml`. No tag, no deploy. Awaiting explicit production-deployment authorization.

## Earlier checkpoint — PRODUCT SCOPE v2, STEPS 1–14 DELIVERED (2026-07-23)
- **Continuation parts 1–3 received and implemented.** D-022 approved (129 baseline);
  D-023 rollback correction. Steps 6–14 of the sequence delivered; step 15 (production
  deploy) awaits owner authorization; production writes are NOT attempted (owner instruction).
- **Step 6 — KPI/performance (§4):** migration 0012 — `perf_signed_report_versions` +
  session narrative/`evaluation_completed_at`. Signed-report replacement preserves prior
  versions; "evaluation completed" distinguished from "signed report received"; missing-signed
  dashboard panel. Existing teacher-academic/staff-Gregorian cycles, 3 mandatory sessions,
  duplicate-cycle prevention unchanged.
- **Steps 7–8 — committees + headers (§5,§6):** migration 0013 — committee assignment doc +
  effective-dated membership. `generateAssignmentForm` (one committee-level تكليف via shared
  doc pipeline + central identity); ending an approved member is effective-dated, never
  rewrites history. `src/lib/document-identity.ts` — central header defaults with per-element
  include/exclude + per-document override; issued docs snapshot the identity used.
- **Step 9 — building (§7):** migration 0015 — `facility_checklist` + `facility_room_links`.
  New `/building/facilities` primary workflow (موجود/غير موجود/غير مطلوب → link to room);
  standard + custom types. QR/scan/inspections stay optional.
- **Step 10 — budget (§8):** migration 0014 — `budget_income` + `budget_expenses` +
  `budget.*` perms. New `/budget`: summary, planned-vs-actual, unlinked/missing-receipt/
  overspend flags. Overspend recorded with mandatory acknowledgement, never silently
  normalized. Receipts via shared evidence (budget_income/expense are linkable types).
- **Step 11 — reports (§9):** per-program report rebuilt on activities/readiness/budget;
  `/reports` reorganized into the 3 scope levels.
- **D-020 completion:** milestones have NO write path; plan **imports now create activities**
  (rollback deletes a batch's activities explicitly, restrict FK). New `plan.override`
  permission (principal only) for completion override with permanent missing-items snapshot.
- **Steps 12–14 — verification + pilot:** vitest **273 pass**, typecheck/lint/build clean.
  Empty-DB migration (16→76 tables) and current-schema migration (0010–0015 onto a prod
  clone, milestones untouched) both verified on disposable DBs. Playwright vs a next-start
  prod server: mobile RTL (5), scope-v2 smoke (3), arabic-auth, import-decisions (4) — green;
  **e2e caught a real use-server bug in facilities actions (fixed).** Fresh encrypted backup
  + sha256 + **restore rehearsal PASS**. `/pilot` retest checklist rewritten to the v2
  workflows (employee, program+activities, progress/readiness, blocked completion, KPI+signed
  report, committee membership+assignment, header settings, facility, room, asset, income,
  linked expense, program report, executive report, feedback). Docs: `docs/DEPLOYMENT_PLAN_V2.md`,
  `docs/VERIFICATION_V2.md`, `docs/SCOPE_IMPACT_V2.md`, `docs/DECISIONS.md` (D-019..D-023).
- **Safety honored:** no production write, no reseed/reset, no official import by the agent,
  no release tag, Postgres/Ollama unexposed, retained pilot data intact (129 milestones).
  Migrations 0010–0015 applied to `madrasa_test` only.

## Earlier checkpoint — PRODUCT SCOPE v2, SECTIONS 2–3 DELIVERED (2026-07-23)
- **D-020 LOCKED + implemented:** activities are the canonical, sole weighted execution unit.
  `program_activities` absorbs `program_milestones` functionally; the legacy table stays
  physically intact as a **read-only rollback source** with **no write path left in the app**
  (all four milestone write actions removed, approval gate + progress now read activities).
  Physical removal is a later, separately approved cleanup migration. Commit `29bc2aa`.
- **⚠️ D-022 — STOP CONDITION HIT (production only).** The scope expects a 64-milestone
  baseline; production actually holds **129** (local dev 194). The 64 figure is stale — it
  counted local dev on 2026-07-18, before the principal committed the plan batch on 2026-07-21.
  Distribution is regular (25 programs × 5 + 1 × 4, all weight 20, all «لم يبدأ»), so this is a
  stale expectation, not corruption. **Nothing applied to production; awaiting acknowledgement.**
  Reconciliation asserts the observed live count, never a hardcoded 64.
- **Migration 0011** (additive, forward — 0010 left immutable because it is applied to
  `madrasa_test`): `program_activities`, `activity_deliverables`,
  `activity_evidence_requirements`, `activity_state_history` + `programs` weighting-mode,
  completion, override-snapshot and archive columns. Applied to `madrasa_test` only.
- **Migration state:** `madrasa_test` 0000–0011 · production 0000–**0009** · local dev 0000–0007.
  Neither 0010 nor 0011 is in production.
- **Backfill + reconciliation** (`src/lib/plan/milestone-backfill.ts`): unique
  `migrated_from_milestone_id` makes each legacy milestone map to exactly one activity and the
  backfill idempotent. Reconciliation proves no orphans, no duplicates, no dangling refs,
  unchanged program association, no weight/progress drift, untouched legacy table.
- **Progress ≠ readiness.** Progress from activities only (0% draft, 100% completed, explicit
  1–99% in progress — no invented 50%; no activities = 0%). Readiness from applicable mandatory
  checks with an Arabic missing-items checklist and links — never from file count. Normal
  completion needs 100% readiness; otherwise principal-only override (`plan.override`) with a
  mandatory justification that stores user/date/reason/readiness/missing list permanently.
  Invalid custom weight totals are never silently normalized.
- **Gates:** typecheck clean, lint 0/0, production build clean, **vitest 250 passed** (was 208).
  Backup + `restore:rehearsal` PASSED. No release tag. No production change.
- **Sequence (§11):** steps 1–5 done. Steps 6–13 (KPI, committees, headers, building, budget,
  reports, audits) not started. Step 15 (production deploy) blocked on D-022 acknowledgement +
  operator authorization for prod-DB writes.

## Earlier checkpoint — PRODUCT SCOPE v2, SECTION 2 DELIVERED (2026-07-23)
- Engagement doc: **`docs/SCOPE_IMPACT_V2.md`** (inspection, mapping, migration plan, delivery log).
  Commits `0c16f66` (analysis gate) and `8b70305` (section 2).
- **⚠️ Production is no longer a clean baseline.** The principal manually committed **both** real
  batches on 2026-07-21: operational plan (`منفذة` 17:27 UTC) and Fares employees (`منفذة` 18:48 UTC).
  Production now holds real school data — 54 people, 26 programs, 129 milestones, 312 roadmap cells,
  123 perf indicators, 88 audit rows, 1 feedback. **Treat prod as live data from here on.** The
  "zero operational records" line in the 2026-07-20 checkpoint below is superseded.
- **Section 2 (shared product model) implemented.** Employee register: `deletePersonAction` now
  guards all 9 reference sites (was 2 — a person owning a program, task, maintenance issue, teaching
  stage or login account could previously be hard-deleted); duplicate detection on manual create/edit;
  `people.employee_type` («معلم» / «موظف إداري») **derived** from `category` so no existing row and
  no protected batch is rewritten (D-019). Shared evidence: `src/lib/entity-registry.ts` (12 linkable
  types, was 5 hard-coded), fail-closed delete guard, archive/restore, `evidence_versions` replacement
  history that preserves every link, new `/evidence/[id]` with "مستخدم في" across modules, and
  `EvidencePanel` gains «ربط شاهد قائم» + «فك الربط» instead of delete — the change that actually
  stops the same document being uploaded twice. Safe deletion: `src/lib/safe-delete.ts`
  (`assessDeletion` over 11 entity types, Arabic dependency counts + archive alternative), wired into
  person, evidence and milestone deletes; asset flow deliberately unchanged.
- **Deliberate behaviour change:** evidence with any link can no longer be permanently deleted
  (previously allowed for draft-linked records). Archive is the alternative. The existing test was
  updated to assert the stricter rule, not weakened.
- **Migration 0010** (additive: `evidence_versions`, `evidence_items.version/archived_*`,
  `people.employee_type`) — applied to `madrasa_test` only. **Not yet applied to production:** a fresh
  encrypted backup was taken and `restore:rehearsal` **PASSED** (66 tables), but the apply step was
  blocked by the environment's prod-DB write guard and needs operator authorization. Command in
  `docs/SCOPE_IMPACT_V2.md` §6 (migrate only — never re-run `seed.ts` against live data).
- **Gates:** typecheck clean, lint 0/0, production build clean, **vitest 208 passed** (was 193).
  No release tag. App container still runs the previous image — DB migration and UI cutover are
  independent decisions.
- **Open:** the scope prompt arrived truncated mid-section 3 (D-021). Section 3's rules and all later
  sections are missing. D-019 (employee-type labelling, implemented under the recommended approach)
  and D-020 (activity vs milestone progress model) await confirmation.

## Earlier checkpoint — POST-PILOT REMEDIATION (Phases 0–10) COMPLETE (2026-07-20)
- Full engagement in `docs/POST_PILOT_REMEDIATION.md` (per-phase design + verification), plus
  `docs/UI_ACTION_AUDIT.md`, `docs/CLEAN_PRODUCTION_BASELINE.md`, `docs/DOCKER_HOMELAB_DEPLOYMENT.md`,
  `docs/DOCKER_OPERATIONS.md`. Commits `957b976`..`5ed65fa`.
- **P0** cold-checkpoint backup + restore rehearsal (PASS). **P1** button-failure root cause (stale
  PWA + one hydration break) fixed: SW rewrite (network-first navigations, versioned cache),
  `PwaManager` (Arabic update notice + ChunkLoadError self-recovery; reload only on genuine update),
  `global-error.tsx`, `isUuid` guard. **P2** asset lifecycle (archive/restore + guarded delete,
  migration 0008). **P3** editable inspection templates (CRUD + versioning + frozen snapshot,
  migration 0009, 10 system templates). **P4** phone document scanning → PDF (+ upload fallback).
  **P5** QR scanning (room/asset) + manual fallback. **P6** rebuilt manual SVG 2D editor (create/
  tray/place/drag/resize/numeric-sync/undo-redo/draft-publish/rollback; removed Konva). **P7+P8**
  clean production baseline + Docker homelab stack (`compose.production.yml`, project `madrasa-prod`);
  **reversible cutover done** — active service on 127.0.0.1:3080 is now the clean Docker stack
  (clean DB, zero operational records, pg not published). Legacy retained as cold checkpoint. **P9**
  acceptance: typecheck/lint(0)/build clean, **vitest 193**, **Playwright 52 passed / 1 skipped**
  (only C5 physical-camera, D-018 deferred). **P10** `/pilot` Arabic invitation + 15-task retest
  checklist (feedback-backed).
- **Safety honored:** legacy DB/volume/files/backups never deleted; migrations 0008/0009 applied only
  to `madrasa_test` + the clean Docker DB (legacy stays at 0–7); **no Fares/plan import committed**,
  **no floor published in production**, **no employee accounts**, **D-014 unresolved**, **no release
  tag**, no public Postgres/Ollama, no Tailscale Funnel. Acceptance is NOT marked until the principal
  submits feedback. Retest route: `/pilot` (Tailscale HTTPS; local `http://127.0.0.1:3080/pilot`).

## Earlier checkpoint — PILOT FEEDBACK + /pilot CENTER + GUIDES (2026-07-19)
- **In-app pilot feedback workflow (Phase 3).** Additive **migration 0007** (`feedback` table +
  `feedback_ref_seq` — human refs `FB-0001…` from a DB sequence default, race-safe). New RBAC
  perms `feedback.create` / `feedback.manage` (granted to principal + sysadmin; idempotent
  `seedFeedbackRbac` in `src/lib/feedback/service.ts` + `src/db/seed-feedback-rbac.ts`).
  Floating «إرسال ملاحظة» button on every page (`src/components/feedback/feedback-dock.tsx`,
  wired in `(app)/layout.tsx`) — bottom-`end` corner, opposite the AI button (bottom-`start`),
  never overlaps; vertical form usable at 390×844; success shows «تم تسجيل ملاحظتك» + ref.
  **Privacy:** captures only page path, module, viewport, coarse browser family (from UA
  header, server-side), app version — NO page HTML/cookies/tokens/form contents/DOM; text
  sanitized (`sanitizeFeedbackText`, control-char strip); attachments are sensitive private
  files via `saveUploadedFile` + dedicated `/api/feedback/[id]/attachment` (feedback.manage).
  Management `/admin/feedback` (+`[id]`): filters (module/category/severity/status/date/archived),
  open linked page, view attachment, status+resolution workflow («لن تُنفذ»/«تم الحل» require a
  documented reason), Arabic print, Excel export (`/api/export/feedback-xlsx`). **No permanent
  delete — archive-only with reason + reversible unarchive**; all mutations audited
  (`feedback.created|status_changed|archived|unarchived|attachment_download`).
- **Dynamic Arabic /pilot center (Phase 4)** (`src/lib/pilot-status.ts`, `(app)/pilot/page.tsx`;
  linked from dashboard header + nav). Live-computed (no hardcoded numbers), handles both Fares
  states: preview → «بانتظار تأكيد استيراد بيانات فارس» + link to the real batch, committees/
  performance marked waiting, status «SOFTWARE READY — AWAITING ONE PRINCIPAL ACTIVATION ACTION»;
  committed → 52/42/10 + no-accounts + 7 rollback deps + modules unblocked. Shows plan (26 draft),
  D-014, floors, local-AI connection (live), latest backup, feedback counts, C5 + archive deferred.
  First-week checklist (guidance only), the rollback warning verbatim, boundaries (not failures).
- **Guides (Phase 5):** `docs/PILOT_USER_GUIDE_AR.md` (Arabic, principal-facing) +
  `docs/PILOT_OPERATIONS.md` (English technical ops: startup/shutdown, ports/DB, Tailscale,
  backup/restore, Ollama health, logs, feedback triage, post-restart checks, data provenance,
  failed-Fares recovery, migration apply order).
- **Tests (Phase 6):** +18 vitest (`tests/unit/feedback.test.ts` 9, `tests/integration/feedback.test.ts`
  7, `tests/integration/pilot-status.test.ts` 2) → **171 vitest pass**; e2e `tests/e2e/feedback.spec.ts`
  (desktop + 390×844: create→«تم تسجيل ملاحظتك»+ref, admin list, Excel download, /pilot Fares-waiting,
  no h-overflow, feedback/AI buttons don't overlap). Full Playwright **46 passed / 1 skipped (C5 only)**.
  typecheck + lint (0 errors) + production build clean. No existing test weakened/skipped.
- **Phase 7 — additive migration applied to REAL DB (authorized).** Fresh encrypted backup +
  `restore:rehearsal` PASS (65 tables) first; migration 0007 applied to madrasa_test then real
  `madrasa`; `seedFeedbackRbac` run. **Real-DB integrity proof (baseline vs post):** ONLY changes
  are new empty `feedback` table (0 rows), permissions 53→55, role_permissions 104→108 (feedback
  grants), migrations 7→8. users 2, people 80, programs 58, audit_log 1205, sessions — ALL
  identical. **No real feedback record created. Fares batch STILL «معاينة» / 0 people / untouched
  — never committed.** 3080 dev server restarted healthy (all routes 307 auth-gated, no 500s);
  read-only smoke confirms /pilot + feedback queries run on real data (AI connected). No git tag.

## Earlier checkpoint — UNIVERSAL EXCLUSION + SAFE ARCHIVE WORKFLOW (2026-07-18)
- **Centralized exclusion.** `getExcludedIdSets()` (`src/lib/synthetic.ts`) is now the single
  filter every customer-facing query uses; it unions (a) structurally-classified synthetic ids
  (toggle via `MADRASA_INCLUDE_SYNTHETIC`) and (b) **explicitly-archived ids (always ON)**.
  Classifier extended from 10 → **20 entity buckets** (adds plan_year, milestone, deliverable,
  kpi, risk, budget, roadmap_cell, followup, change_request, outcome) so dependent records are
  covered + countable. Exclusion wired into every gap: `/plan` list + `[id]` + `[id]/report`
  (→notFound), `/plan/followup`, `/plan/kpis`, `/plan/risks`, evidence, people, tasks,
  committees, performance, documents, maintenance, plan-XLSX + program-DOCX exports, and the AI
  by-id brief tools. (dashboard/worklist/executive-report/AI-search were already filtered.)
- **Safe archive workflow** (`src/lib/cleanup-archive.ts` + `admin/cleanup/actions.ts`, migration
  `0005`: `archive_batches` + `archived_records`): preview → explicit Arabic confirmation
  («أرشفة السجلات التجريبية») → **transactional, non-destructive** archive (snapshots each row,
  hides via central filter, **deletes nothing**) → **immutable audit event in-tx** → full
  **unarchive/rollback**. Name-only «تجريبي» records need explicit manual selection; wrong phrase
  / empty reason fail-closed. **Rebuilt `/admin/cleanup`** with exact counts by bucket (الخطط/
  المعالم/المخرجات والشواهد/التحديثات/المخاطر/الميزانية/التقارير/سجلات تابعة أخرى/الاسم-فقط),
  structural reasons, preserved-batch assertions, and a wired execute button. **Cleanup NOT
  executed — the agent stopped before archiving; it is the principal's manual action.**
- **Live read-only classification on the REAL DB (SELECT-only):** 58 programs → **26 preserved
  / 32 synthetic**; milestones 64, deliverables 16, followups 16, change-requests 16, kpi/risk/
  budget/roadmap 0 (all under the official year), people 80 (real staff live in the uncommitted
  Fares معاينة batch), committees 15, meetings 14, tasks 14, documents 39, evidence 149,
  maintenance 11; name-only 0. **Official batch `385c615a` منفذة (26 programs, not synthetic) and
  Fares `12673bed` معاينة (not synthetic) both preserved.**
- **Gates:** typecheck/lint/build clean; `npm test` **122 passed** (+7). Playwright (madrasa_test
  only): all specs proving this change pass — `cleanup.spec` (mobile /admin/cleanup 390×844, no
  overflow, archive form present but not run, 0 archive batches, Fares preserved), `mobile` 5/5
  (fixed a pre-existing `E2E_STORAGE_DIR` credential-path bug in mobile.spec), import-decisions,
  plan-import, arabic-auth, https-pwa, workflows «حرمة دفعة فارس». Remaining failures are
  unrelated/environmental (assistant needs local Ollama; heavy workflows-س1 is byte-identical to
  HEAD). Added `E2E_EXTERNAL=1` to run e2e against a pre-warmed isolated server. **Real DB
  untouched — table row-counts identical before/after; archive tables absent there.**
  Details: `docs/UNIVERSAL_EXCLUSION_AND_CLEANUP.md`. **Stopped at the archive confirmation.**

## Earlier checkpoint — TEST ISOLATION + SYNTHETIC CLEANUP (PREVIEW) (2026-07-17)
- **Fail-closed DB guard** (`src/db/guard.ts`): when `MADRASA_ENV=test`, `DATABASE_URL` must
  name a `_test` DB or the connection is refused before opening. Wired into `src/db/index.ts`
  (inert in dev/prod). Vitest + Playwright now target `madrasa_test` only. Playwright: dedicated
  port **3081**, `reuseExistingServer:false`, `STORAGE_DIR=storage-e2e`, `global-setup.ts`
  (ensure+migrate+truncate+seed + synthetic Fares stand-in via `scripts/e2e-fixtures.ts`),
  `MADRASA_INCLUDE_SYNTHETIC=1` so scenario data stays visible. Root cause of prior pollution:
  e2e drove `npm run dev` on the real `madrasa` DB. **Local caveat:** Next 16 permits one
  `next dev` per dir — run e2e with the dev server stopped / in CI.
- **Type-aware import confirmation** (`src/lib/imports/confirm-summary.ts`): plan imports show
  Arabic plan counts (برامج/مخرجات/مؤشرات/مخاطر/ميزانية), never employee labels. Wired into
  imports `[id]/page.tsx` + `batch-ui.tsx`.
- **Synthetic classifier** (`src/lib/synthetic.ts`, read-only, no schema change): structural
  identification (import-batch provenance «تجريبي», `demo%` plan years, FK propagation) — NOT
  by name alone; name-only «تجريبي» records go to a separate manual-review bucket. Exclusion
  (`getExcludedIdSets`/`notSynthetic`, ON except when `MADRASA_INCLUDE_SYNTHETIC=1`) applied to
  dashboard stats, work center (`worklist.ts`), executive report, and AI tools (`ai/tools.ts`).
  Preview-only **/admin/cleanup** page (read-only; cleanup NOT executed).
- **Proof (read-only classify on the real DB):** 58 programs → **26 preserved (official) / 32
  synthetic**; official batch `385c615a` منفذة, 26 programs, **0 flagged**; Fares `12673bed`
  معاينة, **not** synthetic; **0 name-only suspects**. Real data untouched.
- **Gates:** typecheck/lint/build clean; `npm test` **115 passed** in `madrasa_test`. Details in
  `docs/TEST_ISOLATION_AND_SYNTHETIC_CLEANUP.md`. **Stopped at cleanup confirmation.**

## Current state — WORKFLOW-QUALITY PHASE DELIVERED, AWAITING PRINCIPAL ACCEPTANCE (2026-07-17)
- **Gate C5 remains DEFERRED_BY_PRODUCT_OWNER (D-018) — NOT passed.** App runs over existing Tailscale HTTP; every camera-dependent step has manual fallbacks (room-code entry «فتح غرفة بالرمز», plain file upload). **v1.0.0-pilot is NOT tagged until the principal accepts `docs/WORKFLOW_ACCEPTANCE_AR.md`.**
- **Workflow remediation COMPLETE** (commits `9908f19`..`a420767` + final phase commit): «مركز عمل مدير المدرسة» action-first dashboard (src/lib/worklist.ts — every card deep-links to the exact record with an Arabic next action); app-wide duplicate-submit guard (SubmitButton useFormStatus + confirmText) and WorkflowSteps stepper; evidence review stage + indicator-level subKey linking; imports (race-safe itemized approval, post-commit /people?دفعة= links); plan (weekly follow-up page + program_followups table migration 0003 — «متأخر» detection now live; CR notifications); committees (steppers, dup-outcome guard, close gate incl. بانتظار التوقيع); performance (final-evaluation gate now satisfiable via per-indicator evidence UI, cycle completes on final lock, D-014 staff manual-model fallback); digital twin (room edits flow register+geometry-draft→publish — publish no longer wipes edits; maintenance assignee; asset QR filter); AI assistant (server-side context binding, 17-tool registry incl. program/meeting/person/room briefs + attachment_text with pdftotext/OCR — hard exclusions unchanged, all writes preview+confirm).
- **Scenario e2e** `tests/e2e/workflows.spec.ts`: 15/15 green (7 desktop business scenarios + 8 mobile 390×844 replays with zero horizontal overflow), 3 consecutive green runs; exposed+fixed 3 real bugs (room-code generation outside the publish tx → first multi-room publish always crashed; evidence-form stale radio after save; closed committee blocked re-forming). Final: **84 vitest + 30 Playwright green (+1 skipped = deferred C5)**, tsc/eslint/build clean.
- **Dev DB now contains tagged «تجريبي آلي» synthetic records** from scenario runs (people, programs, committees, cycles, documents, 17 ground-floor rooms KHS-RM-0001..0017 — ground floor published, «فحص السلامة العام» template approved). The real Fares batch is untouched in «معاينة» (asserted by the final scenario every run).
- Acceptance deliverable: **`docs/WORKFLOW_ACCEPTANCE_AR.md`** (stages, repairs, manual test order, AI commands, limits, commit refs).
- History: first acceptance was rejected (broken iPhone UI, no usable in-app AI, insecure HTTP) → corrective commits `7213b36`, `d00064a`, `1859508`; then this workflow-quality phase.
- **Mobile:** drawer root cause fixed (was anchored to the RTL *left* edge and translated into the viewport); all principal routes measured clean at 390/393/430/360px; ≥16px inputs, ≥44px targets, safe areas; digital-twin viewer with pinch-zoom/pan/reset + tappable rooms; room simple-fields editing + in-room camera maintenance report; Arabic loading/error/offline states.
- **AI assistant:** nav item + dock (desktop panel / mobile full-screen) + `/assistant` + contextual entries; Ollama (default, `qwen3:4b`, ~4s answers) / AnythingLLM (knowledge-only) local, Claude optional external behind recorded consent; typed zod-validated tool registry (8 read, 4 draft/write), preview→confirm→execute with idempotency + execution-time RBAC recheck, full audit; settings UI at `/admin/settings/ai` with live connection test; drafts inbox; works fully when disabled.
- **HTTPS:** `tailscale serve --bg localhost:3080` configured (NO Funnel); Secure cookies behind HTTPS; `TRUSTED_ORIGINS` (default `*.ts.net`, no hostname hardcoded); QR codes derive from request host.
- **App:** Next.js 16.2.10, port 3080, Postgres 16 Docker `madrasa-db` host port **5544**. Login: `principal`/`admin` (temp passwords in `storage/private/initial-credentials.txt`).
- **Quality:** 63 vitest (13 files) + 15 playwright green (1 skipped = real-HTTPS gate C5); typecheck/lint/build clean; no schema drift (migration 0002: AI tables); restore rehearsal previously executed (see `docs/BACKUP_REHEARSAL_LOG.md`).
- **Acceptance:** A1–A18 + B1–B9 pass; corrective gates C1–C14 pass except C5 (pending the operator click above) — evidence in `docs/ACCEPTANCE_TESTS.md` + `docs/TEST_RESULTS.md`.
- **Official models:** the 8 ministry models entered verbatim (page-by-page visual verification, `docs/PERFORMANCE_MODEL_VALIDATION.md`), seeded «معتمد»+رسمي (locked), each Σ=100%. Guide-vs-models discrepancy in 3 cells documented (D-014) — models PDF adopted; principal to compare with نظام فارس at first real cycle.
- **Fares import:** preview batch «معاينة» ready in /imports (52 rows; 42 معلم / 10 موظف مقترح؛ الحقول الحساسة مستبعدة). **Final commit is the principal's manual action.** Per-row review: `storage/private/fares-import-preview.md` (outside Git).
- **Calendar:** teacher_return 1448/3/10 = 2026-08-23 (الأحد) revalidated against the official sheet row 6 in both official workbooks.

## Phase summary (each has its own git checkpoint commit)
- **Phase 0** — docs, pinned stack, full schema (55 tables), seed: RBAC, 2 accounts, school+stages, official 1448-1449 calendar (verbatim, teacher_return=1448/3/10=2026-08-23), 6 committee templates from اللجان الرسمية 47.pdf, zones/floors, settings, private branding import.
- **Phase 1** — auth (Argon2id/sessions/TOTP/lockout), permission-RBAC, RTL shell, people register, safe-import framework (preview→correct→explicit-approve→transactional commit→rollback) + people & plan importers (data minimization; verbatim officials), plan module (weighted milestones, packages+readiness, change requests, approve/reopen+versions), unified evidence (+delete guard, content rendering incl. PDF page-1), documents (KHS-DOC numbers, verification codes, frozen snapshots, audited branding), Arabic A4 PDF via Playwright Chromium, tasks, notifications, dual calendar, admin pages.
- **Phase 2** — committees: annual formation from templates (no old members), members from school register only, approve/reopen, meetings, outcomes (قرار→mandatory task; توصية→optional), official minutes PDF (chair+secretary only), signed-minutes completion gate, close/archive, PLCs. Zero attendance/absence/quorum (schema-scan test).
- **Phase 3** — performance: scoring lib ((rating/5)×weight, server-only, tamper-rejected), model designer (=100% gate; official-entry flow ready — ministry PDF still missing, D-006), teacher/employee cycles w/ frozen calendar+model snapshots, sessions (once-only trio, unlimited visits w/ pre-study warning), completion gates (issued+signed report; final also all-rated+per-indicator evidence), reopen+versioning, improvement-plan suggestions, individual-detail principal-only guard.
- **Phase 4** — digital twin: traced 4 floors + site (26×18 calibration), Konva editor (two-way binding, undo/redo, draft/publish versions), backgrounds from source files (pptx rasters; aerial via sips/pdftoppm), publish→room-register sync (KHS-RM + QR), SVG 2D + three.js isometric 3D, assets (individual/quantity + QR + history), inspection templates (drafts→approve), readiness+override-with-reason, maintenance workflow, offline PWA (sw.js + IndexedDB queue + idempotent sync via clientOpId), girls-zone context guard everywhere.
- **Phase 5** — AI adapter (Ollama/AnythingLLM, disabled by default, drafts-only, audited; OCR helper vision-model based), M365 draft-email integration (never auto-sends; manual mailto fallback always available), encrypted backups (daily DB + weekly full, retention, off-site dir) + restore + REAL rehearsal, Dockerfile (+chromium+poppler), executive report (cross-module; individual details principal-only), Word/Excel exports, demo seed (synthetic, tagged «تجريبي»), full docs set (INSTALL_MAC_AR, DEPLOY_UBUNTU_AR, BACKUP_RESTORE_AR, USER_GUIDE_AR, SECURITY_REVIEW, LIMITATIONS_AR, TEST_RESULTS, README).

## Formerly outstanding items (D-006) — RESOLVED 2026-07-16 (D-014)
1. ~~`نماذج تقيم اداء شاغلي الوظائف التعليمية1.pdf`~~ — **done**: 8 models entered verbatim after page-by-page visual verification, seeded locked («معتمد»+رسمي). Log: `docs/PERFORMANCE_MODEL_VALIDATION.md`.
2. ~~`بيانات الموظفين في فارس.xlsx`~~ — **preview done** (52 rows; classification 42/10 suggested, 10 flagged for review; sensitive fields excluded). **Awaiting principal review + commit in /imports** — deliberately not auto-imported.
3. ~~`الدليل الارشادي لادارة الاداء الوظيفي.pdf`~~ — **done**: used as cross-check; 3-cell weight discrepancy vs models PDF documented in D-014 (models PDF adopted; compare with نظام فارس at first cycle).

## Remaining operator decisions (not code gaps)
- **Tailscale HTTPS (gate C5): DEFERRED_BY_PRODUCT_OWNER (D-018).** Do not resume until the owner re-opens it. When re-opened: open the link printed by `tailscale serve`, confirm, verify `tailscale serve status`, re-run `APP_URL=https://… npm run test:e2e`, test camera + offline from the iPhone. Tagging `v1.0.0-pilot` now waits on **workflow acceptance**, not C5.
- Review and commit the Fares preview batch in /imports (or reject it); confirm the 10 «يحتاج مراجعة» classifications and per-person model assignments (أمين مصادر has no official model — manual choice).
- At the first real evaluation cycle, compare the 3 D-014 weight cells with نظام فارس.
- Optional: harden `TRUSTED_ORIGINS` in `.env` to the exact device name instead of the `*.ts.net` default.

## Go-live checklist (operator)
1. Change both initial passwords; enable TOTP; store then delete `initial-credentials.txt`.
2. Review + commit the Fares preview batch in /imports (already parsed and waiting; final approval is yours).
3. Deploy per `docs/DEPLOY_UBUNTU_AR.md`; set `BACKUP_OFFSITE_DIR`; schedule cron backups; run `npm run restore:rehearsal` on the server and log it.
