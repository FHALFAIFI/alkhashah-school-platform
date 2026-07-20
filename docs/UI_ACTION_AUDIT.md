# UI Action Audit

Inventory of visible interactive actions and their verification status. English per the
language policy; Arabic labels quoted inline. Source of truth for Phase 1 (button-failure
remediation) and Phase 9 (acceptance). Cross-reference: `docs/POST_PILOT_REMEDIATION.md`.

## Verification method (this pass)

Evidence was collected against a **production build** (`next build` + `next start`), not
`next dev`, on the isolated `madrasa_test` database (safety rule: no write-heavy tests on
real data). A headless Chromium logged in as **principal** and swept all 37 authenticated
routes, capturing per route: HTTP status, `pageerror`/console errors, failed requests, a
census of interactive elements (`button`, `a[href]`), and any full-viewport fixed overlay
with live pointer events (a click-blocker detector).

**Result of the sweep (after Phase 1 fixes):** every route returns **200** with interactive
elements present; **no `pageerror`**, **no click-blocking overlay**, and the only console
error remaining before the fix — `/building/rooms/[id]` on a malformed id — is resolved.
The `_rsc … net::ERR_ABORTED` entries seen during the sweep are **benign** Next.js App
Router prefetch cancellations (the crawler navigates away before a `<Link>` prefetch
resolves); they are not user-facing failures and do not occur during normal use.

Status legend: **AUTO** = exercised by the automated production sweep (renders + interactive
census + error capture); **E2E** = covered by a Playwright action test; **CODE** = behavior
verified by reading the implementation; **PENDING** = per-action click test to be added in
Phase 9. Existing Playwright action coverage: **48 tests** across 10 specs.

## Systemic button standard (applies to every mutating action)

Verified in `src/components/submit-button.tsx` (`SubmitButton`) and used app-wide:
- Real submit target; disabled + `aria-busy` while `pending` (spinner) → **double-click safe**.
- Optional Arabic `confirmText` (`window.confirm`) before critical actions.
- Server-side authorization on the action (RBAC `requirePermission`), audit logging on data change.
- Arabic success/error surfaced by the server action; route-level Arabic error boundary
  (`src/app/(app)/error.tsx`) + new root boundary (`src/app/global-error.tsx`).

### Session-expiry standard

Server actions re-check the session; on expiry the action returns a typed result that stops
the pending state and shows the required Arabic message («انتهت الجلسة. لم يتم تنفيذ
الإجراء. سجّل الدخول ثم ارجع إلى الصفحة.») with a **validated** `returnTo` link (see commit
`eac498d`, import-confirm path). Phase 9 extends an automated expiry test to more actions.

## Route inventory (37 authenticated routes + `/login`)

| Module | Route | Interactive census (sweep) | Status |
| --- | --- | --- | --- |
| Auth | `/login` | user/password fields, «تسجيل الدخول» | AUTO + E2E (`arabic-and-auth`) |
| Dashboard | `/dashboard` | 4 btns / 50 links (work-center deep links) | AUTO + E2E (`workflows`) |
| Pilot center | `/pilot` | 4 btns / 37 links | AUTO + E2E (`feedback`) |
| Imports | `/imports`, `/imports/new`, `/imports/[id]` | preview/correct/defer/confirm | AUTO + E2E (`import-decisions`, `import-commit`, `plan-import`) |
| People | `/people`, `/people/new`, `/people/[id]` | 4 btns / 33 links | AUTO + E2E (`workflows`) |
| Operational plan | `/plan`, `/plan/[id]`, `/plan/[id]/report`, `/plan/followup`, `/plan/kpis`, `/plan/risks` | 4 btns each | AUTO + E2E (`plan-import`, `workflows`) |
| Evidence | `/evidence` | 4 btns / 28 links | AUTO + E2E (`workflows`) |
| Documents | `/documents` | 5 btns / 29 links | AUTO |
| Committees | `/committees`, `/committees/[id]`, `/committees/[id]/meetings/[mid]`, `/committees/[id]/report`, `/committees/templates`, `/committees/meeting-types` | templates 10 btns, meeting-types 14 btns | AUTO + E2E (`workflows`) |
| Performance | `/performance`, `/performance/models`, `/performance/models/[id]`, `/performance/cycles/[id]`, `…/sessions/[sid]` | 4–5 btns | AUTO + E2E (`workflows`) |
| Tasks | `/tasks` | 5 btns / 28 links | AUTO |
| Calendar | `/calendar` | 4 btns / 28 links | AUTO |
| Notifications | `/notifications` | 5 btns / 36 links | AUTO |
| Reports | `/reports`, `/reports/executive` | 4–5 btns | AUTO + CODE (`report-actions`) |
| Building | `/building` | 8 btns / 36 links | AUTO |
| Rooms | `/building/rooms/[id]` | 5 btns; malformed id → clean 404 (fixed) | AUTO + CODE |
| Assets | `/building/assets` | active/archived filter, condition, «أرشفة الأصل», «استعادة الأصل», «حذف نهائي», history | AUTO + E2E-verified + integration (`asset-lifecycle`) — **Phase 2 done** |
| Inspections | `/building/inspections` | readiness + «قوالب الفحص» link + approve draft | AUTO |
| Inspection templates | `/building/inspections/templates` (+`new`,`[id]`,`[id]/edit`) | create/edit/preview/duplicate/activate/deactivate/new-version/delete + section/item editor | E2E-verified + integration (`inspection-templates`) — **Phase 3 done** |
| Maintenance | `/building/maintenance` | 5 btns | AUTO |
| Building 3D | `/building/3d` | 4 btns | AUTO |
| Building editor | `/building/editor/[floorKey]` | canvas editor | **Phase 6 rebuild** |
| Offline inspection | `/building/offline` | 6 btns; **hydration #418 fixed** | AUTO |
| AI assistant | `/assistant`, `/assistant/drafts` | 4 btns | AUTO + E2E (`assistant`) |
| Admin — users | `/admin/users` | 5 btns | AUTO |
| Admin — audit | `/admin/audit` | 4 btns | AUTO |
| Admin — backup | `/admin/backup` | 4 btns | AUTO |
| Admin — settings | `/admin/settings`, `/admin/settings/ai` | 5–6 btns | AUTO |
| Admin — cleanup | `/admin/cleanup` | 5 btns | AUTO + E2E (`cleanup`) |
| Admin — feedback | `/admin/feedback`, `/admin/feedback/[id]` | 5 btns | AUTO + E2E (`feedback`) |
| Feedback dock | (global) «إرسال ملاحظة» | floating, bottom-`end`, z-30 | AUTO + E2E (`feedback`) |
| AI dock | (global) | floating, bottom-`start`, z-30 | AUTO + E2E (`assistant`) |

