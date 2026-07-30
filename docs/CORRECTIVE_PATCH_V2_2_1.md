# Corrective Patch v2.2.1 — Building-Sketch Controls + Three-State Program Workflow

**Date:** 2026-07-30 · **Branch:** `scope-v2.1-corrections` · **RC head:** `936c7c0`
(`e88add8` = Issue 1, `936c7c0` = Issue 2) · **Production baseline:** migration 22,
image `madrasa-app:0.1.0-v2_2-rc` (`sha256:b13382d15423…`), deployed 2026-07-29.

**Status: READY — NOT APPLIED TO PRODUCTION.** The patch was rehearsed end-to-end on an
isolated production clone (§6) and stopped, per instruction, before touching production.

---

## 1. Issue 1 — Building-sketch controls: root cause

The controls in `/building` (`FloorViewer`) were broken by six compounding defects, not one:

| # | Defect | Effect the user saw |
|---|--------|--------------------|
| 1 | `MIN_SCALE = 1` with initial scale 1 | **− and ⟲ were provable no-ops** from the default view — the first two buttons a user tries "do nothing" |
| 2 | CSS `transform: translate(px) scale()` applied to the root `<svg>`; SVG's default `transform-box` is `view-box`, so `transformOrigin: "center center"` resolved in viewBox units while the translation was in CSS px | Zoom origin drifted; pan gain wrong by `clientWidth / viewBoxWidth`; + felt broken even though it "worked" |
| 3 | `touch-action: pan-y pinch-zoom` at scale 1 | Two-finger pinch was handed to the **browser page zoom**; the component's pinch code could never run from a cold start (`pointercancel` fires first) |
| 4 | No `wheel` handler existed anywhere | Desktop mouse-wheel/trackpad did nothing to the sketch and scrolled the page instead |
| 5 | No fit-to-view existed in the viewer (only in the editor) | Requirement 5 unimplementable; the `site` floor rendered with large dead margins (bounds forced to include the origin) |
| 6 | Controls pinned `top-2` with `z-10` under the sticky `z-20` app header; pointerup outside the container leaked entries in the pointers map | After scrolling, taps landed on the header; a leaked pointer made the next touch register as a phantom pinch, permanently blocking room-tap navigation (`moved` stuck true) |

Minor: buttons lacked `type="button"` and tooltips; view state survived floor switches
carrying stale coordinates; `setPointerCapture` targeted a re-rendered SVG node.

### Fix

Rewritten around **viewBox-based view math** — no CSS transform, no px/viewBox mixing:

- `src/lib/building/viewer-view.ts` (new, pure, unit-tested): scale clamped **0.5–8**
  (`VIEWER_MIN_SCALE`/`VIEWER_MAX_SCALE`), view window clamped inside the base viewBox so
  the drawing can never be panned out of sight, `zoomAtPoint` keeps the point under the
  cursor fixed, `fitToContent` frames the actual shape bounding box (kills dead margins).
- `floor-viewer.tsx`: four controls — **تقريب / إبعاد / ملاءمة المخطط للشاشة / إعادة ضبط
  العرض** — each `type="button"` with Arabic `aria-label` + `title`, moved to the **bottom**
  corner (never under the sticky header); non-passive native `wheel` listener (React's
  `onWheel` is passive — `preventDefault` requires a native listener) zooming about the
  cursor without scrolling the page; pinch about the finger midpoint with container capture;
  `touch-action` is `pan-y` at rest (one finger scrolls the page, pinch reaches the app) and
  `none` while zoomed (pan owns the gesture); pointer-leak cleanup via
  `onPointerLeave`/`onLostPointerCapture`; room-tap navigation and single-tap behavior
  preserved (`moved` guard, capture on the tapped node).
- `building/page.tsx`: `key={active.key}` on `FloorViewer` — floor switching resets the view
  instead of inheriting another floor's coordinates.

No server action, schema, or data path was touched by Issue 1 — the navigation controls are
pure client view state (proven in tests: zero non-GET requests during interaction).

