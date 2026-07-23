# Scope-Impact Analysis — Product Scope Refinement v2 (principal feedback round 2)

**Status:** Section 2 **IMPLEMENTED** (commit `8b70305`). Sections 1 and 3 analyzed only —
the source prompt was truncated mid-section 3; sections 4+ are not yet available.
See "Open scope gap" and "Delivery log" at the end.

**Date:** 2026-07-23
**Baseline commit:** `4243908` (Phases 0–10 complete)
**Working tree at analysis time:** modified `compose.production.yml`, `src/lib/auth/session.ts` (uncommitted, pre-existing)

Core product principle driving every decision below:

> «إدخال المعلومة مرة واحدة، ثم إعادة استخدامها في جميع الوحدات والتقارير.»

---

## 0. Environment as inspected (no changes made)

| Item | State |
|---|---|
| Production stack | Docker project `madrasa-prod` — `madrasa-prod-app-1` up 46h (healthy) on `192.168.0.48:3080`, `madrasa-prod-db-1` up 3d (healthy), Postgres **not** published |
| Dev DB | `madrasa-db` container, host port 5544 |
| Migrations on disk | `0000` … `0009` (10 files) |
| Schema | 66 tables across 9 schema modules (`src/db/schema/*.ts`) |
| App routes | 57 `page.tsx` routes; 15 `actions.ts` server-action modules |
| Tests | 12 unit + 26 integration vitest files; 13 Playwright specs. Last recorded gate: 193 vitest, 52 Playwright passed / 1 skipped (C5, deferred D-018) |
| Protected data | Fares employee batch and official operational-plan batch remain «معاينة» — untouched |

**Migration policy for this engagement:** next migration number is `0010`. All migrations
additive (new tables, new nullable columns, new indexes). No `DROP`, no `NOT NULL` on
existing populated columns, no type narrowing. Apply order: `madrasa_test` → verify →
clean production DB.

---

## 1. Section 2 — Shared product model

### 1.1 Employee database

The `people` table (`src/db/schema/school.ts:34`) is already the single employee register,
and it is already the referenced authority for performance cycles, committee membership,
program ownership, tasks and maintenance. Most of this requirement is **already met**.

**Reuse as-is (no change):**

| Requirement | Existing implementation |
|---|---|
| Excel import with preview → validation → correction → explicit approval | `src/lib/imports/framework.ts` + `people.ts`; `/imports`, `/imports/[id]`; itemized race-safe approval; transactional commit + rollback |
| Manual employee creation | `createPersonAction` — `people/actions.ts:25`, route `/people/new` |
| Employee editing | `updatePersonAction` — `people/actions.ts:38`, route `/people/[id]` |
| Employee viewing | `/people`, `/people/[id]` |
| Deactivation / reactivation | `deactivatePersonAction` (:51) / `reactivatePersonAction` (:62); `people.active`, `deactivated_at`, `deactivate_reason` |
| Duplicate detection | job number + name matching in the import path; covered by `tests/integration/import-dedup.test.ts` |
| Active/inactive status | `people.active` |
| Historical name/assignment preservation | `perf_cycles` freezes model + calendar snapshots; `documents.html_snapshot` freezes issued reports; `record_versions` for versioned entities |
| No per-module duplicate employee maintenance | Committees, performance and program ownership all FK to `people.id`; committee members are constrained to the school register |

**Requires modification:**

