# PROGRESS — سجل التقدم

> Resume protocol: read this file top-to-bottom, then `git log --oneline -20`, `git status`, `docs/DECISIONS.md`, and the latest test results. Continue from the last checkpoint — never restart.

## Current state
- **Phase:** 3 complete → starting Phase 4 (digital twin)
- **App:** Next.js 16.2.10, port 3080. DB: Postgres 16 Docker `madrasa-db` on host port **5544**. `npm run dev` to start; login: `principal` / `admin` (passwords in `storage/private/initial-credentials.txt`, git-ignored).
- **Tests:** `npm run test` (vitest, 18 passing — uses isolated `madrasa_test` DB, auto-created), `npm run test:e2e` (playwright, 4 passing, starts dev server itself).

## Done
### Phase 0 (commit `Phase 0: foundation`)
Docs (REQUIREMENTS_AR/DECISIONS/DATA_MAPPING/ACCEPTANCE_TESTS/SECURITY_AND_BACKUP), pinned stack, full Drizzle schema for ALL modules, migration 0000, production seed (RBAC, 2 users, school+stages, official 1448-1449 calendar verbatim, 6 committee templates from the 1447 PDF, zones/floors, settings, branding import to private storage).

### Phase 1 (this checkpoint)
- **Auth:** Argon2id + DB sessions (hashed tokens), lockout, optional TOTP (otplib v13 wrapper in `src/lib/auth/totp.ts`), CSRF token per session, rate limiting. `requireUser` redirects to /login; `requirePermission` throws Arabic AuthError.
- **RBAC:** permission-keyed checks everywhere; principal = all permissions; sysadmin = all except `performance.individual.read` + `branding.use` (D-013 in DECISIONS).
- **Shell:** RTL sidebar app shell (`src/components/app-shell.tsx`), UI primitives (`src/components/ui.tsx`), IBM Plex Sans Arabic bundled.
- **Storage:** `src/lib/storage.ts` provider abstraction, uploads validated (MIME+ext+size), UUID paths under `storage/`, authenticated download route `/api/files/[id]` (401/403/404, sensitive files audited).
- **Import framework:** `src/lib/imports/framework.ts` (batch → preview → correct → explicit approve → transactional commit → rollback). People parser (data minimization enforced at parse level — sensitive columns never leave the file) + plan parser (multi-sheet, verbatim official values, milestone derivation w/ equal weights). UI wizard at `/imports`.
- **Plan module:** `/plan` (26-program list + domain cards), `/plan/[id]` (official card, weighted milestones w/ two-way progress recompute, deliverable packages + readiness (تنفيذ/مخرج/أثر/خارجي), evidence panel, change requests w/ old/new/reason/approve, approve-lock/reopen-with-reason + record_versions), `/plan/kpis`, `/plan/risks`. Year close action.
- **Evidence:** unified register, link-many, delete guard (approved-linked = blocked), `/evidence`.
- **Evidence rendering for reports:** `src/lib/evidence-render.ts` — images embedded, PDF page 1 via pdfjs-dist+napi-canvas, DOCX text extraction, XLSX limited preview, truncation note string exactly as required.
- **Documents/PDF:** `src/lib/pdf.ts` (Playwright Chromium, A4, embedded font, official header), `src/lib/documents.ts` (doc numbers KHS-DOC-#####, verification codes, frozen snapshots, branding audited), program report generator + UI.
- **Tasks:** unified register `/tasks` with overdue computation, mandatory-task protection.
- **Notifications**, **Calendar** (dual display, teacher-return anchor highlighted), **Dashboard**, **Admin** (users+password change w/ session invalidation, settings incl. independent signature/stamp defaults, read-only audit log, backup policy page).
- **Committee templates page** live (from seed).
- Stubs for `/performance*`, `/committees`, `/building*`, `/reports/executive` (later phases).

## Key facts (Phase 0 discovery)
- Plan: 26 programs (7/6/8/5 across 4 domains), end **5/1/1449هـ** verbatim. Teacher return **1448/3/10 = 2026-08-23** (`anchorKey: teacher_return`). Fixtures for tests are synthetic — real data never in Git.
- **MISSING reference files (D-006):** official 8-model performance PDF, guidance PDF, Fares xlsx. Phase 3 builds infrastructure + designer; official model content flagged «بانتظار الاعتماد الرسمي» until files arrive.

## Done — Phase 2 (this checkpoint)
- Committees: annual formation from the 6 seeded templates (no prior-year members), member management (school people only, single chair/secretary), principal approve/reopen-with-reason + snapshots, meetings (agenda/discussion/date/location), outcomes (قرار → mandatory task automatically; توصية → optional task; ملاحظة), official minutes PDF (chair+secretary signature lines only), signed-minutes upload gate before completion, committee close/archive, recurrence due-indicator, PLCs (name/leader/members/objectives/outputs).
- Tests: 5 new integration tests exercising REAL server actions with mocked request context (A5, A6, no-attendance schema scan, external-member rejection). 23 total green.

## Done — Phase 3 (this checkpoint)
- Scoring lib (src/lib/performance/scoring.ts): weighted = (rating/5)*weight; session result server-computed only; cycle progress = latest rating per indicator by session date; final-report uses final-session ratings; weak (≤2) suggestions.
- Models: designer (indicators+weights must equal exactly 100 to approve), official flag for ministry models (source PDF still missing — entry+visual-verification flow ready, «رسمي» models never invented), reopen with reason + snapshots.
- Cycles: teacher (anchored to teacher_return from frozen calendar snapshot) / employee (Jan-Dec + principal-set deadlines); frozen model snapshot; suggested model from job title requires confirmation; self-evaluation blocked; unique per person+year.
- Sessions: تخطيط/منتصف/نهائي once-only, زيارة unlimited (pre-students_start = warning only), متابعة with configurable target; ratings 1..5 only; client-sent percentages ignored (A4); non-final sessions may stay incomplete.
- Completion gates: any session requires issued report + uploaded signed report (A3); final additionally requires all indicators rated + required per-indicator evidence linked; reopen requires reason + full version snapshot.
- Session report PDF: all indicators/weights/ratings/weighted scores/notes/evidence content, optional principal signature+stamp independently, manual teacher signature line.
- Individual-performance guard: cycle/session detail pages require performance.individual.read (principal-only).
- Tests: 13 new (unit scoring + real-action integration incl. tamper rejection, once-only, visit warning, A3 gates, final-lock evidence gate, reopen versioning). 36 total green.

## Next steps (Phase 4 — digital twin)
1. Trace 4 floors from مخطط المبنى.pptx text overlays + rasters (import rasters to private storage as toggleable backgrounds); external site from أبو فهد PDF calibrated on 26×18 field.
2. Konva editor: two-way name/dimension binding, move/resize/draw/delete, doors, auto area/perimeter, undo/redo, draft/publish geometry versions, background transform without touching vectors.
3. Rooms register + QR (KHS-RM-), assets (KHS-AST- individual vs quantity), inspections (templates draft→approve, recurring), readiness calc + override with reason, simple maintenance workflow, offline PWA inspection (IndexedDB queue, idempotent sync via client op ids), girls zone = context-only guard.
4. Tests A11-A14 + checkpoint.