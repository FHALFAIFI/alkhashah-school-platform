# DELIVERY v2.6.0 — the reporting platform

> RC readiness report for the v2.6.0 scope on branch `feat/v2.6-reporting-platform`
> (Draft PR #1), built on the deployed v2.5.0 baseline. Specification:
> `docs/requirements/v2.6-reporting-platform-specification.md`. Decisions **D-055…D-060**
> in `docs/DECISIONS.md`. Deployment sequence and rollback (prepared, **not executed**):
> `RUNBOOK.md` §«المرشَّح القادم — v2.6.0».

## 1) Executive verdict

**NOT READY.** The scope is implemented and every automated gate is green, but three
things must happen before this can be called a release candidate again, and one of them
has not been attempted at all.

| # | Outstanding | Kind |
|---|---|---|
| 1 | **ARM64 runtime smoke has never been run.** The CI smoke runs a *runner-native amd64* build of the same Dockerfile and commit. That proves the code boots, migrates and answers health — it does **not** prove the pushed `linux/arm64` binary runs. First mandatory pre-swap gate in `RUNBOOK.md`; not performed. | Blocking |
| 2 | **D-066 — an open product defect.** Removing one value from a multi-value report filter while others remain leaves the table and result count stale until reload. Reproduced on the production build. Cause is Next 16.2.12's client router cache; not fixed inside this frozen RC. | Disclosed defect |
| 3 | Interactive Microsoft Word open of the sample DOCX files, and the owner-authorized deployment with the principal's acceptance. | Human |

**Why the verdict moved from RC READY.** The full Playwright suite had never actually run
to completion: two failures in serial-mode describes were aborting the rest, so 11 tests
had never executed once. Getting them to run surfaced **six real production defects**
(§5a) — including one that returns a 500 error page on an ordinary filter click — none of
which any test had ever reached. A suite that cannot finish is not evidence.

**Superseded digests — do not deploy or cite either.** The tag `0.1.0-v2_6_0-rc` is mutable
and re-pushed on every branch push, so it must never be deployed on its own.

| Digest | Commit | Why it is dead |
|---|---|---|
| `sha256:3d331c03…` | `28f007f` | predates every product fix in §5a |
| `sha256:8d4c032f…` | `0503cea` | that commit's CI was green on the push trigger and red twice on the pull-request trigger (see below); it is not a commit where every job passed |

**The current RC image**, built from the final SHA after every job passed on both triggers
([run 31272025536](https://github.com/FHALFAIFI/alkhashah-school-platform/actions/runs/31272025536)):

```
image:   ghcr.io/fhalfaifi/alkhashah-school-platform/madrasa-app:0.1.0-v2_6_0-rc
platform: linux/arm64
commit:  cac78d518757b1240290b9dba700962656893cdb  (cac78d5)
digest:  sha256:4101f25a8911870ff4e3c3becfbc539a375add3adf7a88c2207be10e80709627
```

Its embedded `RELEASE_COMMIT` is verified, not assumed — the job fails if health reports a
different commit, and it returned:

```json
{"status":"ok","db":"up","version":"2.6.0","commit":"cac78d5","environment":"production"}
```

Deploy by that digest. Never by the tag.

**Production was not touched.** Port 3080, the `madrasa-prod` containers, database,
volumes and configuration were never read from or written to by this work. Every
database used was isolated and fail-closed non-production (`madrasa_test`,
`madrasa_ci_test`, `madrasa_upgrade_test`, `madrasa_clean_test` — names the test guard
enforces). Verified at session end: both production containers `RestartCount 0`,
`StartedAt` unchanged since the v2.5.0 deployment (app 2026-08-06T10:04:14Z, db
2026-08-05T14:18:51Z), health endpoint serving `version 2.5.0, commit 39674ed` — the
one read-only health GET used for this verification being the session's only contact.

## 2) Branch and commits

Base `0488f1a` (= `main` = v2.5.0 docs tip; tag `v2.5.0` @ `39674ed`).
Final SHA **`cac78d5`** — **111 files changed, +49,105 / −178 across 31 commits**.
The eleven that built the scope are listed below; the twenty that follow are the CI
repairs, the six product defects of §5a, and this documentation.

| Commit | Subject |
|---|---|
| `05b7496` | docs — consolidated specification |
| `de81b90` | docs — architecture decisions D-055…D-060 |
| `0704b71` | data model — migrations 0034 (5 tables) + 0035 (immutability triggers) |
| `9c7638c` | core — types registry, snapshot builder, lifecycle service, renderer |
| `c85b902` | identity — «مكتب التعليم» removed, identity colors (D-057) |
| `d133757` | exports, preserved outputs, background jobs, archive UI |
| `1e14b09` | CI — first GitHub Actions pipeline |
| `a2b23a2` | fix — artifacts script column name; three-kind chart seed |
| `44776b8` | v2.5-defect fix (export row loss) + security suite + perf audit + CI repairs |
| `8b16b90` | docs — RUNBOOK deployment/rollback, PROGRESS checkpoint |
| `9d20137` | e2e — archive flow from draft to numbered final report |

## 3) What was built (per specification section)

- **§A builder/lifecycle** — `/reports/archive` (search list), `/reports/archive/new`
  (type-driven creation: single over any of the 63 catalog reports, or the composite
  periodic/final-term/executive types), `/reports/archive/[id]` (draft: live preview
  rebuilt from the same `buildSnapshot` on every filter change, one FilterPanel across
  sections, section reorder/hide, hide-empty with «إظهار الفارغ» override, per-report
  identity overrides, copy-previous; final: frozen snapshot only). Statuses
  «مسودة/نهائي/مؤرشف»; only drafts editable/deletable; new version = new report
  referencing the original; number assigned **only** at finalization by a
  `SELECT … FOR UPDATE` per-Hijri-year counter — transactional and idempotent (a second
  finalize returns the same number; e2e-verified). Pre-export validation distinguishes
  warnings (non-blocking) from blockers (`lib/reports/instances/validation.ts`).
  Interactive names/numbers in the app preview link to source pages
  (`lib/reports/instances/links.ts`) — exports carry plain text.
- **§B snapshots/archive** — `SnapshotDoc` written once inside the finalization
  transaction; migration 0035 triggers reject UPDATE of any content column, DELETE, and
  draft-reversion of a non-draft row at the **database** level (application code,
  background jobs, cascades and future migrations all hit the same wall). Preserved
  outputs one row per (instance, format); ZIP alone replaceable (signed copy arrives
  post-final — D-060) and reassembled from preserved parts with read-back verification.
  Signed-copy upload with full upload validation; archive search over
  title/number/type/status/period — never inside snapshots.
- **§C domains** — every catalog report is available as a single-type instance
  (programs, follow-up, owners, domains, evidence, performance incl. low performers,
  committees, maintenance, building, budget, and the summary/statistical variants);
  the composite types cover periodic/final/executive reporting. Filters are the v2.5.0
  whitelisted framework applied **per section**; period applies across sections without
  overriding a finer per-section range.
- **§D privacy** — catalog-wide pinned test: no report column carries national-ID/
  contact/IBAN keys or labels; sensitive instances (any section with individual
  performance data) are invisible and unreadable without
  `performance.individual.read` on every list/read/download path (D-013 preserved);
  filter isolation proven by snapshot-content assertions.
- **§E identity/templates** — «إدارة التعليم» everywhere; «مكتب التعليم» removed from
  identity rendering, settings UI, template schema/placeholders/renderer and PDF
  fallback, pinned by a filesystem-scan test whose only allowlisted file is the
  verbatim ministry source (`committee-templates.ts`). Five protected base templates
  live in code; customized copies are DB rows with a strict zod config; per-report
  identity overrides never touch global settings; central identity gains «ألوان
  الهوية» with hex validation.
- **§F/§G output design** — one renderer for print preview and PDF (`instanceHtml`,
  served verbatim by `/api/reports/instances/[id]/print`); cover and TOC automatic on
  long reports with explicit overrides; wide tables handled by a pure, tested layout
  function (≤8 portrait; 9–13 landscape; 14–18 landscape + controlled scale; >18 split
  with the key column repeated); repeated table headers; unsplittable rows; labeled
  grayscale-safe bar charts. DOCX has a real editable header/footer, full RTL runs and
  tables, and **mixed portrait/landscape Word sections**; the generated PDF was proven
  to contain both A4 orientations (both MediaBoxes present). XLSX ships «الملخص»
  (title/number/period/generation time and every filter line) plus one RTL data sheet
  per section with safe deduplicated names, numeric cells kept numeric, formula
  injection neutralized. Filenames are «الاسم الكامل للتقرير - تاريخ إنشاء التقرير».
- **§H attachments** — signed copies pass the three-layer validation (extension, MIME,
  real signature); an MZ executable disguised as PDF is rejected by content; generated
  outputs use a system-only storage path closed to exactly pdf/docx/xlsx/zip with a
  100 MB cap; no internal path or stack trace reaches the UI (`userFacingError`
  pattern + Arabic route errors).
- **§I background generation** — `report_jobs` + Next `after()`: generation runs after
  the action response has streamed (the D-049/D-053 abort class is structurally
  impossible); one active job per instance via a partial unique index; stale jobs
  (heartbeat window 5 min) are closed with an explicit Arabic reason and retried as a
  new attempt; outputs are idempotent per (instance, format) so re-export never
  duplicates; drafts survive failures; the UI shows job state and auto-refreshes.
- **§K permissions** — no new keys. Authoring `reports.builder`; export
  `reports.generate`; finalization/signed copy `documents.issue`; sensitive content
  additionally `performance.individual.read`. Principal-only model unchanged.

## 4) Migrations and compatibility

| # | File | Change |
|---|---|---|
| 0034 | `0034_productive_rattler.sql` | 5 new tables: `report_instances` (21 cols), `report_outputs`, `report_jobs`, `report_counters`, `report_style_templates` + indexes/FKs — purely additive |
| 0035 | `0035_v260_report_immutability.sql` | hand-written + hand-journaled (0033 pattern): `report_instance_guard()` / `report_output_guard()` triggers + `report_jobs_one_active_unique` partial index — idempotent (`CREATE OR REPLACE` / `DROP TRIGGER IF EXISTS` / `IF NOT EXISTS`), zero rows written |

Ledger **34 → 36**, tables **89 → 94**. `drizzle-kit check` clean.
**Upgrade rehearsal** (`scripts/ci-migration-upgrade-test.sh`, local + CI): a database
built from the actual `v2.5.0` tag's migration set (ledger 34) migrated forward —
marker rows byte-identical, all five tables present, and a live probe confirming the
trigger rejects a forbidden UPDATE. **Fresh install** verified in CI (ledger 36 on an
empty database). **Rollback is app-only**: the v2.5.0 image ignores the new tables;
the triggers guard only new tables, exactly like the 0031–0033 precedent. No downtime
requirement beyond the usual app swap.

## 5a) Six production defects found by making the E2E suite finish

The suite reported "110 passed, 2 failed, 8 skipped, **11 did not run**". Serial-mode
describes stop at the first failure, so those 11 tests had never executed on this branch.
Repairing the two failures let them run, and every new failure that appeared was a real
defect — not a stale expectation. One of them (`D-065d`) had even been *passing* in CI on
timing luck:

| Defect | What the user saw | Fix |
|---|---|---|
| **D-065a** meeting minutes | The official numbered minutes were generated and stored; the download link never appeared and the stage indicator stayed on «إصدار المحضر». The previous fix redirected to the same path with only `#minutes`, which the router treats as a hash scroll and never re-renders. | Redirect carries the issued document number; confirmation is re-read from `documents` |
| **D-065b** session report | `issueReport` ended with **nothing at all**. Report issued, `report_doc_id` set, screen unchanged — and a second press *replaces* the session's report with a new numbered document | Same pattern |
| **D-065c** eight more actions | Committee card, programme report, assignment card, committees registry, school performance report, individual performance report, building report, settings save, identity save, mark-all-read — all wrote successfully and showed nothing | All end in a redirect; issuing ones show `IssuedDocumentNotice` |
| **D-065d** two transitions | Assignment-form generation showed «صدر نموذج التكليف …» but never the download link; evidence restore succeeded and the page kept showing the evidence archived. Both discarded the `pending` flag, so the D-053 rule-3 guard did not match them — and the assignment one had been passing in CI *by luck*, on an unrelated refresh landing first | `useRefreshAfterTransition`; guard broadened to any `useTransition()` |
| **D-067** id filters crash | Choosing a single committee/person/programme/financial item in **any** report's filter panel replaced the report with the generic error screen. `= any($1)` bound a JS array as one parameter → Postgres `22P02 malformed array literal` | `inArray(...)`; pinned by `report-filter-labels.test.ts` |
| **D-066** filter removal | Removing one value from a multi-value filter leaves results stale. **Open** — Next router cache, see §1 | Not fixed; scenario kept as `test.fixme` |

D-067 is the clearest illustration of why the suite had to finish: the only scenario that
touched an id filter used Playwright's `check()` on a controlled checkbox, which fails
*before* the navigation — so a 500-error page sat behind a mechanically failing test.

**Separately — six stale test expectations**, kept distinct from the defects above because
the product is right and the test was out of date. Each had never run since the UI changed:

| Scenario | Stale expectation | Reality |
|---|---|---|
| ٩–١١ | one heading named «السجل التفصيلي للمجالس واللجان» | since v2.6 the report title appears twice — the card in the list (`h3`) and the opened report's header (`h2`); now targets the `h2` |
| ١٢–١٣, ١٤–١٥, ١٦–١٧ | a `link` named «تقرير المعلمين» etc. | the performance quick entries are cards titled by name with an «فتح» button; a shared `openQuickReport` helper now clicks the card the principal clicks |
| ١٢–١٣, ١٦–١٧ | `getByText` on a filter value | the same text renders twice — as the chip and inside the empty-state explanation; now asserts the chip |
| ١٦–١٧ | «عتبة الأداء المنخفض» | unified to «حد الأداء المنخفض» in v2.5.0 so screen and export agree; the test kept the retired wording. Also raised to 100 % so the table has rows deterministically instead of depending on someone happening to score low |
| ٢٥–٢٦ | a button named «حفظ» on `/people/new` | creating says «إضافة»; «حفظ التعديلات» is the edit button |

None of these were loosened: each now asserts the same intent against what the screen
actually renders.

## 5) Tests

- Baseline at branch: **1042/1042** across 103 files (verified green before work).
- **Current: 1184/1184 across 117 files** (`npm test`, 2026-08-08) — the figure to quote.
  The +10 over the previous count are the regression tests for the defects in §5a:
  `minutes-issuance.test.ts` (4 — document row, PDF bytes, `minutes_doc_id`, redirect
  contract), `report-filter-labels.test.ts` (4 — all four id-valued filters, one id and
  several, plus the filtered report itself), and two new guards in
  `no-revalidate-in-actions.test.ts` (no inline action ends without a redirect or a
  returned result; no `redirect()` target is distinguished only by a fragment).
- Earlier figure, superseded: **1139/1139 across 112 files** plus production build
  success in the same gate. 97 new tests across 9 new files:
  `report-instances` (13: lifecycle, raw-SQL trigger refusals, snapshot frozen while
  source data changes, filter isolation, D-013, archive search),
  `report-outputs` (8: idempotent outputs, job lifecycle to verified ZIP, one-active-job,
  stale takeover, signed-copy ZIP), `export-full-rows` (3: the v2.5.0 defect),
  `v260-security` (11), `report-instances-pure` (25), `report-instance-render` (13),
  `report-instance-exports` (14: DOCX XML inspection, XLSX read-back, ZIP corruption/
  traversal), `identity-v26` (10 incl. filesystem scan), plus e2e
  `zzzzz-v260-archive.spec.ts` (7 browser scenarios, green twice incl. a fresh-DB
  determinism run). The 11 pre-existing Playwright failures documented on the v2.5
  branch are unrelated and untouched.

### Every Playwright test accounted for

The suite is **132 tests in 24 files**. The readiness bar is not "mostly green" — it is
zero failed, zero *did not run*, and every skip named with its reason:

| Outcome | Count | Which, and why |
|---|---|---|
| Passed | 130 | — |
| Failed | 0 | — |
| Did not run | 0 | Previously 11. Serial-mode describes abort at the first failure, so a single early failure hid everything after it |
| Skipped | 2 | Both intentional and named below |

The two skips:

1. `https-pwa.spec.ts` — «عبر HTTPS الفعلي: سياق آمن وعامل الخدمة والكاميرا متاحان (C5)».
   Guarded by `test.skip(!baseURL?.startsWith("https://"))`. Secure-context APIs cannot be
   exercised over plain HTTP; the test runs only when the suite is pointed at the Tailscale
   HTTPS origin. C5 itself is **DEFERRED_BY_PRODUCT_OWNER** (D-018), so this skip is the
   correct behaviour, not a gap.
2. `zzzz-v250.spec.ts` — «رفع مرشّح واحد من عدة يحدّث النتائج (D-066 — عطل مفتوح)».
   A `test.fixme` deliberately kept *in* the suite: it is a written, runnable reproduction
   of an open defect (§13). Deleting it would erase the evidence; leaving it failing would
   make the gate meaningless. It is reported as a skip on every run, by design.

**Two CI-only flakes, both found and closed** — the same failure mode twice: a fixed
duration standing in for a real signal, which holds on a fast machine and breaks on a
contended one. Neither is a product defect and neither expectation was weakened.

*Second one:* the mobile drawer test waited `waitForTimeout(350)` for the slide-in
animation, then measured the panel. On a loaded runner it caught the drawer mid-slide —
right edge at 402 px instead of ≤ 391 — and failed the gate on runner speed. Every such
sleep in `mobile.spec.ts` is now a settle wait (`expect(...).toPass`) that re-measures until
the panel is actually at rest. Same edge, same bounds, same assertions.

*First one:* Commit `0503cea` passed the push-triggered run
(130/0/0/2 in 10.6 min) and *failed twice* on the pull-request-triggered run of the same
commit — both times on س5's first navigation to `/building`, both times exceeding the 300 s
per-test cap, in runs that took 15.4 and 16.2 minutes doing identical work. The cause is the
runner, not the product: CI runs `next dev`, so the first visit to each route compiles on
demand, and the building route (Konva + three.js) is the heaviest in the platform. All six
desktop scenario budgets are now 600 s. **No assertion changed** — only the patience. A gate
that turns red on runner contention is not a gate, and "it passed on the other trigger" is
not an answer.

**Vitest skips, also accounted for.** Locally `npm test` reports **1184 passed**; in CI it
reports **1181 passed | 3 skipped**. The three are one `describe.skipIf(!hasFares)` block in
`official-models.test.ts` that parses the *real* «بيانات الموظفين في فارس.xlsx». That file
lives in git-ignored `reference_files/` because school and personal data is never committed,
so CI cannot have it and correctly skips the block; on this workstation the file is present
and all three run. The skip is the safety rule working, not a coverage gap.

The state-dependent `test.skip` guards in `workflows.spec.ts` (`!state.person1Id`, and so
on) no longer skip anything: they existed to keep the mobile scenarios from failing
confusingly when an earlier scenario had not produced their data. Now that س1–س7 all pass,
the data exists and all twelve run. That is why the skip count fell from 8–9 to 2.

## 6) CI (first pipeline for this repository)

`.github/workflows/ci.yml` — **all seven jobs green on the final SHA `cac78d5`, on both
triggers**, which is the bar this release now holds itself to:

| Trigger | Run | E2E | Vitest |
|---|---|---|---|
| `push` | [31272025498](https://github.com/FHALFAIFI/alkhashah-school-platform/actions/runs/31272025498) | 130 passed · 0 failed · 0 did not run · 2 skipped (10.8 m) | 1181 passed · 3 skipped (1184) |
| `pull_request` | [31272027010](https://github.com/FHALFAIFI/alkhashah-school-platform/actions/runs/31272027010) | 130 passed · 0 failed · 0 did not run · 2 skipped (11.7 m) | 1181 passed · 3 skipped (1184) |

Both triggers are recorded deliberately: on the previous commit they disagreed, and a
release verified on only one of them is a release verified by luck.

| Job | Contents |
|---|---|
| Lint + typecheck | eslint 0, tsc 0 |
| Unit + integration | full vitest vs a fresh Postgres 16 service; Chromium installed for PDF tests |
| Migration safety | `drizzle-kit check` + clean install (ledger asserted) + the v2.5.0 upgrade rehearsal |
| Production build | `next build` |
| End-to-end | the **full** Playwright suite — the job that had never finished |
| Performance audit | §J targets, fails the job on a miss |
| Sample artifacts | `scripts/v260-ci-artifacts.ts` — 9 synthetic reports; uploads `v26-report-samples` (~4.7 MB): PDF/DOCX/XLSX/verified-ZIP + print HTML + full-page screenshots per sample |

Artifacts contain only fabricated Arabic data; no secrets are used anywhere in the
pipeline beyond throwaway service credentials.

The E2E job now also uploads `playwright-report/results.json`. The line reporter's
"8 skipped" says nothing about *which* tests skipped or why; the readiness criterion is
that every skip is named and justified, so the machine-readable result list is kept with
the report artifact.

## 7) Performance (§J)

`scripts/v260-perf-audit.ts` (median of 5 after warm-up, synthetic dataset):

| Measure | Result | Target |
|---|---|---|
| Single-report preview rebuild | 11 ms | ≤3 000 ms |
| Periodic multi-section preview | 27 ms | ≤3 000 ms |
| Archive search | 3 ms | ≤2 000 ms |
| Frozen-snapshot render | <1 ms | ≤2 000 ms |
| DOCX / XLSX generation | 17 / 5 ms | background |
| PDF generation (Chromium) | 1 241 ms | background (D-059) |
| 5 100-row stress preview | 83 ms, truncation declared | ≤3 000 ms |

## 8) Defects discovered and fixed

1. **v2.5.0 export row loss (severe, shipped in production):** every export beyond 200
   rows was silently incomplete — `runReportForExport` passed through `paginate`, whose
   `clampPageSize` caps at the *screen* page size (200), while the truncation flag only
   raises above 5 000. Invisible at production volume (~30 rows). Fixed (export sorting
   no longer passes through pagination clamping; screens keep paging); pinned by
   `tests/integration/export-full-rows.test.ts`. **This fix alone materially improves
   the deployed v2.5.0 behavior.**
2. `searchInstances` did not itself require `reports.read` (page guard only) — found by
   its own security test; hardened at the service layer.
3. Two implementation-time catches (options salvage per key; CSS-class false positive in
   a test) fixed before commit.
4. **The six defects in §5a**, all found later, by making the E2E suite run to the end.
   Five are fixed; D-066 is open and disclosed in §13.

## 9) Word validation status

- **Automated (done):** DOCX unzipped and XML-inspected (bidi runs, landscape section
  size, repeated-header markers, header/footer parts, PAGE fields, draft stamp vs
  report number); **LibreOffice Writer** converted the hardest sample (13-column
  landscape + identity header) to a 13-page PDF with correct RTL column order, headers
  and page numbers — visually verified.
- **Interactive Microsoft Word (pending, human):** Word is installed on this
  workstation, but its first-run dialog blocks scripted AppleEvents (two attempts timed
  out; Word was closed again, nothing saved). Remaining manual step: open
  `storage-ci-artifacts/*/‏*.docx` (or the CI artifact bundle) in Word once and confirm
  layout/editability. The RC explicitly carries this as **pending**.

## 10) RC image — and exactly what has and has not been proven about it

The image is built **off the production host** by `.github/workflows/rc-image.yml` on a
GitHub runner (the only machine here with Docker is the one serving 3080, and the v2.5.0
record documents that building there OOM-killed the production container five times).
Each push to the branch builds `linux/arm64` from `Dockerfile.production`, pushes it to
GHCR, and records the immutable digest in the `v26-rc-image-record` artifact.

**Proven** — on a runner-native **amd64** build of the same Dockerfile and the same
`RELEASE_COMMIT`: migrations apply to ledger 37 on an isolated Postgres, the container
boots, `/api/health` returns `status ok · db up · version 2.6.0` **and the exact commit**
(newly enforced — an image built from another commit now fails the job rather than the
swap), and `/login` renders.

**Not proven, and not claimed** — that the pushed **arm64** binary runs. It has never been
executed. Proving it is the **first mandatory pre-swap gate**: pull the final digest on the
Mac mini, confirm `docker inspect` reports `arm64/linux`, run it against an isolated
database on port 3099, check health and login, and **abort before touching 3080** if pull,
migration, boot, health or login fails. Commands: `RUNBOOK.md` §«البوابة الأولى الإلزامية».
Not performed — it requires deployment authorization from Fahad.

**Digest discipline.** `0.1.0-v2_6_0-rc` is a moving tag re-pushed on every branch push, so
it must never be deployed on its own. Three digests now exist; only the last is deployable:

| Digest | Commit | Status |
|---|---|---|
| `sha256:3d331c03…` | `28f007f` | dead — predates every product fix in §5a |
| `sha256:8d4c032f…` | `0503cea` | dead — that commit was green on the push trigger and red twice on the pull-request trigger |
| **`sha256:4101f25a…`** | **`cac78d5`** | **current** — all seven jobs green on **both** triggers; health reports `commit: cac78d5` |

## 11) Deployment and rollback (prepared, NOT executed)

Full commands in `RUNBOOK.md` §«المرشَّح القادم — v2.6.0»: build RC image → encrypted
pre-deploy backup + isolated restore verification → tag rollback image → migrate-only
`init` (34 → 36, database container never restarted) → app swap → health check → the
v2.6 smoke list (archive flow, numbering idempotency, background outputs, print
preview without «مكتب التعليم», D-013 hiding, D-055 refusals). Rollback: retag
`0.1.0-prev-v2_6_0-<date>`, app-only recreate, **no database action**.

## 12) Remaining manual acceptance

1. **ARM64 runtime gate on the Mac mini** — the first step of the RUNBOOK sequence, before
   anything touches 3080. Requires deployment authorization. Not performed.
2. Owner authorization to deploy; then the rest of the RUNBOOK sequence.
3. Interactive Microsoft Word open of the sample DOCX files (§9).
4. Principal's acceptance pass on the deployed environment (as every release).
5. Owner's authenticated production smoke from v2.5.0 remains outstanding as before.

## 13) Known open defects carried by this branch

- **D-066** — removing one value from a multi-value report filter leaves the results stale
  until reload. Reproduced on the production build; cause is Next 16.2.12's client router
  cache (no RSC request is issued for the new URL). `router.refresh()` after the push was
  tried and *aborted the navigation itself*, and `experimental.staleTimes` has no setting
  that suppresses the reuse. The scenario stays in the suite as `test.fixme` so it is
  reported on every run. **Workaround for the principal:** «مسح الفلاتر» then re-select, or
  reload the page.
- Everything else found in this pass is fixed; see §5a.
