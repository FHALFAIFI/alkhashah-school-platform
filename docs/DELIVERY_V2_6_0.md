# DELIVERY v2.6.0 — the reporting platform

> RC readiness report for the v2.6.0 scope on branch `feat/v2.6-reporting-platform`
> (Draft PR #1), built on the deployed v2.5.0 baseline. Specification:
> `docs/requirements/v2.6-reporting-platform-specification.md`. Decisions **D-055…D-060**
> in `docs/DECISIONS.md`. Deployment sequence and rollback (prepared, **not executed**):
> `RUNBOOK.md` §«المرشَّح القادم — v2.6.0».

## 1) Executive verdict

**RC READY — AWAITING DEPLOYMENT AUTHORIZATION.** The scope is implemented, the last
open product defect is fixed, and every automated gate is green on both CI triggers on
the same SHA. What remains is manual and requires Fahad: nothing below can be closed by
an agent.

| # | Remaining gate | Kind |
|---|---|---|
| 1 | **ARM64 runtime smoke on the Mac mini** — pull the final digest, run it against an isolated database on a temporary port, verify migration, boot, health, login and rollback readiness, and abort before touching 3080 on any failure. **The first mandatory pre-swap gate.** Never performed: it requires deployment authorization. | Blocking, manual |
| 2 | Interactive Microsoft Word open of the sample DOCX files (§9). | Human |
| 3 | Owner authorization to deploy, then the rest of the RUNBOOK sequence. | Human |
| 4 | Principal's acceptance pass on the deployed environment. | Human |

**Why the verdict moved back to ready.** The previous cycle ended NOT READY on one open
product defect (D-066) and an unfinished argument about its cause. That cause has now been
found — and it was **ours, not the framework's**. Fixing it also exposed a second defect in
the approved scope that no test had ever reached (§5b). Both are fixed, both are pinned, and
the full Playwright suite now runs to the end with nothing hidden.

**What has *not* been proven, stated plainly.** The pushed `linux/arm64` binary has never
been executed anywhere. The CI runtime smoke builds a **runner-native amd64** image from the
same Dockerfile and the same `RELEASE_COMMIT`; it proves the *code* migrates, boots and
answers health with the right version and commit. It does not prove the arm64 image runs.
That is gate 1 above.

**Production was not touched.** Port 3080, the `madrasa-prod` containers, database, volumes
and configuration were never read from or written to by this work. Every database used was
isolated and fail-closed non-production (`madrasa_test`, `madrasa_ci_test`,
`madrasa_upgrade_test`, `madrasa_clean_test` — names the test guard enforces). No image was
built on the host serving production; the RC is built on a GitHub runner.

**Deploy by immutable digest, never by the tag.** `0.1.0-v2_6_0-rc` is re-pushed on every
branch push. The digest for the final SHA, the two CI run URLs and the RC build run URL are
recorded in **PR #1** — they are per-run values that cannot exist inside the commit that
produced them, so the pull request is their home and it is updated the moment those runs
finish. Superseded digests are listed in §10 and must never be deployed or cited.

## 2) Branch and commits

Base `0488f1a` (= `main` = v2.5.0 docs tip; tag `v2.5.0` @ `39674ed`).
Final SHA: the head of `feat/v2.6-reporting-platform`, recorded in PR #1 — the commit that
carries this document. Ledger against the base: **36 commits, 121 files changed,
+50192 / −241 lines**.

The eleven commits that built the scope:

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

The rest are the CI repairs, the six product defects of §5a, the two of §5b, and the
documentation.

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

## 5b) Two more production defects, found by root-causing D-066

**D-066 — a multi-value filter was written as a repeated query key, and the router cannot
tell two such URLs apart.** Removing one value while others remained left the table and
«عدد النتائج» on the previous selection until reload. The previous cycle measured that no
render request was issued at all and concluded the cause sat inside the framework's client
cache, out of reach. That was wrong, and the correction matters: the App Router identifies a
page by a key built from `JSON.stringify(searchParams)`, and both sides build that object
with `Object.fromEntries(new URLSearchParams(search))`, which **keeps only the last
occurrence of a repeated key**. `?domain=أ&domain=ب` and `?domain=ب` are therefore the same
page to the router — it reuses the mounted tree and never asks the server.

That also explains the asymmetry that made the defect look erratic, and which the first
investigation recorded without explaining: only a change that moves the *last* occurrence
changes the key, so adding worked, removing the last value worked, and removing the first or
a middle value did not.

The fix is in this codebase, not in a workaround: a multi-value filter is now **one**
parameter whose value is the list, separated by U+001F — a control character that cannot
occur in an Arabic name typed by the principal or in a UUID, so no value can be split by
accident and no saved link breaks (reading still accepts the old shape). `LIST_SEPARATOR`
and its four helpers in `src/lib/reports/filters.ts` are the single definition; the filter
panel, the report builder, `serializeReportFilters`, `templateRunHref`, `storedToParams` and
the snapshot section merge all go through them. The **stored** shape is unchanged — arrays,
byte-identical — so saved templates and frozen instances need no migration. A legacy URL
that still carries repeated keys is canonicalised by a **server** redirect before rendering;
a first attempt did this in a client effect and it raced with the user's own navigation.

The same defect class silently broke **column ordering in the report builder**: moving any
column other than the last one, or hiding any column other than the last one, changed the
URL and left the list exactly as it was.

**D-068 — «التصنيف» and the reports centre's `category` were the same parameter.** The
reports centre carries the report *category* in `?category=…`; the record-classification
filter declared the same name. Every report opened from the centre was therefore filtered by
a value nobody chose. Only one report in the catalogue declares that filter — **«بلاغات
الصيانة»**, the one the principal opens after every inspection round — so it returned an
**empty register however many issues existed**, with a meaningless «التصنيف: building» chip
above the emptiness explaining it. No test caught it because the e2e database has no
maintenance issues, so the report was empty for an unrelated reason. The filter moved to
`recordCategory`.

**A third, smaller one, found while proving the first:** the session-filter restore ran once
per *mount*, so after «مسح الفلاتر» a remount re-applied — and `router.replace`d back — a
filter the user had just removed. It now runs once per key per browsing session.

Records: **D-066** (rewritten with the mechanism, the transition table, and why the
separator is a control character) and **D-068** in `docs/DECISIONS.md`.

## 5c) The corrective round after the ARM64 gate (2026-08-09) — D-069 and the D-068 acceptance condition

The isolated ARM64 gate on the Mac mini reopened the release with three browser scenarios
failing over **direct HTTP/1.1** while passing over HTTP/2: the finalize badge never
appeared without a manual reload, «مستبعد» never became visible after excluding an import
row, and an in-app navigation stalled. The owner rejected both proposed waivers (HTTP/2 as a
prerequisite; the empty-category URL as unreachable) and authorized fixing both. Both are
fixed, and the root cause turned out to be the most consequential finding of the release:

**D-069.** The post-action `router.refresh()` (the D-053 pattern used by every form in the
platform) was being **silently discarded by the client router in production builds** — the
server answered 200 with a complete, well-formed flight body (proven by replaying the exact
request headers, and by a deliberately-slow reader that ruled out server-side truncation),
yet the DOM did not update and Chrome logged `net::ERR_ABORTED` for the cancelled tail. It
applied in roughly 2 of 6 attempts, by timing luck; always in `next dev`; practically always
over HTTP/2. The trigger is an upstream Next.js 16.2 defect (vercel/next.js#86151, fixed in
16.3 only): a `loading.tsx` boundary in the tree causes a refresh that lands near a server
action's settlement to be dropped. This platform had exactly one — `(app)/loading.tsx`,
covering every page. **This retroactively explains the entire «الواجهة لا تتحدث بعد الحفظ»
lineage**: the v2.2.1 known issue, and the v2.3 "never run e2e against host `next start` —
it aborts Server-Action streams (environment quirk)" note. It was never an environment
quirk. Four changes shipped together (full record: D-069 in `docs/DECISIONS.md`):
removal of `(app)/loading.tsx`; `prefetch={false}` on all 84 app links (+`LinkButton`) to
kill the per-action refetch storm of every in-viewport link (vercel/next.js#93210);
a verified refresh (per-render `data-render-stamp` in the app layout, bounded 3-attempt
retry in the `useRefresh*` hooks); and refresh-independent visible outcomes — import row
decisions return the new status and publish it to a client-side store that both renderings
of the row read (~60 ms to a visible «مستبعد»), and the §I generation watcher now polls a
lightweight authenticated JSON endpoint (`/api/reports/instances/[id]/job`) with no
overlapping requests, an explicit timeout and error state, cleanup on unmount, and exactly
one verified refresh at the terminal state, rendering the outcome client-side from the poll
payload. As a consequence, the full Playwright suite now runs green against the
**production** build over plain HTTP/1.1 (`E2E_EXTERNAL=1` vs `next start`) — previously
impossible, now part of the evidence.

**D-068 acceptance condition.** `?category=&report=maintenance-register` — in both
parameter orders — now opens the maintenance register correctly: an explicit `report` key is
resolved independently against the catalog, its declared category is derived when the
supplied one is empty or absent, and the request is redirected to the canonical URL. Five
cases are distinguished (no report; valid report with its category; valid report with empty
category; unknown report key; report/category mismatch — the safe existing behaviour).
Pinned by a dedicated e2e block proving, for each rendering case, the register title, a
seeded row, the exact count, and the absence of any phantom «التصنيف» chip.

**Framework: Next.js 16.2.12 → 16.3.0.** The first corrective commit went red on both CI
triggers at a plain sidebar navigation issued right after a login action — CI runners only,
never locally. That is the second half of the D-069 upstream defect: a navigation
dispatched while a server action is settling is discarded by the router's action queue,
fixed upstream only in 16.3.0 (vercel/next.js#95391) and unhittable on fast machines. The
upgrade takes the real fixes for both halves; every app-level change of this round is
retained on top of it, and `loading.tsx` stays removed this release to keep the validated
delta minimal. Full record: the addendum under D-069 in `docs/DECISIONS.md`.

## 5) Tests

- Baseline at branch: **1042/1042** across 103 files (verified green before work).
- **Current: 1203/1203 across 118 files** (`npm test`) — the figure to quote. In CI the
  same suite reports **1200 passed · 3 skipped**; the three are one
  `describe.skipIf(!hasFares)` block in `official-models.test.ts` that parses the *real*
  «بيانات الموظفين في فارس.xlsx». That file lives in git-ignored `reference_files/` because
  school and personal data is never committed, so CI cannot have it and correctly skips the
  block; on this workstation the file is present and all three run. The skip is the safety
  rule working, not a coverage gap.
- The +19 over the previous 1184 are this cycle's regression tests: 19 in
  `report-filter-list-params.test.ts` — the encoding round-trip (including values that
  contain commas, pipes and colons), the collapse asserted directly against
  `Object.fromEntries`, a distinct page key for removal at the first, middle and last
  position, the unchanged stored shape, a scan that fails if any source file writes a
  repeated key with `for (… of values) sp.append(…)`, and the three D-068 pins.

### Every Playwright test accounted for

The suite is **141 tests in 25 files**. The bar is zero failed, zero *did not run*, and
every skip named:

| Outcome | Count | Which, and why |
|---|---|---|
| Passed | 140 | — |
| Failed | 0 | — |
| Did not run | 0 | — |
| Skipped | 1 | Intentional, named below |

**The one skip:** `https-pwa.spec.ts` — «عبر HTTPS الفعلي: سياق آمن وعامل الخدمة والكاميرا
متاحان (C5)», guarded by `test.skip(!baseURL?.startsWith("https://"))`. Secure-context APIs
cannot be exercised over plain HTTP; the test runs only when the suite is pointed at the
Tailscale HTTPS origin. C5 itself is **DEFERRED_BY_PRODUCT_OWNER** (D-018), so this skip is
the correct behaviour, not a gap.

**The second skip is gone.** `zzzz-v250.spec.ts`'s «رفع مرشّح واحد من عدة يحدّث النتائج» was
a `test.fixme` holding an open defect's reproduction. D-066 is fixed, so it is now a real
test and it passes.

**The nine new browser scenarios** (`zzzzz-v260-filters.spec.ts`) each drive the real UI and
check the whole effect — the URL, every checkbox, every chip, the table rows, the result
count, and that the document was never reloaded (a `load`-event counter; a reload would hide
the defect rather than fix it): owner and domain single→zero, multi→single removing the
**first**, the **middle** and the **last** value, multi→zero by «مسح الكل» and by
«مسح الفلاتر», removal from the chip and from the checkbox, both filters together (removing
one must not disturb the other), browser back and forward restoring filters *and* results,
direct URL load in both the new and the legacy repeated-key shape, and column reorder/hide
in the builder.

**Three CI-only timing defects, all closed the same way** — a fixed duration standing in for
a real signal, which holds on a fast machine and breaks on a contended one. No assertion was
weakened in any of them.

*Third (this cycle):* `cleanup.spec.ts` navigated with `waitUntil: "networkidle"` and timed
out at 60 s on the **pull-request** runner while the identical commit passed on the **push**
runner. `networkidle` is not a readiness signal — it is a 500 ms quiet window, and it may
never occur on a runner that compiles the route on demand. The navigation now waits for
`load`, and readiness is the four elements the test already asserts. Its cap was raised to
180 s because CI runs `next dev` and this screen counts every record group before it renders;
a cap is not a wait.

*Second:* the mobile drawer test waited `waitForTimeout(350)` for the slide-in animation and
caught it mid-slide on a loaded runner. Every such sleep in `mobile.spec.ts` is now a settle
wait (`expect(...).toPass`) that re-measures until the panel is at rest.

*First:* commit `0503cea` passed the push run and failed twice on the pull-request run of the
same commit, both times exceeding the 300 s per-test cap on the heaviest route. All six
desktop scenario budgets are now 600 s.

**One harness property, recorded rather than hidden.** Under machine-speed clicking a
pointer event is occasionally lost while the server-rendered tree is being replaced — the URL
simply does not change. The filter scenarios click once, wait up to eight seconds for the
URL, and click at most one more time; every assertion after that is unchanged, and a control
that genuinely did nothing would still fail. This predates this work and is not reachable at
human clicking speed.

## 6) CI (first pipeline for this repository)

`.github/workflows/ci.yml` — the bar this release holds itself to is **all seven jobs green
on the final SHA, on both triggers**, with these counts:

| Trigger | E2E | Vitest |
|---|---|---|
| `push` | 140 passed · 0 failed · 0 did not run · 1 skipped | 1200 passed · 3 skipped (1203) |
| `pull_request` | 140 passed · 0 failed · 0 did not run · 1 skipped | 1200 passed · 3 skipped (1203) |

The two run URLs for the final SHA are in **PR #1**: a run URL cannot exist inside the
commit that produced it, so the pull request is where per-run evidence lives and it is
updated as soon as both runs finish.

Both triggers are recorded deliberately: on an earlier commit they disagreed — green on
push, red twice on pull-request — and a release verified on only one of them is a release
verified by luck. It happened again this cycle: the `pull_request` runner failed
`cleanup.spec.ts` on a `networkidle` wait while the `push` runner passed the identical
commit (§5).

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
4. **The six defects in §5a**, all found by making the E2E suite run to the end. Five were
   fixed there; the sixth, D-066, is fixed in §5b.
5. **The two defects in §5b**, found by root-causing D-066 rather than accepting it:
   D-066 itself (multi-value filters, and column ordering in the builder, which failed the
   same way), and **D-068** — «بلاغات الصيانة» returned an empty register whenever it was
   opened from the reports centre, because the filter shared a parameter name with the
   navigation. Plus the session-filter restore that re-applied a filter the user had just
   removed.

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
| `sha256:8d4c032f…` | `0503cea` | dead — green on the push trigger, red twice on the pull-request trigger |
| `sha256:4101f25a…` | `cac78d5` | dead — predates the D-066 and D-068 fixes of §5b |
| `sha256:…` | `ff36887` | dead — the code fix, but `cleanup.spec.ts` failed on the pull-request trigger (§5) |
| `sha256:413b90d9…` | `25cc24c` | **superseded** — passed the first ARM64 gate but failed the reopened gate's HTTP/1.1 browser scenarios and the empty-category acceptance condition; replaced by the corrective round (§5c, D-069). Preserved as historical evidence only — never deploy or cite. None of its candidate-specific runtime, document, or functional evidence carries over |
| **final** | **head of the branch** | **current** — built from the corrective commit; recorded in PR #1 with its run URL and embedded-commit proof |

Every digest above the last is superseded and must never be deployed or cited. The current
one is identified by digest in PR #1 rather than here, for the same reason as the run URLs:
the image is built *from* this commit, so its digest cannot be inside it.

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

**None.** D-066 was the last one, and §5b closes it together with D-068 and the
session-restore defect it exposed. Everything found in either pass is fixed and pinned;
see §5a and §5b.
