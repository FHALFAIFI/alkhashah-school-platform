# Scope-Impact Analysis — Principal Feedback, Scope v2.1 Corrections

**Date:** 2026-07-25
**Baseline commit:** `c866cb7` (Scope v2 Steps 1–14 delivered)
**Branch:** `scope-v2.1-corrections` (isolated from `main`; no commits to production path until verified + authorized)
**Status:** ASSESSMENT COMPLETE — implementation in dev/test in progress. **Production untouched.**

This feedback **supersedes conflicting Scope v2 requirements.** It is recorded as decisions
**D-024 … D-029** in `docs/DECISIONS.md`. The single largest change reverses **D-020**: activities
stop being the canonical progress unit and are **removed from the user-facing app**; the **program
itself** becomes the execution and follow-up unit. Legacy data is preserved unchanged; the change
is **application-layer only** — no destructive migration.

---

## 0. Method

Seven read-only subsystem audits mapped every affected file/line before any edit:
§1 activities/readiness · §2 weekly follow-up + evidence targets · §3 budget · §4 committees ·
§5 KPI planning session · §6 the `insertBefore` defect · §7 reports + `/pilot`. Findings below are
the reconciled result. Two cross-audit reconciliations were applied:

1. **`computePackageReadiness`** (deliverable "package readiness": required evidence *roles* →
   percentage + "missing" + a package-approval blocker) appears in both §1 and §2. It is an
   **evidence-target / readiness-percentage** mechanism, which §2 forbids → treated as **remove**,
   not "keep".
2. The **performance module's** per-indicator "required evidence" completion gate
   (`performance/actions.ts:434`) is *not* the operational-plan program evidence of §2, and §5
   explicitly **preserves** the planning session's evidence + signed-report workflow. It is left
   **unchanged** and flagged as an open decision (§Judgment calls).

---

## 1. Superseded / amended decisions

| Prior | Prior meaning | Now |
|---|---|---|
| **D-020** | Activities are the canonical, sole weighted progress unit; readiness gates closure | **Superseded by D-024.** Activities + closure-readiness removed from the app layer; program is the execution unit; legacy tables preserved read-only for audit/rollback |
| D-020 evidence-requirements (`activity_evidence_requirements.minCount`) | Mandatory evidence count per activity | **Superseded by D-025.** Evidence is informational only — no target/quota/percentage/blocker |
| D-022/D-023 | 129 legacy milestone baseline + rollback strategy | **Unchanged and reinforced** — the 129 `program_activities` and 129 legacy `program_milestones` are preserved untouched (see §Retained data) |

New decisions: **D-024** (activities/readiness removal), **D-025** (evidence informational),
**D-026** (budget «البند» + receipts), **D-027** (committee signatures per-type + task templates),
**D-028** (KPI planning-session exclusion), **D-029** (`insertBefore` root-cause class fix).

---

## 2. §1 — Remove activities + closure readiness (D-024)

**Architecture pivot.** `programs.progress` (int) and `programs.executionStatus` are already physical
columns. Today `progress` is overwritten by `recomputeProgramProgress()` from weighted activities;
`executionStatus` is already program-direct (weekly follow-up writes it). **Switch:** stop deriving
`progress` from activities; make `progress` + status **directly editable on the program**. Display
sites already read the stored `program.progress` column and need no change.

**Remove/retire (app layer):**
- `src/lib/plan/activity-progress.ts` (weighting + progress engine) — retire
- `src/lib/plan/readiness.ts` (closure-readiness engine) — retire
- `src/lib/plan/milestone-backfill.ts` (D-020 migration tooling) — retire
- `src/lib/plan/progress.ts` `computeProgramProgress` (dead) — remove; `computePackageReadiness` — remove per D-025
- `src/lib/plan/program-service.ts` — `listActivities` / `getProgramOverview` / `recomputeProgramProgress` / `evidenceCountsForActivities` — retire; replace with a program-direct read + a direct progress/status writer
- `src/app/(app)/plan/activity-actions.ts` — entire activity/deliverable/evidence-req CRUD + weighting-mode + completion/override actions — retire
- `src/app/(app)/plan/[id]/activities-ui.tsx` — entire activity + readiness + override client UI — retire