| # | Gap | Change | Risk |
|---|---|---|---|
| E1 | `deletePersonAction` (`people/actions.ts:70`) checks only `perf_cycles` and `committee_members` before permanent delete. The complete 7-way dependency audit already exists as `peopleBatchDependencies` (`src/lib/imports/people-dependencies.ts`) but is only wired into batch rollback. A person owning a program, a task, a maintenance issue, a login account or a teaching stage can currently be hard-deleted. | Extract a per-person `personDependencies()` from the existing batch function; use it as the delete guard; return the Arabic dependency breakdown (`dependencySummaryAr`) so the user is told *which* records block deletion and that archive/deactivate is the alternative. | Low — additive, strictly narrows what can be deleted. No migration. |
| E2 | `people.category` values are `معلم` / `موظف`. Approved scope names the second type **«موظف إداري»**. | Display-layer relabel + accept both on read. Do **not** rewrite stored values (the Fares preview batch and official data use the current token) — map at the presentation boundary, or add an additive `employee_type` column defaulting from `category`. Decision required (see D-019 below). | Medium — touches the uncommitted Fares batch classification labels. Must not alter preview rows. |
| E3 | Deactivation reason is free text with no reactivation audit symmetry check. | Minor: ensure both transitions audit with reason. | Low |

**New:** none required at the schema level for the employee register itself.

### 1.2 Shared evidence

**This is largely already built.** `evidence_items` + `evidence_links`
(`src/db/schema/shared.ts:30-69`) is already a polymorphic many-to-many model: one evidence
record links to N records of any entity type, with a `sub_key` for indicator-level linking
and a uniqueness index preventing duplicate links. The "do not upload the same receipt
twice" requirement is structurally satisfied today.

**Reuse as-is:** the table pair, the unique index, `sub_key`, preview/rendering
(`src/lib/evidence-render.ts`, including PDF page-1 rendering), download via authenticated
`/api/files`, access control via `evidence.*` permissions, review workflow
(`review_status`, `review_note`), and the classification fields — `role` already carries
`خط أساس | تنفيذ | مخرج | أثر | خارجي`, which covers the four required classifications
(شاهد تنفيذ / شاهد مخرج / شاهد أثر / شاهد خارجي).

**Requires modification:**

| # | Gap | Change | Risk |
|---|---|---|---|
| V1 | Only 5 entity types are actually wired: `program`, `deliverable`, `meeting`, `perf_session`, `perf_rating`. The scope requires linking to **activity, budget expense, KPI session, committee, room, asset** as well. | Introduce a single typed registry of linkable entity types (label, resolver, permission) and drive both the link picker UI and `canDeleteEvidence` from it. Adding a type becomes one registry entry, not scattered conditionals. | Low — additive; existing links keep working. |
| V2 | `canDeleteEvidence` (`src/lib/evidence.ts:12`) hard-codes 4 tables; unknown link types fall through and are treated as deletable. Fail-open. | Fail-closed on unrecognized entity types, and drive from the V1 registry. | Low, corrective |
| V3 | Evidence has **no archive** — only hard delete (`deleteEvidenceAction`, `evidence/actions.ts:128`) which also cascades `evidence_links`. Scope requires archive. | Add `archived_at` / `archived_by` / `archive_reason` (migration 0010) + archive/unarchive actions; hard delete stays but only for unlinked, never-referenced evidence. | Low — additive columns |
| V4 | No **replacement / version history**. Replacing a document today means deleting and re-uploading, breaking every link. | Add `evidence_versions` (migration 0010): `evidence_id`, `version`, `file_id`, `replaced_by`, `replaced_at`, `reason`. Replacement bumps the version and preserves every existing link. | Low — new table |
| V5 | Metadata exists but there is no single "evidence library" entry point showing which records an evidence item is linked to. `/evidence` lists items; reverse-link view is partial. | Add reverse-link panel on the evidence detail view (read-only, derived from `evidence_links`). | Low |

### 1.3 Safe deletion

Currently implemented **per-module and inconsistently**:

| Entity | Today |
|---|---|
| Employee | Guarded delete, but incomplete guard (E1) |
| Evidence | Guarded delete, fail-open on unknown types (V2), no archive (V3) |
| Asset | Archive/restore + guarded permanent delete — migration 0008. **This is the reference implementation.** |
| Inspection template | Versioned + frozen snapshot — migration 0009 |
| Program / milestone / deliverable | `deleteMilestoneAction` (`plan/actions.ts:90`) has no historical-dependency guard |
| Room, budget item, committee, committee template | No unified guard |
| Synthetic records | Non-destructive archive with full snapshot + rollback — `archive_batches` / `archived_records`, `src/lib/cleanup-archive.ts` |

