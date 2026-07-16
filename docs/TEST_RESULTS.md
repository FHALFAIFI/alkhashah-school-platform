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
