# PROGRESS — سجل التقدم

> Resume protocol: read this file top-to-bottom, then `git log --oneline -20`, `git status`, `docs/DECISIONS.md`, and `docs/TEST_RESULTS.md`. Continue from the last checkpoint — never restart.

## Current state — FIRST RELEASE COMPLETE + REAL-DATA VALIDATION PASS (D-014, 2026-07-16)
- **App:** Next.js 16.2.10, port 3080, Postgres 16 Docker `madrasa-db` host port **5544**. Login: `principal`/`admin` (temp passwords in `storage/private/initial-credentials.txt`).
- **Quality:** 51 vitest (12 files) + 4 playwright green; typecheck/lint/build clean; no schema drift; restore rehearsal executed successfully (see `docs/BACKUP_REHEARSAL_LOG.md`).
- **Acceptance:** A1–A18 + B1–B9 (real-data pass) all pass — statuses + evidence in `docs/ACCEPTANCE_TESTS.md`.
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
- Review and commit the Fares preview batch in /imports (or reject it); confirm the 10 «يحتاج مراجعة» classifications and per-person model assignments (أمين مصادر has no official model — manual choice).
- At the first real evaluation cycle, compare the 3 D-014 weight cells with نظام فارس.

## Go-live checklist (operator)
1. Change both initial passwords; enable TOTP; store then delete `initial-credentials.txt`.
2. Review + commit the Fares preview batch in /imports (already parsed and waiting; final approval is yours).
3. Deploy per `docs/DEPLOY_UBUNTU_AR.md`; set `BACKUP_OFFSITE_DIR`; schedule cron backups; run `npm run restore:rehearsal` on the server and log it.