**New — shared deletion-safety layer:** a single `src/lib/safe-delete.ts` exposing
`describeDependencies(entityType, id)` → `{ blocked, dependencies: [{labelAr, count, route}] }`
and a uniform Arabic explanation, backed by an explicit per-entity dependency map. Every
delete action routes through it. Behaviour:

1. Unused and never referenced → permanent delete permitted.
2. Linked or historically used → archive/deactivate offered instead, with the specific
   Arabic dependency list.
3. Never silently cascade-delete historical records.
4. Every material change written to `audit_log` (`src/lib/audit.ts`).

This generalizes the asset-lifecycle pattern (0008) rather than inventing a new one.

---

## 2. Section 3 — Operational-plan redesign

Approved hierarchy:

```
الخطة التشغيلية
└── البرنامج
    └── الأنشطة
        └── المخرجات والمتطلبات والشواهد
```

Current hierarchy (`src/db/schema/plan.ts`):

```
plan_years
└── programs
    ├── program_milestones      (weighted, drives progress)
    ├── program_deliverables    (outputs + evidence packages)
    ├── program_roadmap_cells
    ├── program_followups
    └── program_change_requests
plan_years
    ├── program_kpis
    ├── program_risks
    └── plan_budget_items
```

**The «الأنشطة» (activities) level does not exist.** Programs link directly to
deliverables. This is the one structural change section 3 demands, and it is the largest
migration in the visible scope.

**Planned approach (additive, reversible):**

- New table `program_activities` (migration 0010): `id`, `program_id` FK, `sort_order`,
  `title`, `description`, `owner_person_id` → `people.id`, `period_text`, `hijri_start`,
  `hijri_end`, `weight`, `status`, `progress`, timestamps.
- `program_deliverables.activity_id` — **nullable** FK to `program_activities`. Existing
  26 official program deliverables keep `activity_id = NULL` and continue to render at
  program level; nothing breaks and the migration is reversible.
- Progress: `program_milestones` currently owns weighted progress (`src/lib/plan/progress.ts`).
  Whether activities replace milestones as the progress unit, or coexist, is **not
  specified in the truncated prompt** — see D-020.

**Cross-module dependencies of this change:** `src/lib/worklist.ts` (work center cards),
`src/lib/plan/progress.ts`, `src/lib/plan/followup.ts`, `/plan/[id]`, `/plan/[id]/report`,
program DOCX + plan XLSX exports (`src/lib/reports/`), the AI tool registry
(`src/lib/ai/tools.ts` — program brief), `src/lib/synthetic.ts` (activities must join the
20-bucket classifier so exclusion/archive stays complete), and the plan importer
(`src/lib/imports/plan.ts`).

---

## 3. Consolidated migration plan (0010)

Single additive migration, applied to `madrasa_test` first:

| Object | Type | Purpose |
|---|---|---|
| `program_activities` | new table | Section 3 hierarchy level |
| `program_deliverables.activity_id` | new nullable column + index | Attach outputs to an activity |
| `evidence_versions` | new table | V4 replacement/version history |
| `evidence_items.archived_at / archived_by / archive_reason` | new nullable columns | V3 archive |
| `people.employee_type` (pending D-019) | new nullable column | E2 without rewriting `category` |

No destructive statements. Rollback = drop the new objects; every existing row keeps
working because all new columns are nullable.

---

## 4. Redundant / burdensome workflows to simplify

Identified against the "enter once, reuse everywhere" principle:

1. **Program free-text fields duplicate structured data.** `programs` carries
   `kpi_text`, `target_text`, `deliverable_text`, `evidence_text`, `followup_text`,
   `indicator_text`, `baseline_text` *as text* while `program_kpis`,
   `program_deliverables`, `evidence_links` and `program_followups` hold the same
   information structurally. These text columns are verbatim official-source data and
   **must not be deleted** — but the editing UI should stop asking the principal to
   maintain both. Proposal: render them read-only as «من المصدر الرسمي» and drive all
   new entry through the structured tables.