**Edit (remove references / rewire):**
- `src/app/(app)/plan/[id]/page.tsx` — drop activities Card («الأنشطة — أساس حساب تقدم التنفيذ», L186), ReadinessPanel, weighting-mode, weights-ready workflow gate; add a direct program progress/status editor; relabel L153 «الإنجاز الكلي (من المعالم الموزونة)» → direct progress
- `src/app/(app)/plan/actions.ts` — remove `validateWeights` gate in `approveProgramAction` (L46–54) and the dead `recomputeProgress` wrapper; keep approve/reopen
- `src/lib/imports/plan.ts` — **stop creating `program_activities` on commit** (L441–456) + `deriveMilestones` (L355–364); keep program/deliverable/kpi/risk/budget/roadmap import; rollback no longer needs the activity delete
- `src/lib/entity-registry.ts` — remove `activity` linkable entity (L96–119)
- `src/lib/safe-delete.ts` — remove `activity` case (keep legacy `milestone` historical block)
- `src/db/seed-data/permissions.ts` — retire `plan.override` permission (L25, L96)

**Keep (DB / audit only — never dropped):** `program_activities`, `activity_state_history`,
`activity_deliverables`, `activity_evidence_requirements`, `program_milestones`, and
`programs.weighting_mode / completed_* / override_*` columns; `src/lib/plan/baseline-verify.ts`
(read-only fingerprint). See §Retained data.

**Tests:** remove `activity-progress`, `readiness`, `activity-workflow`, `milestone-migration`;
edit `import-plan` (no longer asserts activity creation) + `safe-delete`.

## 3. §7 — Reports + `/pilot` (part of D-024/D-025)

- `src/lib/reports/program-report.ts` — remove activity-derived progress phrase (L69), closure-readiness
  row (L70), override wording (L71–75), activities table (L79–88), missing-requirements (L90–95), and
  the required-evidence "package" table (L97–106). **Keep** program info + owner + dates + results/impact
  (L45–60), actual spending (L76), and the actual uploaded-evidence section (L109–126). **Add** direct
  program progress/status, budget planned-vs-actual, notes, and a brief history block.
- `src/app/api/export/program-docx/[id]/route.ts` — remove «المعالم الموزونة» section (L64–70) + package table; keep بطاقة البرنامج (headers «البند»/«القيمة» — good pattern) + direct progress
- `src/app/api/export/plan-xlsx/route.ts` — remove «عدد المعالم» column (L38/52) + «المعالم» sheet (L58–78); keep «نسبة الإنجاز» (direct)
- `src/app/(app)/reports/page.tsx` — rewrite hub copy (L18, 50–56, 61–67): drop الأنشطة/الجاهزية/النواقص/الاكتمال-التجاوز
- `src/app/(app)/pilot/page.tsx` (L118–124) + `src/app/(app)/pilot/retest-checklist.tsx` (L13–29) — **full rewrite** to the corrected workflows (see §9)
- **Safe / unchanged:** `executive-report.ts` (already reads stored `program.progress`), `pilot-status.ts`

## 4. §2 — Evidence is informational; weekly follow-up = actual condition (D-025)

**Remove target/quota/percentage/"remaining"/readiness-from-count:**
- `src/lib/plan/progress.ts` `computePackageReadiness` and every caller: `plan/[id]/page.tsx`
  (packages-with-gaps banner, «ينقص الحزمة», package approval gated on `readiness===100`),
  `src/lib/worklist.ts` `evidenceGaps` (L216–267, 533), `src/app/(app)/dashboard/page.tsx`
  «تنبيهات نقص الشواهد» (L194–199), `src/lib/ai/tools.ts` `programBrief` readiness math
- `src/lib/plan/readiness.ts` `checkRequiredEvidence` (`minCount`/`satisfiedCount` compare) — retired with §1
- `src/app/(app)/plan/[id]/activities-ui.tsx` «متطلبات الشواهد» N/M + add-requirement `minCount` input — retired with §1
- `activity_evidence_requirements.minCount / required` — quota semantics dropped (columns retained in DB, unused)
- `src/lib/ai/tools.ts` `missingEvidence` + `src/lib/ai/assist.ts` `reviewEvidenceCompleteness` (dead) — reframe/remove "required/missing" language

