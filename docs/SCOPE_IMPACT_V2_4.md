# SCOPE IMPACT v2.4 — change map (Phase A output)

> Baseline: v2.3.0 (HEAD `b47558c`, deployed, production at migration 27/86).
> Brief: `docs/BRIEF_V2_4_0.md`. Branch: `scope-v2.4-post-acceptance`.
> Vitest baseline before changes: **682/682 green**; e2e baseline 72/1skip (v2.3 gate).

## Root causes of the confirmed defects

### P0-2 Weekly follow-up "all programs complete"
Not a presentation bug — a status-propagation chain:
1. `completeProgramAction` (`plan/actions.ts:299-310`) writes `executionStatus: "مكتمل"` —
   the lifecycle event overwrites the weekly-status vocabulary (test-locked, kept).
2. `/plan/followup` renders **current mutable state** (`page.tsx:89-93`), never the week's
   `program_followups` snapshot; completed programs are not distinguished from in-progress.
3. The weekly form pre-selects the sticky value (`followup-ui.tsx:41-45` fed from
   `p.executionStatus`) so one-click re-affirms «مكتمل» into the new week's snapshot.
4. `reopenClosedProgramAction` back-fills `completedAt` from `closedAt` for legacy rows —
   mass «مكتمل» without any weekly entry.
5. Ordering defect: latest follow-up is picked by `createdAt`, but `submitFollowupAction`
   **resets `createdAt` on every edit** (`onConflictDoUpdate`), so an edited old week
   outranks the current week.
6. Bonus: `progress` zod `coerce` turns an empty field into `0` — silent progress reset.

Fix: keep the domain vocabulary; make the weekly page week-aware (week selector, snapshot
of the selected week, «لم يتم التحديث هذا الأسبوع», change vs previous week, separate
closure/approval column, status groups per brief §7), fix the ordering key (order by
`weekKey`, stop resetting `createdAt`), fix the empty-progress coercion, and stop the form
from defaulting to «مكتمل». Rework `plan-followups` report loader to include all active
programs (left join) with the same distinctions.

### P0-1 Budget remaining balance
Mostly implemented in v2.3 (`src/lib/finance/calc.ts` single source, recomputed per
request, remaining/percent/near-exhaustion on /budget, item table, drill-down, dashboard).
Real gaps: (a) no `balanceBefore`/`balanceAfter` per transaction — the drill-down ledger is
cash-style from 0, not allocation-based; (b) `overrunWarning.remainingAfter` computed but
never rendered in the expense form; (c) `expense-register`/`all-operations` printable
reports lack remaining columns; (d) float arithmetic throughout (`calc.ts:32,39`);
(e) hard deletes (`deleteIncome/ExpenseAction`) leave no `record_versions` snapshot;
(f) ledger sort has no tie-break. Fix: integer-minor-units (halalas) internally in
`finance/calc.ts` (same external number API), allocation-based before/after in the ledger
+ expense tables, render remaining-after in the entry form, add report columns, snapshot
before hard delete, deterministic sort. No expense-status lifecycle is added — the current
domain excludes by `archivedAt` (+ income «ملغى»), which the brief's formula honors.

### P0-3 Sidebar
One CSS root cause: `lg:static` inside a `min-h-dvh` flex row → the aside stretches to
content height, its `overflow-y-auto` never engages, and window scroll-to-top on navigation
resets it. Fix (done): `lg:sticky lg:top-0 lg:h-dvh`; sessionStorage scroll retention via
ref (D-029 pattern); collapsible `<details>` sections (default open, user collapse
persisted, active section force-open); `aria-current="page"` + minimal `scrollIntoView` on
load. AppShell never remounts on client navigation, so in-session retention is free.

### P0-4 Evaluation-form deletion
Fully missing (no columns, no action, no UI; `perf_cycles.modelId` FK no-action blocks
naive deletes; ratings→indicators FK blocks the indicator cascade). Fix: migration 0027
additive `archived_at/by/reason` on `perf_models`; `src/lib/performance/model-admin.ts`
(linked-record counts incl. indirect paths, in-use rule, last-active-per-audience guard);
archive/restore/delete actions (audited, snapshotted, idempotent archive); archived forms
excluded from cycle creation and D-014 matching; archive filter in models list; history
safe via frozen `modelSnapshot`. **Permanent cascade delete of used forms is deliberately
not implemented** (not in §24 acceptance criteria; archive is the default; production
holds real evaluation data). Official ministry forms: hard delete refused, archive allowed
(unless last active for audience) — protects D-014 readiness machinery.

## P1 gap summary (from module maps)

- **Programs by employee/domain reports**: exist as counts-only; `programs.ownerPersonId`
  has no write path — owner is free-text `ownerPosition`. v2.4: grouped detail rows
  (names, status, progress, dates, evidence, delay, approval state) keyed by the free-text
  owner (no new assignment feature — domain unchanged), aggregates retained.
- **Program card**: `generateProgramCard` exists; access buried behind `reports.generate`
  on one page. v2.4: visible access points on program detail + list row menu.
- **Homepage approval queue**: worklist has no draft-program branch; add
  «بانتظار اعتماد المدير» dashboard queue (tabs: new drafts / completed awaiting closure /
  pending change requests), wired to real states, permission-gated, audited actions reused.
  Return-with-note: reuse `reopenProgramAction` (approved→draft with mandatory reason);
  a new reject state is NOT added (domain unchanged).
- **Committees detailed registry**: fully queryable except per-assignment execution status
  (no column — add nullable `status` to `committee_task_assignments`, additive) and
  results/impact (write-path removed in v2.1 §G3 — report the section only when historical
  rows exist). New report «سجل المجالس واللجان التفصيلي» + «بطاقة لجنة» generator; fix
  merged-members cells (one row per member).
- **Employee performance reports**: individual page gains cycle selector, per-criterion
  notes + evidence + weighted score, sessions log, acknowledgement/approval display, and a
  PDF export via the existing `employee_performance_report` doc type; school-wide report
  becomes an issuable document (new generator over `computeOverallAnalytics` + roster
  appendix), keeping the dashboard. D-013 guards unchanged.
- **Inspection→maintenance**: post-save offer (findings count + create all/selected/skip),
  dedup against open requests for same room+item, status shown on finding rows, inspection
  source on request detail, draft explains why letter unavailable + combined
  «اعتماد البلاغ وإصدار التقرير», letter content completed (reporter, approval, inspection
  source, requested action decoupled from `actionTaken`).
- **Shared header (P2)**: `officialPageHtml` is already the single PDF header; v2.4 turns
  page numbers on for all generators, adds doc identity to the Word path
  (`word-export.ts` + the 4 legacy docx routes), and passes identity everywhere. No
  per-report header duplication is introduced.

## Migrations planned (all additive, rehearse on clone)

- 0027: `perf_models` archive columns (done).
- 0028 (planned): `committee_task_assignments.status` nullable text — only if the detailed
  registry ships with task execution status.
- Sidebar/session state: no migration (browser storage only).

## Sequencing

Phase B (correctness) → C (program workflow/reports) → D (institutional reports/header) →
E (maintenance) → F (tests/security/perf/RTL) → G (image + clone rehearsal + report).
Production untouched throughout; deployment awaits explicit authorization.