## 2. Issue 2 — Three-state program workflow implemented

```
قيد التنفيذ ── تعليم البرنامج كمكتمل ──▶ مكتمل ── إقفال البرنامج نهائياً ──▶ مغلق
قيد التنفيذ ◀── إعادة البرنامج للتنفيذ ── مكتمل ◀── إعادة فتح البرنامج ────── مغلق
```

- State is **derived solely** from `programs.completedAt` / `closedAt`
  (`src/lib/plan/lifecycle.ts`). No evidence counts, activity percentages, milestones,
  readiness scores, or mandatory fields anywhere in the derivation or the transitions
  (D-024/D-025 upheld). The lifecycle axis is independent of approval (`status`), of
  year-lock (`مقفل`), and of archiving (`archivedAt`).
- **تعليم البرنامج كمكتمل** (`completeProgramAction`, `plan.write`): confirmation dialog,
  optional note, records `completedAt`/`completedBy`/`completionNote`, aligns the displayed
  `executionStatus` to «مكتمل». The program **remains fully editable** — evidence/documents
  still addable, finance references untouched. Atomic
  (`WHERE completed_at IS NULL AND closed_at IS NULL`) → repeated or concurrent submissions
  produce exactly one history row.
- **إقفال البرنامج نهائياً** (`closeProgramAction`, `plan.approve`): now **requires
  completion first** — a قيد التنفيذ program gets the Arabic error «الإقفال النهائي متاح
  للبرامج المكتملة فقط — علّم البرنامج كمكتمل أولاً ثم أقفله» and the UI only offers closure
  on completed programs (no silent direct close; this replaces the previous direct-close).
  Confirmation states the program becomes **read-only**; note optional; records
  `closedAt`/`closedBy`; removes the program from operational lists; keeps it in historical
  reports/views; idempotent as before.
- **Read-only when closed** — enforced server-side, not just in the UI:
  `updateProgramExecutionAction`, `submitFollowupAction`, `createChangeRequestAction` refuse
  closed programs; the evidence panel is view-only; the entity registry marks closed
  programs locked so linked evidence cannot be unlinked. Viewing, reporting, printing and
  exporting remain available (report link, report centre, exports untouched).
- **إعادة فتح البرنامج** (`reopenClosedProgramAction`): restores to **مكتمل** — never
  automatically to قيد التنفيذ. Records `reopenedAt`/`reopenedBy`. Programs closed **before
  this patch** (real production has 3, all with `completedAt` NULL) are backfilled via SQL
  `COALESCE(completed_at, closed_at)` / `COALESCE(completed_by, closed_by)` — their
  completion moment becomes the original closure moment, and nothing existing is overwritten.
  Idempotent.
- **إعادة البرنامج للتنفيذ** (`resumeProgramAction`, on completed programs): مكتمل →
  قيد التنفيذ, clears current-state completion columns only, restores «في المسار» when the
  execution status was the completion echo, idempotent.
- **Audit history (§E)** — the append-only `program_closure_history` gains nullable
  `from_status`/`to_status`; actions are «اكتمال» / «إقفال» / «إعادة فتح» / «إعادة للتنفيذ».
  Existing rows are never updated or backfilled (their from/to stay NULL). Every transition
  also writes an `audit_log` entry (`program.completed`, `program.closed`,
  `program.closure_reopened`, `program.resumed`).
- **UI & reporting (§D)** — the program page gets a «حالة البرنامج» card: current state
  badge, completion date, closure date (dual Hijri/Gregorian), last responsible user, next
  available action, per-state action forms, and the full transition log with from→to, actor
  and note. Completed banner (green) and a read-only closed banner. `/plan` shows lifecycle
  badges and a three-state filter (`?حالة=…`) with counts; closed programs stay in their
  historical section. Report centre: new «البرامج المكتملة» report; «سجل تحولات حالة
  البرامج» now shows from/to columns; «البرامج المغلقة»/النشطة unchanged in behavior.
  A completed program no longer raises the weekly-follow-up-due nag in the list.