**Add — weekly follow-up shows actual condition** (`src/app/(app)/plan/followup/page.tsx` +
in-program card `plan/[id]/page.tsx`): a live evidence count with correct Arabic wording —
`0 → «لم يتم رفع أي شاهد حتى الآن»`, `1 → «تم رفع شاهد واحد»`, `2 → «تم رفع شاهدان»`,
`3–10 → «تم رفع N شواهد»`, `≥11 → «تم رفع N شاهداً»` — plus latest upload date and an "open evidence"
link. New helper: `evidenceForEntity("program", id)` count + a new `max(createdAt)` query (none exists).

**Keep (informational):** `evidence.ts`, `evidence-render.ts`, `evidence-panel.tsx`, evidence totals in
dashboard/executive report, the evidence review queue (`evidenceReviewItems`), `followup.ts` status
scheduling («متأخر» is an execution-status label, not an evidence quota).

## 5. §3 — Budget «البند» + receipts (D-026)

- Labels: `budget_income.purpose` form/table «الغرض/التخصيص»→**«البند»** (`budget-ui.tsx:41`,
  `budget/page.tsx:92`); `budget_expenses.items` «المستلزمات/البنود»→**«البند»** (`budget-ui.tsx:115`).
  Show the expense «البند» value in the table (currently collected but never displayed).
- Receipts: **income has no receipt support today**; expenses derive a flag from shared evidence.
  Add receipt upload for **every income + expense** record via the existing plumbing —
  direct upload (`createEvidenceAction` / `EvidencePanel` "رفع شاهد جديد") **and** link existing
  (`linkEvidenceAction` / "ربط شاهد قائم"), download/open (`/api/files`), safe replacement with
  version history (`replaceEvidenceContentAction`). `budget_income` + `budget_expense` are already
  registered linkable entities. Make the budget page read `searchParams` (`?إيراد=`/`?مصروف=`, the
  existing dead deep-links) and render an inline receipt panel per selected record.
- Not mandatory by default; no duplicate upload if the doc is already in shared evidence. Re-frame the
  red «ناقص» / «مصروفات بلا إيصال» as a **neutral informational** state, not a deficiency/blocker.
- Show the receipt on record details + the program report budget section; update empty states.

## 6. §4 — Committee signatures per doc-type + predefined task templates (D-027)

**(A) Signatures.** No global flag exists; the de-facto "every committee doc needs a signature" rule
is the **hard gate in `completeMeetingAction`** (`committees/actions.ts:410–412`, requires a signed
minutes file for *every* meeting regardless of type) + the close-committee gate (L431–434) + hardcoded
report text (`minutes-report.ts:94`, `committee-report.ts:125`). Make signature **type-dependent**: add
a `requiresSignature` attribute to meeting/document types (additive column, default false), condition
those gates on it, and soften the hardcoded text. Central identity already exposes per-document
`signature`/`stamp` toggles (default OFF) as substrate. The assignment form already prints a signature
column (optional, ungated) — that stays.

**(B) Task-distribution table.** Rework `assignment-form.ts` from a **member roster** into a
**task-distribution table**: columns المهمة / العضو المكلف / الصفة-الدور / توقيع العضو / ملاحظات, one
row per assigned task, signature column in the printable form.

