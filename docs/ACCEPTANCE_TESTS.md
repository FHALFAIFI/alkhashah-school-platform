# Acceptance Tests — اختبارات القبول

Master list from §15 of the build prompt. Statuses as of 2026-07-16 (first-release completion). Full run log: `docs/TEST_RESULTS.md`.

| # | Requirement | Proof | Status |
|---|---|---|---|
| A1 | No English in critical user workflows | Playwright scans rendered text of 9 critical pages for Latin words (allowlist: format/code tokens PDF/Excel/Word/QR/KHS… + file extensions xlsx/docx/csv appearing inside real uploaded-file names) — `tests/e2e/arabic-and-auth.spec.ts` | ✅ pass |
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

## Real-data validation pass — 2026-07-16 (source files delivered; D-014)

| # | Requirement | Proof | Status |
|---|---|---|---|
| B1 | The 8 official models present with exact Arabic names, official flag, no duplicates | `tests/integration/official-models.test.ts` — names pinned verbatim from visual page-by-page inspection of the ministry PDF | ✅ pass |
| B2 | Indicator order and weights match the ministry PDF | Same suite — full weight sequences per model + spot-checked indicator names (incl. the 3 rows disputed vs the guide) | ✅ pass |
| B3 | Every official model totals exactly 100% | Same suite + seed-time guard (`seedOfficialPerfModels` throws on ≠100) + `approveModelAction` gate | ✅ pass |
| B4 | Official content locked from normal editing | Same suite — `addIndicatorAction` rejects on «معتمد»; only documented-reason reopen path remains | ✅ pass |
| B5 | Principal model preserved; principal self-evaluation impossible | Same suite — `school-principal` model approved+official; `createCycleAction` rejects self-cycle («لا يجوز إنشاء دورة تقييم ذاتي») | ✅ pass |
| B6 | Fares file: 52 employee rows detected | Same suite (runs against the real gitignored file; auto-skips if absent) | ✅ pass |
| B7 | Sensitive fields (national ID, birth date, manager ID, mobile) excluded by default from the real file | Same suite — columns detected+flagged, values absent from raw/mapped (regex sweep) | ✅ pass |
| B8 | Classification & model assignment editable before approval; batch stays «معاينة» until principal commits | Same suite — `updateRowCorrection` round-trip on the real batch; commit not called | ✅ pass |
| B9 | Teacher-return date revalidated against official source row | `docs/PERFORMANCE_MODEL_VALIDATION.md` §6 — sheet «التقويم الدراسي الرسمي», row 6: 1448/3/10 = 2026/8/23 (الأحد) in both official workbooks; seed matches verbatim | ✅ pass |

## Phase gates
- **Gate 1–5:** all green. Gate 3 note (updated 2026-07-16): the 8 official ministry models are now entered verbatim from the delivered source PDF after page-by-page visual verification and locked («معتمد»); scoring verified against the official calculation mechanism (models PDF p.45, guide p.62). Cross-check discrepancies with the guide documented in D-014 — nothing invented, nothing silently resolved.

## Corrective release gates — 2026-07-16 (mobile / AI assistant / Tailscale HTTPS)

| # | Requirement | Proof | Status |
|---|---|---|---|
| C1 | Every principal route renders at 390px with no page-level horizontal overflow | `tests/e2e/mobile.spec.ts` (WebKit iPhone 12) sweeps 27 routes + login; `scripts/mobile-audit.mjs` measured offenders element-by-element at 390/393/430/360px — all clean | ✅ pass |
| C2 | RTL drawer fully visible and usable on mobile | Same suite — drawer geometry (right edge, ≤min(86vw,360px)), labels visible, dark backdrop, body scroll-lock, close via button/backdrop/navigation | ✅ pass |
| C3 | Cards, forms, dialogs, tables work on mobile | ≥16px inputs (Safari anti-zoom) + ≥44px touch targets pinned by tests; tables scroll inside their own container; forms single-column at 390px (audit) | ✅ pass |
| C4 | PWA + secure-cookie behavior through HTTPS | `tests/e2e/https-pwa.spec.ts` — Secure+HttpOnly session cookie behind HTTPS proxy, RTL installable manifest, service worker served correctly | ✅ pass |
| C5 | Camera/photo + offline inspection in a secure context | Same file, secure-context suite (isSecureContext, mediaDevices, active service worker) — runs against the real `https://….ts.net` origin; camera accepts on file inputs use `image/*` so iOS offers Take Photo | ⏳ pending one-time tailnet HTTPS enablement (operator click), then `APP_URL=https://… npm run test:e2e` |
| C6 | AI assistant appears on desktop and mobile | `tests/e2e/assistant.spec.ts` — nav item + floating dock + desktop side panel ≤430px + mobile full-screen sheet without overflow | ✅ pass |
| C7 | Local-provider connection testing works | Same suite — settings page runs a live connection test against local Ollama and shows Arabic diagnostics + model list | ✅ pass |
| C8 | Read-only AI tools respect RBAC | `tests/integration/ai.test.ts` — per-entity permission enforced inside each tool; execution-time recheck on confirm | ✅ pass |
| C9 | Write tools require preview + confirmation | Same suite — itemized preview built for every write tool; UI proposal card verified live (`scripts/ai-proposal-smoke.mjs`) | ✅ pass |
| C10 | Duplicate confirmation cannot create duplicate records | Same suite — guarded status transition + idempotency key; second confirm refused, single record exists | ✅ pass |
| C11 | AI cannot approve/lock/sign/stamp/score/commit imports/delete/send | Registry pinned to an explicit allowlist; forbidden-verb scan; no such tools exist in code | ✅ pass |
| C12 | Every AI action audited | Same suite — `ai.prompt`, `ai.action_proposed/confirmed/executed`, settings/test/history events in audit log | ✅ pass |
| C13 | Application fully works with AI disabled | Same suite + whole vitest/e2e run with AI off by default; assistant UI hidden; A16 unchanged | ✅ pass |
| C14 | Desktop behavior remains correct | Full existing suite (A1–A18, B1–B9) re-run green after all corrective changes | ✅ pass |