2. **Owner entered twice.** `programs.owner_position` (text) alongside
   `programs.owner_person_id` (FK). Same for `action_tasks.owner_text` vs
   `owner_person_id`. Default to the employee register; keep text only as import fallback.
3. **Evidence re-upload across modules** — structurally solved by `evidence_links`, but
   the UI does not expose "link existing evidence" from every module (V1). This is the
   single highest-value simplification in the visible scope.
4. **Deliverable package fields** — `package_number`, `min_package_rule`, `storage_place`,
   `prep_owner`, `keep_owner` are mandatory-looking fields the school does not practically
   maintain. Candidate for optional/collapsed-by-default treatment.

---

## 5. Open scope gap — BLOCKING for sections 3+

The source prompt terminates inside section 3's code fence. Present and analyzable:
sections 1, 2, and the section 3 hierarchy diagram. **Absent:** section 3's actual rules
(field-level requirements, mandatory vs optional, progress model, approval workflow) and
every section after it. Section 2 explicitly references KPI cycles, budget expenses,
committees, meetings, rooms and assets as evidence-linkable — implying sections covering
those modules that were never received.

### Decisions required

- **D-019** — Employee type labelling. Rename display only (`موظف` → `موظف إداري`), or add
  an `employee_type` column? Stored values feed the uncommitted Fares preview batch
  classification (42 معلم / 10 موظف), so a stored rewrite would touch a protected batch.
  *Recommendation:* additive `employee_type` column, display-layer relabel, Fares preview
  rows untouched.
- **D-020** — Activity progress model. Do activities become the weighted progress unit
  (replacing/absorbing `program_milestones`), or do both coexist? This determines whether
  migration 0010 is purely additive or requires a data-migration path for the 64 existing
  milestones.

Both are recorded in `docs/DECISIONS.md`.

---

## 6. Delivery log

### Section 2 — delivered (commit `8b70305`, 2026-07-23)

| Area | What shipped |
|---|---|
| E1 | `deletePersonAction` routes through `assessDeletion("person", id)` — all 9 reference sites (was 2). `DependencyNotice` renders the Arabic breakdown; the delete button is not rendered at all while blocked. |
| E2 | `people.employee_type` + `src/lib/employee-type.ts`. «معلم» / «موظف إداري» derived from `category` when the column is empty, so no existing row is rewritten and the protected Fares batch is untouched. Forms, list, filters and detail header all switched. |
| E3 | Deactivation reason surfaced on the person page; both transitions audited. |
| New | Duplicate detection on manual create/edit — job number first, then full name; points the user at the existing record instead of creating a second one. |
| V1 | `src/lib/entity-registry.ts` — 12 linkable entity types (was 5 hard-coded), each with Arabic label, route, permission and locked-state resolver. Drives the link picker *and* the delete guard from one definition. |
| V2 | `canDeleteEvidence` is now fail-closed; unrecognized link types block deletion instead of passing silently. |
| V3 | Evidence archive/restore — non-destructive, mandatory Arabic reason, no link deleted. `evidenceForEntity` excludes archived by default (`includeArchived` opt-in). |
| V4 | `evidence_versions` + `replaceEvidenceContentAction`. Replacement snapshots the old version and keeps `evidence_items.id`, so every existing link survives with nothing to re-link. Returns the item to «لم يراجع». |
| V5 | New `/evidence/[id]`: metadata, **"مستخدم في"** across modules, version history, replace, archive/restore, guarded delete. |
| §2.3 | `src/lib/safe-delete.ts` — `assessDeletion` for 11 entity types with Arabic dependency counts + the archive/deactivate alternative. Generalizes the asset-lifecycle pattern (0008); asset behaviour deliberately unchanged. Wired into person, evidence and milestone deletes. |
| Simplification #3 | `EvidencePanel` gains «ربط شاهد قائم» — search the library and link an already-uploaded document — and its per-item action became «فك الربط» rather than delete. This is the change that actually stops the same receipt being uploaded twice, and it propagates to every module using the panel. |

