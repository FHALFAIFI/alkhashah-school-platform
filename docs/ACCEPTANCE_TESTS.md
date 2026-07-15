# Acceptance Tests — اختبارات القبول

Master list from §15 of the build prompt. Statuses as of 2026-07-16 (first-release completion). Full run log: `docs/TEST_RESULTS.md`.

| # | Requirement | Proof | Status |
|---|---|---|---|
| A1 | No English in critical user workflows | Playwright scans rendered text of 9 critical pages for Latin words (allowlist: format/code tokens PDF/Excel/Word/QR/KHS…) — `tests/e2e/arabic-and-auth.spec.ts` | ✅ pass |
| A2 | A future role cannot access individual performance without explicit permission | `tests/integration/rbac.test.ts` — future «معلم» role lacks `performance.individual.read`; sysadmin lacks it too; principal has it | ✅ pass |
| A3 | Performance session cannot fully complete without signed report | `tests/integration/performance.test.ts` — real action rejects without issued report, then without signed upload, then completes | ✅ pass |
| A4 | Calculated percentages cannot be manually changed | Same suite — client-sent `sessionResult=100` ignored; server computes 83 from (rating/5)×weight; out-of-range ratings rejected | ✅ pass |
| A5 | Meeting cannot complete without signed minutes | `tests/integration/committees.test.ts` — real action rejects, completes only after signed-minutes upload; post-completion edits blocked | ✅ pass |
| A6 | Decision creates mandatory action | Same suite — قرار auto-creates mandatory task; cancellation of mandatory task blocked; recommendation optional | ✅ pass |
| A7 | Evidence linked to approved record cannot be deleted | `tests/integration/evidence.test.ts` | ✅ pass |
| A8 | Import previews without national ID / birth date / mobile / manager-ID by default | `tests/integration/import-people.test.ts` on synthetic fixture — sensitive values never appear in raw/mapped | ✅ pass |
| A9 | Plan imports without silently changing official source values | `tests/integration/import-plan.test.ts` — verbatim `1449/1/5` etc. | ✅ pass (real workbook imported via UI uses same code path) |
| A10 | Import batch can be rolled back | people + plan rollback tests — no residue, blocked when unsafe | ✅ pass |
| A11 | Room name + measurement editable bidirectionally, saved in geometry version | `tests/integration/building.test.ts` — versioned saves; publish syncs name/dims/area/perimeter to room register | ✅ pass |
| A12 | Replacing aerial background preserves vector geometry | Same suite — geometry versions byte-identical after transform + replace | ✅ pass |
| A13 | Offline PWA inspection syncs once without duplication | Same suite — re-POST of same ops: applied=0, skipped=1, single row | ✅ pass |
| A14 | Managed rooms/assets cannot be added to girls-complex context area | Same suite — geometry, assets, inspections, and sync all rejected in context zone | ✅ pass |
| A15 | Backup and restoration work in a test environment | `npm run restore:rehearsal` executed for real — see `docs/BACKUP_REHEARSAL_LOG.md` (55 tables, users, files verified) | ✅ pass |
| A16 | Complete application works with AI disabled | Default env `AI_ENABLED=false`; entire vitest+e2e suite and all flows run with AI off; AI UI hidden when disabled | ✅ pass |
| A17 | Arabic reports render correctly in PDF and Word | `tests/integration/reports.test.ts` (PDF bytes, Arabic snapshot, evidence content) + `tests/integration/exports.test.ts` (docx contains Arabic + bidi) | ✅ pass |
| A18 | Authorization on every private download and approval endpoint | e2e 401 unauthenticated / 404-authorized; all approval actions behind `requirePermission`; sync endpoint CSRF-gated | ✅ pass |

## Phase gates
- **Gate 1–5:** all green. Gate 3 note: calculations verified against synthetic 100%-total model; the 8 official ministry models await the missing source PDF (D-006) and will be entered through the official-model flow with visual verification — no official content invented.
