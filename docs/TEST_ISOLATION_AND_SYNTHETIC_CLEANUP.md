# Test Isolation, Fail-Closed DB Guard, Type-Aware Imports & Synthetic-Record Cleanup

Session date: 2026-07-17. Language: English per repo policy (Arabic strings quoted inline).

This document records three safety/correctness changes and their verification. **No real
data was modified.** The committed official plan batch `385c615a` (منفذة) and the Fares
people batch `12673bed` («بيانات الموظفين في فارس.xlsx», معاينة) are untouched. All seeding
and tests ran against the isolated `madrasa_test` database only.

---

## 1. Type-aware import confirmation

**Problem.** The import commit-confirmation dialog always displayed employee labels
(«عدد المعلمين», «عدد الموظفين») regardless of import type. For an operational-plan import
this is wrong and misleading.

**Fix.**
- New pure builder `src/lib/imports/confirm-summary.ts` → `buildConfirmSummary(importType, readyRows, excludedCount)`.
  - `operational_plan` → title «تأكيد استيراد الخطة التشغيلية…» and plan counts:
    «البرامج والمبادرات», «المخرجات المطلوبة», «مؤشرات الأداء», «سجل المخاطر», «بنود الميزانية»
    (+ «الصفوف المستبعدة» only when >0). **Never** shows employee labels.
  - `people` → title «تأكيد استيراد بيانات الموظفين…» and «عدد المعلمين/الموظفين/المستبعدين» (unchanged).
- `src/app/(app)/imports/[id]/page.tsx` computes the summary and passes `confirmTitle` +
  `confirmItems` to `BatchActions`; `batch-ui.tsx` renders the items generically.

**Verification.** `tests/unit/import-confirm-summary.test.ts` (3 cases) asserts plan batches
show plan counts and contain no employee labels. Green.

---

## 2. Fail-closed test-database isolation

**Root cause of the pollution.** Playwright e2e drove `npm run dev`, which reads `.env`
→ the **real** `madrasa` DB. Scenario runs therefore wrote «تجريبي آلي» records into the
real dev database (58 programs where only 26 are official; dozens of synthetic batches).

**Fix.**
- `src/db/guard.ts` — fail-closed guard. When `MADRASA_ENV=test`, the DB name in
  `DATABASE_URL` must end in `_test` (e.g. `madrasa_test`); otherwise it throws **before any
  connection opens**. Ambiguity (missing/invalid URL) → refuse. `assertConnectionSafety` is
  called at pool creation in `src/db/index.ts`; it is inert outside test mode (dev/prod
  unaffected).
- Vitest: `tests/helpers/setup-env.ts` now sets `MADRASA_ENV=test` and asserts the test DB
  before any module import. `tests/helpers/test-db.ts` migrate subprocess also sets `MADRASA_ENV=test`.
- Playwright (`playwright.config.ts`): dedicated **port 3081**, `reuseExistingServer:false`
  (never reuse the real :3080 dev server), dedicated `STORAGE_DIR=storage-e2e`, and the
  webServer runs with `MADRASA_ENV=test DATABASE_URL=…/madrasa_test`. `tests/e2e/global-setup.ts`
  ensures + migrates + truncates + seeds the isolated DB into `storage-e2e`, then creates a
  synthetic Fares **stand-in** batch (`scripts/e2e-fixtures.ts`, fully fabricated, no real PII)
  so the «حرمة دفعة فارس» scenario runs in isolation. E2e credential reads now honor
  `E2E_STORAGE_DIR`. `MADRASA_INCLUDE_SYNTHETIC=1` is set for the e2e server so scenario data
  (synthetic by design) stays visible for workflow assertions.

**Verification.**
- `tests/unit/db-guard.test.ts` (6 cases): real DB rejected in test mode; test DB accepted;
  empty/invalid URL rejected; `assertConnectionSafety` guards only in test mode and is inert
  otherwise. Green.
- Isolated-server boot proof: `next start -p 3081` with `MADRASA_ENV=test` +
  `DATABASE_URL=…/madrasa_test` served `/login` (HTTP 200) while the dev server stayed on
  :3080. global-setup pipeline produced `storage-e2e/private/initial-credentials.txt` and
  exactly one Fares stand-in batch (معاينة).
