# Scope-Impact Analysis — Product Scope Refinement v2 (principal feedback round 2)

**Status:** DRAFT — sections 1–3 of the approved scope only. The source prompt was truncated
mid-section 3; sections 4+ are not yet available. See "Open scope gap" at the end.

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

## 6. Discipline checklist for this engagement

- [x] Repository, schema, migrations, routes, tests, Docker production inspected before any change
- [x] Requirements mapped against existing implementation
- [x] Scope-impact document created (this file)
- [ ] Migration 0010 authored (additive, reversible)
- [ ] Applied to `madrasa_test` + write tests green
- [ ] Applied to clean production DB
- [ ] Production DB / volumes never reset, recreated, reseeded or deleted
- [ ] Feedback, audit history, uploads, backups, recovery checkpoints preserved
- [ ] No Fares / operational-plan / building / KPI / budget import executed
- [ ] No fake operational or demo data in production
- [ ] No release tag
