# PROGRESS — سجل التقدم

> Resume protocol: read this file top-to-bottom, then `git log --oneline -20`, `git status`, `docs/DECISIONS.md`, and `docs/TEST_RESULTS.md`. Continue from the last checkpoint — never restart.

## Latest checkpoint — UNIVERSAL EXCLUSION + SAFE ARCHIVE WORKFLOW (2026-07-18)
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
