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

---

# Corrective-release run — 2026-07-16 (mobile / AI assistant / Tailscale HTTPS)

Mac mini M2 (dev machine), Postgres 16 (Docker :5544), Node 24, local Ollama qwen3:4b live.

## Vitest — `npm run test`
```
Test Files  13 passed (13)
Tests       63 passed (63)
```
New suite `tests/integration/ai.test.ts` (12 tests): tool-registry allowlist + forbidden-verb scan, per-entity RBAC on read tools,
itemized previews on all write tools, confirm-once idempotency (duplicate confirm refused, single record), execution-time
permission recheck, cancel blocks execution, full audit trail, disabled-by-default + external-consent gating.

## Playwright — `npm run test:e2e`
```
15 passed, 1 skipped
```
- `mobile.spec.ts` (real WebKit, iPhone 12 390×844): login + 27 principal routes with zero page-level horizontal overflow;
  drawer geometry/backdrop/scroll-lock/close-flows; ≥16px inputs; ≥44px nav touch targets.
- `assistant.spec.ts`: nav item + desktop dock panel (≤430px), live Ollama connection test with Arabic diagnostics + model list,
  mobile full-screen assistant without overflow.
- `https-pwa.spec.ts`: Secure+HttpOnly session cookie behind HTTPS proxy, RTL installable manifest, service worker; the
  real-origin secure-context test is the 1 skipped — it runs with `APP_URL=https://<device>.<tailnet>.ts.net npm run test:e2e`
  after the one-time tailnet HTTPS enablement.
- Pre-existing `arabic-and-auth.spec.ts` remains green (desktop unchanged).

## Live smoke against local Ollama (scripts, screenshots archived)
- `scripts/ai-smoke.mjs`: read question → `rooms_needing_inspection` tool → Arabic answer in ~4s (was ~158s before `think:false`), local-provider badge shown.
- `scripts/ai-proposal-smoke.mjs`: «أنشئ مهمة…» → itemized proposal card → confirm → task verified in /tasks register.
- `scripts/mobile-audit.mjs`: all routes measured clean at 390/393/430/360px; drawer box right-anchored, backdrop, body locked.

## Static checks & build
- `npm run lint` / `npm run typecheck` — clean; `npx drizzle-kit check` — no schema drift (migration 0002 applied: ai_conversations, ai_messages, ai_action_proposals, ai_drafts).
- `npm run build` — production build succeeds, all routes compile.

---

# Workflow-quality phase run — 2026-07-17 (work center + six workflow repairs + scenario e2e)

Gate C5: **DEFERRED_BY_PRODUCT_OWNER (D-018)** — its e2e remains the 1 skipped test; nothing camera/PWA/HTTPS was touched.

## Vitest — `npm run test`
```
Test Files  14 passed (14)
Tests       84 passed (84)
```
New/extended: import double-commit race + createdEntityId integrity + rollback claim; `plan-workflow.test.ts` (approve/reopen/change-request/weekly-followup/year-close — previously untested state machine); performance final completion through real actions (per-indicator evidence via subKey) + cycle complete/reopen + D-014 staff manual-model path; building geometry-sync on room edit + room-code resolver + full maintenance lifecycle; AI allowlist now 17 tools + context binding + no-grades assertion + attachment_text RBAC.

## Playwright — `npm run test:e2e`
```
30 passed, 1 skipped (deferred C5)
```
- NEW `workflows.spec.ts` (15 tests): 7 full desktop business scenarios driven from «مركز عمل مدير المدرسة» through every screen to the final result — employee import incl. rollback batch; plan import→approve→evidence→weekly follow-up→change request→executive report; committee formation→approval→meeting→قرار (mandatory task)→signed minutes→completion; performance cycle→planning session→final session with all-indicator ratings + per-indicator evidence→lock→cycle «مكتملة»; digital twin publish→room edit draft→inspection→maintenance to «مغلق ومتحقق»; AI contextual entry; **Fares batch sanctity assertion (still «معاينة»)** — plus 8 mobile 390×844 replays each asserting zero page-level horizontal overflow. Three consecutive fully-green runs (43.8s–1.6m).
- Scenario testing exposed and fixed 3 real bugs: `nextRoomCode` executed outside the publish transaction (first multi-room floor publish always crashed with KHS-RM unique violation); evidence-panel form kept a stale «نوع الشاهد» radio after each save (second consecutive save failed); re-forming a committee from a template whose committee is «مقفلة» was rejected while the UI offered it.
- `mobile.spec.ts` extended with `/plan/followup`; A1 checker now exempts document verification codes (hex by design).

## Static checks & build
tsc --noEmit, eslint, and `npm run build` (production) all clean. Migration `0003_nosy_lightspeed` (program_followups) applied.

## Dev-DB state after scenario runs
Synthetic «تجريبي آلي» residue retained deliberately (people, programs, committees, cycles, evidence, documents); ground floor published (rooms KHS-RM-0001..0017) and «فحص السلامة العام» inspection template approved. **Real Fares batch untouched: «معاينة», 52 rows.**
