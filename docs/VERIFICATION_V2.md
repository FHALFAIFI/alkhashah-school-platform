# Verification Report — Scope v2 (Steps 12–13)

**Date:** 2026-07-23. All checks run against `madrasa_test` / disposable databases and a
`next start` production server. Production was never used for tests.

## Automated tests

| Suite | Result |
|---|---|
| Vitest (unit + integration + authorization + migration) | **273 passed** (50 files) |
| Typecheck (`tsc --noEmit`) | clean |
| Lint (`eslint .`) | 0 errors, 0 warnings |
| Production build (`next build`) | clean — all routes compile, incl. `/budget`, `/building/facilities` |

New test coverage this scope: `activity-progress` (16), `readiness` (11),
`milestone-migration` (7), `activity-workflow` (8), `employee-type` (5), `safe-delete` (9),
`document-identity` (5), `committee-assignment` (3), `budget-calc` (5), `budget` (3),
`facilities` (3), `perf-signed-reports` (3), plus rbac and evidence extensions.

## Migration verification (disposable databases)

- **Empty database** → all 16 migrations apply → 76 tables.
- **Current-schema (production clone)** → prod's exact state (0009 + its 10 tracking rows)
  → applies **only 0010–0015** → 16 tracking rows, all new tables created,
  `program_milestones` untouched.
- **Legacy→activity reconciliation** → proven on a fixture seeded to the real production
  shape (129 milestones: 25×5 + 1×4): every milestone maps exactly once, no orphans, no
  duplicates, no dangling refs, program association unchanged, weight/progress carried without
  drift, idempotent on re-run, legacy table row-count unchanged.

## Browser / RTL / mobile (Playwright, real WebKit, 390×844 + 1280px)

Run against a `next start` production server on `madrasa_test`:

| Spec | Result |
|---|---|
| `mobile.spec.ts` — no-horizontal-overflow sweep across all routes (incl. `/budget`, `/building/facilities`), ≥16px inputs, ≥44px touch targets, drawer behavior | **5 passed** |
| `scope-v2.spec.ts` — real button clicks: facilities add→status, budget render, 3-level reports | **3 passed** |
| `arabic-and-auth.spec.ts` | passed |
| `import-decisions.spec.ts` — undoable decisions + desktop table | **4 passed** (with e2e fixtures seeded) |

**Bug found and fixed by e2e:** `building/facilities/actions.ts` had `"use server"` while
exporting two constants; a use-server file may only export async functions, so every action
in the module failed at runtime. Constants moved to `constants.ts`; re-verified green.

## Docker health / persistence (production stack, read-only checks)

- `madrasa-prod-app-1` healthy on `192.168.0.48:3080`; `madrasa-prod-db-1` healthy.
- PostgreSQL not published; Ollama host-only — neither exposed.
- Production DB unchanged throughout: migration 0009, 54 people / 26 programs / 129 milestones.

## Backup / restore / rollback

- Fresh encrypted weekly backup: `full-20260723-190243.tar.gz.enc`, sha256
  `63c42bbd2bc3d91cd5ad91a891f8a01edea1d8d4ff3f820e90f32cb3aa293e75`.
- Disposable restore rehearsal: **PASS** (66 tables, 2 users, 11 files).
- Rollback documented and corrected (D-023): application rollback preferred; schema drop only
  before data exists or after verified export. Full runbook in `docs/DEPLOYMENT_PLAN_V2.md`.

## Not done / deferred

- Full Playwright suite (all 15 spec files across all viewports) was not run end-to-end in one
  pass; the representative specs above were run against the production server. The pre-existing
  `workflows.spec.ts` still encodes the old milestone flow and needs rewriting to the activity
  model before it will pass — tracked as follow-up, not a product defect.
- Production deployment: **not executed** — awaiting owner authorization per the plan.
