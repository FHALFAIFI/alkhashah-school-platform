# Recorded Test Results — سجل نتائج الاختبارات

Latest full run — 2026-07-16 (real-data validation pass, D-014), Mac mini M2 (dev machine), Postgres 16 (Docker), Node 24.

## Vitest (unit + integration) — `npm run test`
```
Test Files  12 passed (12)
Tests       51 passed (51)
```
Suites: dates (Umm al-Qura conversions vs official calendar), scoring (official formula, tamper-proofing),
import-people (data minimization, dup detection, commit/rollback), import-plan (verbatim officials, milestones),
evidence (approved-record delete guard, multi-link), rbac (future-role isolation), committees (A5/A6 via real actions),
performance (A3/A4, once-only sessions, visit warning, final-lock gates, reopen versioning),
building (A11/A12/A14, readiness), sync (A13 idempotency, CSRF, zone guard), reports (Arabic PDF), exports (Arabic DOCX),
**official-models (NEW — B1–B8): 8 ministry models verbatim (names/order/weights pinned from the source PDF), 100% totals,
edit-lock, principal self-evaluation rejection, real Fares file (52 rows, sensitive-field exclusion, pre-approval editability).**

## Playwright (e2e) — `npm run test:e2e`
```
4 passed
```
Arabic-only critical pages (A1 — allowlist extended with uploaded-file extensions xlsx/docx/csv now that a real
import batch appears in /imports), unauthenticated 401 (A18), login flow, authorized 404 behavior.

## Static checks
- `npm run typecheck` — clean (TS 5.9 strict)
- `npm run lint` — clean (eslint 9 + eslint-config-next)
- `npm run build` — production build succeeds (all routes compile)

## Migrations & seed
- `npx drizzle-kit generate` — “No schema changes, nothing to migrate” (official models needed no schema change)
- `npm run db:migrate` — applied cleanly
- `npm run db:seed` — idempotent re-run clean; `seedOfficialPerfModels` verified in-DB: 8 official models, each Σ=100%

## Operational rehearsals & real-data flows
- Restore rehearsal (A15): ✅ — `docs/BACKUP_REHEARSAL_LOG.md`
- Real reference-file flows executed: plan workbook (26 programs), committee PDF → templates, pptx rasters + aerial PDF backgrounds, branding images.
- **2026-07-16:** 8 official performance models entered from the delivered ministry PDF after page-by-page visual inspection (`docs/PERFORMANCE_MODEL_VALIDATION.md`); guide cross-check discrepancies documented (D-014); Fares xlsx parsed to a preview batch (52 rows — commit left to the principal); teacher-return calendar row revalidated against both official workbooks.
