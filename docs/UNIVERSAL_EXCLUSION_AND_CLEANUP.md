# Universal Synthetic Exclusion + Safe Cleanup/Archive Workflow

Session date: 2026-07-18. Language: English per repo policy (Arabic UI strings quoted inline).
**No real data was modified.** All schema/tests ran against the isolated `madrasa_test` DB.
The committed official plan batch `385c615a` (منفذة, 26 programs) and the Fares people batch
`12673bed` (معاينة) are untouched. Cleanup was **not executed**.

---

## 1. Universal exclusion (centralized)

The centralized filter is `getExcludedIdSets()` in `src/lib/synthetic.ts`. It is the single
source of truth every customer-facing query uses via `notSynthetic(col, set)`. It now unions:

- **Structurally-classified synthetic ids** (`classifySynthetic()`) — ON except when
  `MADRASA_INCLUDE_SYNTHETIC=1` (e2e scenario visibility).
- **Explicitly-archived ids** (`getArchivedIdSets()`) — **always ON**, independent of the
  synthetic toggle. What the principal archives stays hidden until unarchived.

The classifier was extended from 10 to **20 entity buckets** so dependent records are covered
and countable: `plan_year, program, milestone, deliverable, kpi, risk, budget, roadmap_cell,
followup, change_request, person, committee, meeting, outcome, perf_cycle, perf_session, task,
document, evidence, maintenance`. Structural anchors are unchanged (import-batch provenance
«تجريبي», `demo%` plan years, FK propagation) — **never name alone**; name-only «تجريبي»
records go to a manual-review bucket.

### Surfaces now filtered (were NOT before this change)
| Surface | File | Table |
|---|---|---|
| Plan list | `plan/page.tsx` | programs |
| Program details | `plan/[id]/page.tsx` | programs → `notFound()` |
| Program report page | `plan/[id]/report/page.tsx` | programs → `notFound()` |
| Weekly follow-up | `plan/followup/page.tsx` | programs |
| KPIs register | `plan/kpis/page.tsx` | program_kpis |
| Risks register | `plan/risks/page.tsx` | program_risks |
| Evidence register | `evidence/page.tsx` | evidence_items |
| People register | `people/page.tsx` | people |
| Tasks | `tasks/page.tsx` | action_tasks + people |
| Committees | `committees/page.tsx` | committees + meetings |
| Performance | `performance/page.tsx` | perf_cycles + people |
| Documents | `documents/page.tsx` | documents |
| Maintenance | `building/maintenance/page.tsx` | maintenance_issues + people |
| Plan XLSX export | `api/export/plan-xlsx/route.ts` | programs + milestones |
| Program DOCX export | `api/export/program-docx/[id]/route.ts` | programs → 404 |
| AI briefs | `lib/ai/tools.ts` | program/meeting/person by-id → «غير موجود» |

Already filtered before (unchanged): dashboard, work center (`worklist.ts`), executive report,
AI search/list tools. AI context builder (`orchestrator.ts`) reads no domain tables — no bypass.

## 2. Exact cleanup preview

`/admin/cleanup` shows exact candidate counts grouped into the requested buckets: **الخطط
والبرامج، المعالم، المخرجات والشواهد، التحديثات والمتابعات، المخاطر، بنود الميزانية، التقارير
والوثائق، سجلات تابعة أخرى، وسجلات بالاسم فقط (مراجعة يدوية)** — each with per-type sub-counts
and expandable per-record structural reasons. A "محفوظ وآمن" section asserts the official plan
batch `385c615a` (منفذة, program count, 0 synthetic) and all «معاينة» batches incl. Fares are
preserved.