- Full `npm test` (vitest, unit + integration) runs against `madrasa_test`: **115 passed**.

**Local caveat.** Next 16 allows only one `next dev` per directory. If a dev server is
running locally, the e2e webServer (`next dev -p 3081`) cannot start; run e2e with the dev
server stopped or in CI. The guard remains the enforced safety boundary regardless.

---

## 3. Preview-only synthetic-record cleanup + exclusion

Requirement: identify synthetic records **not by name alone**, exclude them from dashboards,
reports, statistics and AI context, and provide a **preview-only** cleanup workflow that is
**not executed**.

**Classifier — `src/lib/synthetic.ts` (read-only, no schema change, no data mutation).**
Structural anchors (primary): import batches whose `sourceFileName` contains «تجريبي»
(provenance of a test upload — not the record's own name); plan years keyed `demo%`.
Propagation over foreign keys: synthetic people (batch) → their perf cycles/sessions;
synthetic programs (batch or demo year) → milestones/deliverables/docs/evidence; committees
whose **every** member is a synthetic person → meetings → outcomes; tasks sourced from a
synthetic outcome/program/session; documents & evidence linked to a synthetic entity;
maintenance owned by a synthetic person. Each candidate carries an Arabic structural reason.
Records whose name merely contains «تجريبي» but lack any structural anchor go into a separate
**«مشتبَه بهم بالاسم فقط»** bucket — **not** excluded, **not** archived.

**Exclusion (on by default; disabled only when `MADRASA_INCLUDE_SYNTHETIC=1`, i.e. e2e).**
`getExcludedIdSets()` + `notSynthetic(col, set)` applied to:
- Statistics: `dashboard/page.tsx` count tiles.
- Dashboard/work center: `src/lib/worklist.ts` (plan, committees, decisions, overdue tasks,
  evidence review, performance, maintenance sections).
- Reports: `src/lib/reports/executive-report.ts` (all module pulls).
- AI context: `src/lib/ai/tools.ts` — `search_records`, `overdue_programs`, `overdue_tasks`,
  `missing_evidence`, `upcoming_performance_sessions`, `open_maintenance_issues`,
  `dashboard_summary`.

**Preview page — `/admin/cleanup`** (`admin.settings`). Read-only. Shows: preview/no-execute
notice; exclusion status; a **preserved-and-safe** panel (total vs. preserved vs. synthetic
programs, preserved programs by plan year, real preview batches incl. Fares); structural
candidates grouped by type with reasons; the name-only-suspects bucket; and a described-but-
unwired confirmation step. **Cleanup is not executed.**

**Verification.**
- `tests/integration/synthetic.test.ts` (4 cases, isolated DB): synthetic people/programs
  flagged, real ones not; demo-year program flagged; committee with all-synthetic members and
  its meeting flagged structurally; a «تجريبي»-named program with no structural anchor lands in
  name-only suspects and is NOT excluded; `getExcludedIdSets` honors `MADRASA_INCLUDE_SYNTHETIC`.
- **Proof against the real polluted DB (read-only classify, no writes):**
  ```
  إجمالي البرامج: 58
  برامج مصنّفة اصطناعية: 32
  برامج محفوظة (غير اصطناعية): 26
  دفعة الخطة الرسمية 385c615a: منفذة — 26 برنامجاً — منها مصنّفة اصطناعية: 0
  دفعة فارس: معاينة — ضمن الدفعات الاصطناعية: false
  المشتبَه بهم بالاسم فقط: 0
  ```
  → Exactly the **26 official programs are preserved**, the Fares preview is **excluded from
  cleanup**, and every flagged record had a structural reason (0 name-only).

---

## Gates

- `npm run typecheck` — clean. `npm run lint` — clean. `npm run build` — clean (route
  `/admin/cleanup` present). `npm test` — 115 passed (isolated `madrasa_test`).
- Stopped at cleanup confirmation: no synthetic records were archived or deleted; no real
  data modified.

## Notes / follow-ups

- Rooms/assets have no structural anchor to people/batches; they are intentionally left for
  the principal's manual review (not auto-classified) and are documented on the cleanup page.
- `classifySynthetic()` runs per read-surface render; for a single-school dataset this is
  cheap. Per-request memoization is a possible future optimization.
