# Acceptance Tests — اختبارات القبول

Master list from §15 of the build prompt. Each item states how it is proven (automated test path or documented manual procedure). Status updated per phase.

| # | Requirement | Proof | Status |
|---|---|---|---|
| A1 | No English in critical user workflows | Playwright e2e scans rendered critical pages for Latin UI text (allowlist: numbers, codes) — `tests/e2e/arabic-only.spec.ts` | Phase 1 |
| A2 | A future role cannot access individual performance without explicit permission | Vitest RBAC test: role without `performance.individual.read` gets 403 — `tests/unit/rbac.test.ts` | Phase 1/3 |
| A3 | Performance session cannot fully complete without signed report | Integration test on completion guard — `tests/integration/performance.test.ts` | Phase 3 |
| A4 | Calculated percentages cannot be manually changed | No API accepts a percentage field; server recomputes; test asserts tampering rejected | Phase 3 |
| A5 | Meeting cannot complete without signed minutes | Integration test — `tests/integration/committees.test.ts` | Phase 2 |
| A6 | Decision creates mandatory action | Same suite: outcome type `decision` → linked task created, required | Phase 2 |
| A7 | Evidence linked to approved record cannot be deleted | Integration test — `tests/integration/evidence.test.ts` | Phase 1 |
| A8 | 52-person import previews without national ID / birth date / mobile by default | Import pipeline test on synthetic fixture asserts excluded columns never persisted by default — `tests/integration/import-people.test.ts` | Phase 1 |
| A9 | Operational plan imports without silently changing official source values | Import test compares stored values to source workbook verbatim (incl. `5/1/1449هـ`) | Phase 1 |
| A10 | Test import batch can be rolled back | Import framework test: commit → rollback → no residue | Phase 1 |
| A11 | Room name + measurement editable bidirectionally, saved in geometry version | Vitest geometry logic + Playwright editor e2e | Phase 4 |
| A12 | Replacing aerial background preserves vector geometry | Unit test: background swap mutates only background record | Phase 4 |
| A13 | Offline PWA inspection syncs once without duplication | Integration test on sync endpoint idempotency (client op UUIDs) | Phase 4 |
| A14 | Managed rooms/assets cannot be added to girls-complex context area | Server guard test: zone `context` rejects room/asset creation | Phase 4 |
| A15 | Backup and restoration work in a test environment | Scripted rehearsal `scripts/restore-rehearsal.sh` + recorded log in `docs/BACKUP_REHEARSAL_LOG.md` | Phase 5 |
| A16 | Complete application works with AI disabled | Default config has AI off; e2e suite runs entirely with AI disabled | Phase 5 |
| A17 | Arabic reports render correctly in PDF and Word | PDF/DOCX generation tests assert Arabic content present; manual visual check recorded | Phase 1+ |
| A18 | Authorization checks on every private download and approval endpoint | Integration tests: unauthenticated + unauthorized access → 401/403 on download & approval routes | Phase 1 |

## Per-phase gates
- **Gate 1:** principal can import (preview→approve) people + plan, operate a program, link deliverables/evidence, compute weighted progress, issue a report, approve package. A1, A7–A10, A17, A18 green.
- **Gate 2:** A5, A6 green; no attendance/absence/quorum anywhere.
- **Gate 3:** A2–A4 green; calculations match official weights (once official file arrives — infrastructure verified against synthetic model totaling 100%).
- **Gate 4:** A11–A14 green.
- **Gate 5:** A15, A16 green; every optional integration independently switchable; secrets only via environment.