### Live read-only classification on the REAL DB (SELECT-only, no writes)
| Metric | Value |
|---|---|
| Programs total | 58 |
| Synthetic programs | 32 |
| **Preserved (official) programs** | **26** |
| Milestones synthetic | 64 |
| Deliverables synthetic | 16 |
| Followups synthetic | 16 |
| Change requests synthetic | 16 |
| KPIs / Risks / Budgets / Roadmap synthetic | 0 / 0 / 0 / 0 (all under the official year) |
| People synthetic | 80 (real staff live uncommitted in the Fares معاينة batch) |
| Committees / Meetings / Outcomes | 15 / 14 / 14 |
| Perf cycles / sessions | 14 / 26 |
| Tasks / Documents / Evidence / Maintenance | 14 / 39 / 149 / 11 |
| Name-only manual-review | 0 |
| Synthetic import batches | 73 |
| Official batch `385c615a` | منفذة, 26 programs, isSynthetic=false ✓ |
| Fares batch `12673bed` | معاينة, isSynthetic=false ✓ |

## 3. Safe archive workflow

`src/lib/cleanup-archive.ts` + `src/app/(app)/admin/cleanup/actions.ts`:
Preview → explicit Arabic confirmation («أرشفة السجلات التجريبية», typed verbatim) → transactional
archive → immutable audit event (`cleanup.archive`, inside the same tx) → full unarchive/rollback
(`cleanup.unarchive`).

- **Archive only — never deletes.** Migration `0005` adds `archive_batches` + `archived_records`.
  Archiving snapshots each row (full JSON) into `archived_records` and hides it via the central
  filter. No domain row is ever removed.
- **Fully reversible.** Unarchive flips the batch to «مُسترجع»; hidden rows reappear instantly,
  zero data loss (rows never left their tables).
- **Name-only records require manual selection** (`manualSelections`), validated against the
  suspect list; the official batch cannot be selected.
- **Fail-closed:** wrong confirmation phrase or empty reason → rejected before any write.
- **The agent stopped before executing.** The execute button is wired but requires the
  principal to type the phrase and confirm — their manual action only.

## 4. Validation

- `npm run typecheck` / `npm run lint` / `npm run build` — clean.
- `npm test` — **122 passed** (was 115): +7 from extended `synthetic.test.ts` (dependent-record
  buckets, /plan-query proof) and new `cleanup-archive.test.ts` (confirmation enforcement,
  non-destructive archive, audit event, unarchive, manual-selection guard).
- Full Playwright suite runs against `madrasa_test` only (fail-closed guard; isolated server).
  New `cleanup.spec.ts` proves `/admin/cleanup` renders at **390×844** with no horizontal
  overflow, the archive form is present but **not submitted**, and **no `archive_batches` row
  is created** by viewing the page; it also asserts the Fares preview batch stays «معاينة».
  Every spec exercising this change passes: `cleanup` (1), `mobile` (5/5 — incl. the C1 sweep
  of all modified pages), `import-decisions` (4), `plan-import` (4), `arabic-and-auth` (4),
  `https-pwa` (3, +C5 deferred), and 14/15 `workflows` scenarios including **«حرمة دفعة فارس»**
  (Fares stays «معاينة» untouched).
- Fixed a **pre-existing test bug** in `mobile.spec.ts`: it read credentials from the real
  `storage/` dir instead of honoring `E2E_STORAGE_DIR` (the isolated `storage-e2e`) like every
  other spec — so its login used the wrong password and timed out. After the one-line fix,
  `mobile.spec` is 5/5. Added an `E2E_EXTERNAL=1` opt-in to `playwright.config.ts` to run the
  suite against a pre-warmed isolated server (avoids `next dev` cold-compile login timeouts on
  slow machines; deterministic).
- **Unrelated remaining failures** (not this change; import/AI files untouched and unreferenced
  by it): 2 `assistant` C6 tests require a local Ollama provider (absent in the sandbox); 1
  heavy `workflows` س1 import-review scenario is byte-identical to `HEAD` and fails
  independently — the import flow is separately proven green by `import-decisions` + `plan-import`.
- **No writes to the real DB:** every real-`madrasa` table row-count is identical before/after
  the run; archive tables are absent from the real DB (code is resilient via try/catch); the
  real-DB classification above is SELECT-only.
