# Recorded Test Results — سجل نتائج الاختبارات

Final first-release run — 2026-07-16, Mac mini M2 (dev machine), Postgres 16 (Docker), Node 24.

## Vitest (unit + integration) — `npm run test`
```
Test Files  11 passed (11)
Tests       43 passed (43)
```
Suites: dates (Umm al-Qura conversions vs official calendar), scoring (official formula, tamper-proofing),
import-people (data minimization, dup detection, commit/rollback), import-plan (verbatim officials, milestones),
evidence (approved-record delete guard, multi-link), rbac (future-role isolation), committees (A5/A6 via real actions),
performance (A3/A4, once-only sessions, visit warning, final-lock gates, reopen versioning),
building (A11/A12/A14, readiness), sync (A13 idempotency, CSRF, zone guard), reports (Arabic PDF), exports (Arabic DOCX).

## Playwright (e2e) — `npm run test:e2e`
```
4 passed
```
Arabic-only critical pages (A1), unauthenticated 401 (A18), login flow, authorized 404 behavior.

## Static checks
- `npm run typecheck` — clean (TS 5.9 strict)
- `npm run lint` — clean (eslint 9 + eslint-config-next)
- `npm run build` — production build succeeds (all routes compile)

## Operational rehearsals
- Restore rehearsal (A15): ✅ — `docs/BACKUP_REHEARSAL_LOG.md`
- Real reference-file flows executed during development: plan workbook parsed (26 programs verified), committee PDF transcribed to templates, pptx rasters + aerial PDF imported as backgrounds, branding images imported to private storage.