**Deliberate behaviour change:** evidence with *any* link can no longer be permanently
deleted (previously allowed when the linked record was a draft). The scope permits deletion
only for unused records, and archive now exists as the alternative.
`tests/integration/evidence.test.ts` was updated to assert the stricter rule — not weakened.

**Gates:** typecheck clean · lint 0 errors 0 warnings · production build clean ·
**vitest 208 passed** (was 193; +15 new tests across `tests/unit/employee-type.test.ts`,
`tests/integration/safe-delete.test.ts`, `tests/integration/evidence.test.ts`).

### Deletes that have no UI action yet

`assessDeletion` covers program, budget item, committee, room, committee template and
inspection template, but no delete action exists for them in the app — so there was nothing
to wire. The layer is ready when those actions are built. Existing guarded deletes left
intact: `deleteAssetAction` (its own richer confirm-phrase flow) and
`deleteMeetingTypeAction` (already correct).

### Production state — IMPORTANT correction to the prior checkpoint

`PROGRESS.md` (2026-07-20) records production as a clean baseline with "zero operational
records". **That is no longer true.** Inspection on 2026-07-23 found the principal committed
both real batches manually on 2026-07-21:

| Batch | Status | Committed |
|---|---|---|
| `الخطة_التشغيلية_المتكاملة_لمجمع_الخشعة_1448_1449.xlsx` | **منفذة** | 2026-07-21 17:27 UTC |
| `بيانات الموظفين في فارس.xlsx` | **منفذة** | 2026-07-21 18:48 UTC |

Production now holds real school data: 54 people, 26 programs, 129 milestones, 312 roadmap
cells, 123 performance indicators, 88 audit entries, 1 feedback record. Every future change
must treat this as live data, not a disposable baseline.

### Migration 0010 — applied to `madrasa_test` only

Not yet applied to production. A full encrypted backup was taken
(`/data/backups/weekly/full-20260723-141549.tar.gz.enc`, sha256
`38095ed26a4b78bb5a3f88891bb3b3521ac73d2e9c193e09925a7b1b97c7c37d`) and
`npm run restore:rehearsal` **PASSED** against it (66 tables, 2 users, 10 file records /
11 files restored) — so the rollback path is proven. The apply step itself was blocked by
the environment's write-permission guard on the production database and needs operator
authorization.

Apply command once authorized (migrate only — **not** `seed.ts`, which must not re-run
against live data):

```bash
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm --build --no-deps init npx tsx src/db/migrate.ts
```

The running `app` container keeps the previous image until explicitly recreated, so the
DB migration and the UI cutover are independent decisions. Migration 0010 is additive only,
so the currently-deployed app is unaffected by it (Drizzle emits explicit column lists, never
`SELECT *`).

---

## 7. Discipline checklist for this engagement

- [x] Repository, schema, migrations, routes, tests, Docker production inspected before any change
- [x] Requirements mapped against existing implementation
- [x] Scope-impact document created (this file)
- [x] Migration 0010 authored (additive, reversible — no DROP, no narrowing)
- [x] Applied to `madrasa_test` + write tests green (208 vitest)
- [x] Fresh encrypted production backup taken **and restore-verified** before any prod step
- [ ] Applied to production DB — **blocked, needs operator authorization** (see §6)
- [x] Production DB / volumes never reset, recreated, reseeded or deleted
- [x] Feedback, audit history, uploads, backups, recovery checkpoints preserved
- [x] No Fares / operational-plan / building / KPI / budget import executed by the agent
      (both real batches were committed by the principal manually on 2026-07-21 — see §6)
- [x] No fake operational or demo data in production
- [x] No release tag
- [x] Committed at each validated gate (`0c16f66` analysis, `8b70305` section 2)