Mobile: the feedback and AI docks sit in opposite bottom corners (bottom-`end` / bottom-`start`)
and were confirmed non-overlapping and non-blocking at 390×844 (`feedback.spec`, `mobile.spec`,
and the overlay detector in this sweep). No page-level horizontal overflow on swept routes.

## Phase 1 root causes and fixes

1. **Hydration mismatch on `/building/offline` (React #418).** `useState` lazy initializer
   read `navigator.onLine` during client hydration → server/client text mismatch that can
   break interactivity on that subtree. **Fix:** deterministic initial `true`, real value read
   in `useEffect` (`offline-ui.tsx`). Confirmed gone in the post-fix sweep.
2. **Unsafe PWA / service-worker design.** Old `sw.js` used a constant cache name (never
   purged across deploys) and registered at scope `/` from one visit to the offline page.
   **Fix:** rewrote `public/sw.js` — navigations/RSC/server-actions are **network-first
   (never cached)** so no stale authenticated HTML/chunks post-deploy; cache-first only for
   immutable hashed `/_next/static/` and the dedicated offline page; versioned cache
   (`madrasa-v2`) purged on activate; `skip-waiting` message channel.
3. **No update path / no chunk-error recovery.** **Fix:** new global `PwaManager`
   (`src/components/pwa-manager.tsx`, mounted in `(app)/layout.tsx`) registers the SW
   app-wide, shows the Arabic update notice «يتوفر تحديث جديد للمنصة» + «تحديث الآن», reloads
   on `controllerchange`, and performs a **guarded one-time** `ChunkLoadError` recovery
   (clear caches + unregister SW + reload; `sessionStorage` flag prevents reload loops). New
   root `global-error.tsx` gives an Arabic recovery screen for chunk/layout errors.
4. **Malformed `[id]` → server error.** `/building/rooms/x` threw a Postgres uuid-cast error
   (500-class) before the `notFound()` guard. **Fix:** `isUuid` guard (`src/lib/validation.ts`)
   → clean 404. (Same pattern to be swept across other `[id]` routes in Phase 9.)

**Assessment:** the principal's "all buttons don't work" is **not** a universal per-button code
defect — all routes render with functioning interactive elements and the shared `SubmitButton`
is correct. The real-world failure is consistent with **stale PWA/browser cache after a
redeploy** (dead chunks → no JS → no interactivity), aggravated by the offline-page hydration
break. Fixes above remove both the cause and give a self-healing recovery path.

## Quality Gate 1 status

- Production-build render + interactive census + error/overlay capture across all 37 routes,
  principal role, valid session — **PASS (AUTO)**.
- **PENDING (Phase 9):** scripted per-action click matrix across desktop / tablet / 390×844,
  principal + administrator roles, and the valid / expired-session / validation-failure /
  server-failure / repeated-click states, extending the existing 48 Playwright action tests.