## 3. Changed files

**Issue 1 (`e88add8`)** — `src/lib/building/viewer-view.ts` (new),
`src/app/(app)/building/floor-viewer.tsx` (rewritten), `src/app/(app)/building/page.tsx`,
`tests/unit/viewer-view.test.ts` (new), `tests/e2e/building-viewer.spec.ts` (new).

**Issue 2 (`936c7c0`)** — `src/db/schema/plan.ts`, `drizzle/0022_steep_joystick.sql` +
`drizzle/meta/*` (new migration), `src/lib/plan/lifecycle.ts` (new),
`src/app/(app)/plan/actions.ts`, `src/app/(app)/plan/[id]/page.tsx`,
`src/app/(app)/plan/[id]/program-ui.tsx`, `src/app/(app)/plan/page.tsx`,
`src/components/ui.tsx` (badge colors), `src/lib/reports/catalog.ts`,
`src/lib/reports/loaders.ts`, `src/lib/entity-registry.ts`,
`tests/unit/program-lifecycle-states.test.ts` (new),
`tests/integration/program-lifecycle.test.ts` (rewritten for the new contract),
`tests/integration/report-center.test.ts` (extended),
`tests/e2e/program-lifecycle.spec.ts` (new).

## 4. Migration impact

`drizzle/0022_steep_joystick.sql` — **three ALTER TABLE ADD COLUMN, all nullable, nothing
else**: `programs.completion_note text`, `program_closure_history.from_status text`,
`program_closure_history.to_status text`. No new tables, no defaults, no backfill, no index
changes, no seed. `completedAt`/`completedBy` already existed (retained-nullable D-024
columns, until now unused) and are reactivated with direct-completion semantics — no schema
change needed for them. **Old code runs unmodified against the migrated schema** (it simply
ignores the three new columns), which makes the app-image rollback non-destructive (§7).

## 5. Test results (all gates)

| Gate | Result |
|---|---|
| `tsc --noEmit` (strict) | 0 errors |
| `eslint .` | 0 errors / 0 warnings |
| `next build` (production) | clean |
| Focused unit (viewer math + lifecycle) | 24/24 |
| Focused integration (program lifecycle + reports + plan workflow) | 92/92 |
| **Full Vitest** | **644 passed / 0 failed** (was 610 pre-patch; +34) |
| Focused Playwright — building sketch (desktop + 390×844) | 2/2 |
| Focused Playwright — program full cycle via real UI | 1/1 |
| **Full Playwright regression** | **76 passed / 1 skipped** (the skip is the permanently deferred C5 HTTPS gate — unchanged) |

Covered explicitly: +/− clicks, repeated clicks to both scale limits, reset, fit, pan,
wheel-zoom without page scroll, floor switching, mobile viewport, zero console errors, zero
non-GET requests from navigation controls; قيد التنفيذ→مكتمل, مكتمل→مغلق, مغلق→مكتمل,
مكتمل→قيد التنفيذ, closure with no evidence and empty optional fields, read-only closed
state, evidence/documents preserved, reports keep the record, repeated + concurrent clicks
creating no duplicate history, and reopening a legacy-closed (pre-patch) program.

## 6. Rehearsal on an isolated production clone — PASS

A fresh read-only `pg_dump` of live production (migration 22, 83 tables) was restored into a
disposable database `madrasa_patch_clone_test` on the dev Postgres container.

1. **Migration rehearsal:** ledger 22 → 23; tables still 83; every count identical
   (programs 29 · closed 3 · closure-history 7 · people 54 · documents 33 · evidence 30 ·
   KPIs 15 · risks 9 · audit 424 · SWOT 0); four fingerprints byte-identical pre/post,
   including the D-022 legacy fingerprint `4572c57060e20c4b0de4db52545a8e3f` and a
   programs-table + closure-history fingerprint computed for this rehearsal; the three new
   columns present and 100 % NULL.
