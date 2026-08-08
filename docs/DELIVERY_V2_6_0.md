# DELIVERY v2.6.0 — the reporting platform

> RC readiness report for the v2.6.0 scope on branch `feat/v2.6-reporting-platform`
> (Draft PR #1), built on the deployed v2.5.0 baseline. Specification:
> `docs/requirements/v2.6-reporting-platform-specification.md`. Decisions **D-055…D-060**
> in `docs/DECISIONS.md`. Deployment sequence and rollback (prepared, **not executed**):
> `RUNBOOK.md` §«المرشَّح القادم — v2.6.0».

## 1) Executive verdict

**RC READY — AWAITING DEPLOYMENT AUTHORIZATION.**

All code-addressable scope is implemented and green: full local suite, first-ever CI
pipeline fully green (quality, tests, migration safety, production build, synthetic
artifacts), browser e2e 7/7 twice, migration upgrade rehearsal from the real v2.5.0
set, DB-level immutability proven by raw-SQL refusal, performance within the §J targets
at representative and stress scale, and mixed-orientation Arabic output proven in the
generated files themselves.

Two items remain that genuinely require a human or the deployed environment, and only
those: **(a)** opening the sample DOCX files in interactive Microsoft Word (Word is
installed on this workstation but its first-run dialog blocks scripted AppleEvents;
LibreOffice full-fidelity conversion + OOXML structural inspection stand as automated
evidence), and **(b)** the owner-authorized deployment itself with the principal's
acceptance on the deployed environment.

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
62 files changed, ~32,700 insertions across 11 commits:

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

## 5) Tests

- Baseline at branch: **1042/1042** across 103 files (verified green before work).
- Final: **1139/1139 across 112 files** (`npm test`, 2026-08-08) plus production build
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

## 6) CI (first pipeline for this repository)

`.github/workflows/ci.yml` — all jobs green on `9d20137`'s predecessor run and the PR
run (run 31234357345 / 31234359591):

| Job | Contents |
|---|---|
| Lint + typecheck | eslint 0, tsc 0 |
| Unit + integration | full vitest vs a fresh Postgres 16 service; Chromium installed for PDF tests |
| Migration safety | `drizzle-kit check` + clean install (ledger 36 asserted) + the v2.5.0 upgrade rehearsal |
| Production build | `next build` |
| Sample artifacts | `scripts/v260-ci-artifacts.ts` — 9 synthetic reports; uploads `v26-report-samples` (~4.7 MB): PDF/DOCX/XLSX/verified-ZIP + print HTML + full-page screenshots per sample |

Artifacts contain only fabricated Arabic data; no secrets are used anywhere in the
pipeline beyond throwaway service credentials.

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

## 10) RC image

**Deliberately not built in this session.** The production target is linux/arm64 built
on the Mac mini, and the v2.5.0 deployment record documents the host OOM-killing the
production app container five times during an RC build on this same machine. The build
command (with `RELEASE_COMMIT`) is step 1 of the RUNBOOK sequence, to be run at
deployment time with memory freed — or on another host. CI proves the production build
compiles; no image digest is therefore recorded yet.

## 11) Deployment and rollback (prepared, NOT executed)

Full commands in `RUNBOOK.md` §«المرشَّح القادم — v2.6.0»: build RC image → encrypted
pre-deploy backup + isolated restore verification → tag rollback image → migrate-only
`init` (34 → 36, database container never restarted) → app swap → health check → the
v2.6 smoke list (archive flow, numbering idempotency, background outputs, print
preview without «مكتب التعليم», D-013 hiding, D-055 refusals). Rollback: retag
`0.1.0-prev-v2_6_0-<date>`, app-only recreate, **no database action**.

## 12) Remaining manual acceptance

1. Owner authorization to deploy; then the RUNBOOK sequence on the Mac mini.
2. Interactive Microsoft Word open of the sample DOCX files (§9).
3. Principal's acceptance pass on the deployed environment (as every release).
4. Owner's authenticated production smoke from v2.5.0 remains outstanding as before.