**(C) Predefined task templates (new build).** Only committee *formation* templates exist (6, with
committee-level `duties`). Build: a per-type **task-template** store (seeded from `committeeTemplates.duties`
as sensible defaults, centrally manageable), the workflow select-type → load standard tasks → review →
add/edit/exclude/reorder → assign to members → generate the distribution table → **freeze as a historical
snapshot** (reuse `issueDocument` + `htmlSnapshot`, which already guarantees "editing a template later
does not rewrite issued documents"). Committee tasks remain valid and are **separate** from the removed
operational-plan activities.

## 7. §5 — Exclude planning session «جلسة التخطيط» from KPI (D-028)

Planning session = `perf_sessions.session_type === "تخطيط"`. **Single choke point:** `cycleProgress`
in `src/lib/performance/scoring.ts:25–52` is the *only* cross-session rollup and has no session-type
awareness. Exclude `"تخطيط"` there (pass session type into its input and filter). Its one real call
site is `performance/cycles/[id]/page.tsx:32–41`; replace the `0.00٪` at L155–159 with
«لم يبدأ التقييم بعد» / «لا توجد نتائج تقييمية حتى الآن» when there are no non-planning ratings.
`weakIndicators` is auto-fixed once `cycleProgress` input is clean. Suppress/relabel the planning row's
computed score in the per-session table (L176–189) so it can't be misread as an evaluation result.
Per-session `sessionResult` stays intact (keeps `performance.test.ts:108–128` valid); the final/annual
report already uses only the `"نهائي"` session. Keep planning mandatory + visible (targets, planning
info, comments, evidence, signed-report). **Add test** (`tests/unit/scoring.test.ts`): mutating a
planning session's ratings across 1..5 leaves every cycle KPI result invariant; an all-planning cycle
yields the "unevaluated" state, not 0.

## 8. §6 — `insertBefore` cross-application defect (D-029)

**Probable root cause (leading hypothesis — verified in dev, principal retest is the acceptance gate).**
`Failed to execute 'insertBefore' on 'Node'` is the canonical signature of React reconciling over a DOM
mutated **outside React**. Labeled *probable* until proven under the principal's actual conditions; secure
client diagnostics (`error-diagnostics.tsx`) will capture any real occurrence with cause-classifying
evidence. Three converging shared causes:

1. **PRIMARY — browser auto-translation.** The app is 100% Arabic; `<html lang="ar" dir="rtl">`
   (`layout.tsx:26`, `global-error.tsx:17`) has **no `translate="no"`** and there is no
   `<meta name="google" content="notranslate">` anywhere. Chrome/Edge with a non-Arabic UI locale wrap
   text nodes in injected `<font>` elements; when React then inserts/removes a *sibling* (a pending
   spinner, a success/error banner, an upload control) the reference node is no longer where React
   expects → throw on interaction. The required JSX idiom (`text {cond && <el/>}`) is pervasive
   (268 occurrences / 79 files), concentrated in the very components cited (committee pages) and in
   **globally mounted** ones (offline banner, submit button, shared form fields).
2. **SECONDARY — password-manager / form-filler DOM injection** adjacent to unguarded `<input>`/
   `<textarea>`; the app-wide pending/disabled toggles then reconcile into the injected nodes. Explains
   why it clusters on forms + uploads.
3. **AMPLIFIER — hydration mismatch** in the shell shared by every page: `app-shell.tsx:206` formats
   `new Date()` with `islamic-umalqura` in a client component with no `suppressHydrationWarning`.

**Class-level fix (not per-page):**
- Add `translate="no"` + `<meta name="google" content="notranslate">` to `layout.tsx`, `global-error.tsx`,
  and the PDF/print HTML (`pdf.ts`, `building/document-scan.ts`). Highest leverage — neutralizes the whole
  class without touching 79 files.
- Harden shared primitives (`submit-button.tsx`, `ui.tsx` Field/Select/TextArea, `feedback-dock.tsx`
  Labeled): never place bare text as a direct sibling of a `{pending && …}` / `{required && …}`
  conditional (wrap in a stable `<span>`); add `autoComplete="off"` / `data-1p-ignore` /
  `data-lpignore="true"` to inputs.
- Mount-guard / `suppressHydrationWarning` the shell Hijri date.
- Confirm duplicate-submit protection (`SubmitButton` already disables on `pending`) and a stable
  Arabic error boundary that logs the technical error but **never shows the raw English exception**
  (`global-error.tsx` already renders Arabic; extend app-level `error.tsx` coverage + secure logging).
- **Regression tests:** real-browser (Playwright) coverage for representative buttons, dialogs, saves,
  uploads, cancellations, and repeated clicks — desktop + 390×844 RTL.

**Ruled out** (evidence gathered): service worker / PwaManager (network-first, guarded reload — causes
only `ChunkLoadError`, already self-recovered), portals/toasts (none exist — no `createPortal`, no
`<Toaster>`), three.js/off-DOM manual mutations (isolated to `/building/3d`, standard `useEffect`).

---

## 9. `/pilot` rewrite — corrected retest checklist

Program without sub-activities · direct program progress/status · weekly evidence count with 0/1/multiple
records · income + expense receipt uploads · «البند» wording · predefined committee tasks ·
task-assignment signature column · optional signatures on other committee documents · planning session
excluded from KPI · cross-application form/button stability (repeated-click, dialog, upload).

---

## 10. Retained-data treatment (§8 requirement)

**No destructive migration is authorized or planned.** All of the following are preserved **unchanged**:

| Records | Count | Treatment |
|---|---|---|
| `program_activities` (incl. `migrated_from_milestone_id`) | 129 (prod) | Rows untouched. No app write path, no read into current progress/reports/alerts/follow-up. Retained for audit, traceability, rollback. |
| `program_milestones` (legacy) | 129 (prod) | Already read-only since D-020. Remains for audit; only `baseline-verify.ts` reads it. |
| `activity_deliverables`, `activity_evidence_requirements`, `activity_state_history` | — | Rows untouched; app write paths retired; `minCount`/`required` columns retained but no longer carry quota semantics. |
| `programs.weighting_mode / completed_* / override_*` columns | — | Retained (nullable, additive from 0011); unused by the app going forward. |

**Program follow-up going forward** is maintained **directly on the program** (`programs.progress`,
`programs.executionStatus`) — not recreated under another name.

---

## 11. Database posture

**Expected: application-layer only.** The removal (§1/§2) needs **no schema change** — it stops writing
to existing tables and stops deriving from them. Net-new schema is small and **additive** where required:

- §4 committees: `requiresSignature` on meeting/document types (additive nullable/defaulted); a new
  `committee_task_templates` store + task-assignment persistence (new additive tables) — **numbers to be
  finalized during implementation**.
- §3 budget: no new columns needed (receipts reuse shared evidence); only if a per-record receipt shortcut
  column is added would it be additive nullable.

Any migration will be additive-only (no DROP, no NOT NULL on populated columns, no type narrowing),
applied to `madrasa_test` first, and **never** to production without explicit authorization.

**Production migration level (verified read-only 2026-07-26): `0000–0015`** — Scope v2 was already
deployed to production (latest migration applied 2026-07-23 18:51 UTC). Migration `0016` is the **only**
pending production migration. (An earlier draft said `0009`; that was stale Scope-v2-era planning text
never verified against the live `madrasa-prod-db-1` container — corrected here. See
`docs/DEPLOYMENT_REPORT_V2_1.md` §3.1 for the verified state + counts + D-022 fingerprint match.)

---

## 12. Judgment calls / open decisions (flagged, defaulted conservatively)

1. **Performance per-indicator evidence gate** (`performance/actions.ts:434`, `perf_indicators.requiresEvidence`).
   §2 is scoped to *operational-plan program* evidence; §5 preserves the performance evidence + signed-report
   workflow. **Default: leave unchanged.** If the principal intends "no required evidence" to extend to
   performance indicators, that is a separate follow-up.
2. **Program deliverables (`programDeliverables`).** Carry verbatim official source text («المخرج المطلوب»).
   **Default: retain as informational output records**, remove only their readiness-percentage / missing-roles /
   package-approval-gate (per D-025).
3. **Program progress input.** **Default: keep both** the existing numeric `progress` (0–100, directly
   editable) and `executionStatus` — covering either "percentage" or "status-only" intent.

---

## 13. Verification & deployment boundary (§8)

Before requesting production deployment authorization: unit/integration/authorization/typecheck/lint/build/
Playwright green; real-browser form/button/upload results; desktop + 390×844 RTL; the retained-data statement
(§10); confirmation that **no activity/readiness logic remains active** in current workflows; DB changes (if
any, additive, test-only until authorized); backup + rollback plan; and confirmation that **production remains
unchanged**. **Do not** delete legacy data, reset/reseed production, import official data, broaden network
exposure, or deploy to production without explicit authorization.