2. **Workflow rehearsal (real app on :3082 against the clone, clone-only login):**
   reopening a **real** legacy-closed program returned it as «مكتمل» with its completion
   moment backfilled to exactly its original closure timestamp (verified by SQL:
   `completed_at = 2026-07-29 20:44:15.469+00` = its prior `closed_at`); a fresh program ran
   the full cycle producing exactly 4 ordered history rows with correct from→to; pre-patch
   history rows untouched (from/to still NULL); closed page read-only; the three-state
   filter, the three reports, and the building-sketch controls all verified on
   production-shaped data — 23/23 checks passed (two initial script races re-verified).
3. **Cleanup:** clone database dropped; every dump and temporary file deleted; production
   was only ever read (one `pg_dump`, one baseline query); production containers untouched.

## 7. Production patch plan (NOT executed — awaiting approval)

Mirrors the v2.2 controlled deployment; expected downtime ≈ 60–90 s; **the db container is
never restarted**.

```bash
# 0) Preconditions: RC head 936c7c0 checked out clean; gates re-run if anything changed.
# 1) Build & freeze the image (linux/arm64):
docker build -f Dockerfile.production -t madrasa-app:0.1.0-v2_2_1-rc .
docker images --digests | grep v2_2_1-rc          # record the digest
# 2) Tag the rollback image BEFORE anything else:
docker tag madrasa-app:0.1.0 madrasa-app:0.1.0-prev-v2_2_1-20260730
# 3) Fresh encrypted backup inside the prod network + verify (checksums, pg_restore --list):
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm init sh -c 'npm run backup:daily'
# 4) Record pre-deploy baselines (counts + legacy fp 4572c570… + docs fp) — §3.4 queries.
# 5) Retag & deploy (migrate-only init, seed unreachable as proven in v2.2):
docker tag madrasa-app:0.1.0-v2_2_1-rc madrasa-app:0.1.0
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod stop app
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod run --rm init   # migration 22→23 only
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod up -d app
# 6) Post-checks: /api/health; running digest == recorded digest; ledger 23; counts and both
#    fingerprints unchanged; new columns 100% NULL; db container StartedAt/RestartCount unchanged.
# 7) Authenticated smoke (principal): /building controls (+/−/ملاءمة/⟲/سحب) on every floor;
#    on ONE test program (created then archived, or a designated trial): complete → close →
#    reopen → resume; verify the three real closed programs still show «مغلق» untouched.
```

## 8. Rollback plan

- **A) App-only rollback (non-destructive, preferred).** Migration 0022 is additive and
  nullable, so the previous image runs correctly against the migrated schema:
  `docker tag madrasa-app:0.1.0-prev-v2_2_1-20260730 madrasa-app:0.1.0 && docker compose … up -d app`.
  No DB action needed; any `completion_note`/`from_status`/`to_status` values already
  written simply stop being displayed (and are preserved for a re-deploy).
- **B) Column rollback (only if explicitly demanded):** the three columns can be dropped
  (`ALTER TABLE … DROP COLUMN`) losing only data written by the new feature — not required
  for (A) and not recommended.
- **C) Full data restore (destructive, last resort only):** restore the step-3 backup via
  `scripts/restore.sh` — discards everything entered since the backup; only for corruption.

## 9. Notes and small judgment calls (for review)

- Completed programs stop raising the weekly-follow-up-due nag in `/plan`; follow-ups
  themselves remain possible (the program is editable) until closure.
- Completion/resume use `plan.write`; closure/reopen keep `plan.approve` (existing split:
  execution-level vs authority-level actions).
- The closure-history report was retitled «سجل تحولات حالة البرامج» to cover the two new
  transition kinds; its key (`program-closure-history`) is unchanged.
- Marking completed sets `executionStatus` to «مكتمل» (the existing follow-up vocabulary);
  resuming restores «في المسار» only if it still reads «مكتمل».
- New code comments follow the repository's established Arabic-domain-comment practice
  (consistent with all post-policy v2.2 code).
