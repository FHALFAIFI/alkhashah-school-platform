# PROGRESS — سجل التقدم

> Resume protocol: read this file top-to-bottom, then `git log --oneline -20`, `git status`, `docs/DECISIONS.md`, and `docs/TEST_RESULTS.md`. Continue from the last checkpoint — never restart.

## Latest checkpoint — SCOPE v2.1 FINAL-DEMO CORRECTIONS (round 4) — VERIFIED, DEPLOY PAUSED (2026-07-27)
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
- **PRODUCTION DEPLOY PAUSED — awaiting explicit go-ahead.** `0017` applied only to the clone; no
  release tag. No-seed deploy runbook in report §G. **Live LAN IP is `192.168.0.171`** (not `.48`) —
  keep `TRUSTED_ORIGINS`/`APP_BIND` matched to it on any redeploy.

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
