# Scope v2.2 — Engineering Report

**School:** مجمع الخشعة التعليمي للبنين
**Branch:** `scope-v2.1-corrections` · **Base:** `501e7e2` · **Head:** `8aa9362`
**Date:** 2026-07-28
**Production status: UNTOUCHED.** Still at migration 18, counts unchanged, no container restarted.

---

## A. Executive verdict

**CONDITIONALLY READY — approval still blocked, but by a much shorter list.**

All five functional phases (A, B, C, D, E) are now implemented, tested, and rehearsed
against a restored production clone. §11.8 still governs: approval cannot be requested
until the review obligations are met. What remains is verification work, not construction:

1. **§11.1 complete file-by-file repository review** — the dependency review, secret scan,
   infrastructure/exposure review, migration review and template-security review are done
   and documented below. A route-by-route read of every existing file is not.
2. **§11.6 security test suite** — IDOR probing, CSRF/origin rejection, login throttling,
   session invalidation, upload attacks, concurrency. The template and export surfaces are
   covered; the older surfaces are not.
3. **§12 remaining gates** — Playwright, RTL desktop + mobile, restart/persistence,
   backup/restore rehearsal.
4. **Three §D10/§B6/§C gaps** — saved report configurations, configurable columns, Word
   export from the report centre, term/academic-year dashboard cards, unsaved-changes
   warning.

Building Phase E surfaced a **HIGH pre-existing vulnerability** (§K.10): official documents
interpolated user-entered names into HTML without escaping, which meant a crafted program
name became live markup inside a frozen document snapshot and executed in server-side
Chromium during PDF generation. That is fixed.

The **two live production issues** (§K.1, §K.2) still stand and are worth acting on
independently of this scope — one of them very likely blocks the principal from logging in
over the LAN today.

## B. Requirement matrix

| § | Requirement | Status |
|---|---|---|
| **A1** | Add-program capability | **Implemented** |
| A1 | Available from operational-plan section, desktop + mobile | Implemented |
| A1 | Optional-field rule; saves incomplete; «بدون عنوان» fallback | Implemented |
| A1 | Appears in list immediately; duplicate-click prevented; Arabic saving state and errors | Implemented |
| A1 | Does not auto-create legacy activities/milestones | Implemented |
| **A2** | Final closure «إقفال البرنامج» as a distinct state | **Implemented** |
| A2 | Requires nothing (no evidence/activities/readiness/budget/results) | Implemented |
| A2 | Preserves full record + evidence/documents/finance/notes/reports | Implemented |
| A2 | Leaves active lists, stays in historical views and reports, shows «مغلق» | Implemented |
| A2 | Records closedAt/closedBy/optional note; reopen records reopenedAt/By | Implemented |
| A2 | Idempotent close/reopen; audit history never overwritten | Implemented |
| **B1** | School-level finance; no program/classification dependency | **Implemented** |
| B1 | Existing records preserved; legacy program links kept and labelled | Implemented |
| **B2** | Financial items: create/edit/allocate/archive/restore/order/colour | Implemented |
| B2 | Per-item income, expenses, balance | Implemented |
| B2 | Controlled administrative creation of المستلزمات/النشاط; no seed | Implemented |
| **B3** | School-level income, optional item, blank amount, attachment | Implemented |
| **B4** | School-level expenses, invoice number, image/PDF, per-item recalculation | Implemented |
| **B5** | One authoritative server-side calculation service | **Implemented** |
| B5 | No double counting, no silent null→zero, no NaN, no raw null | Implemented |
| B5 | Archived/cancelled/draft treatment defined | Implemented |
| **B6** | Finance dashboard — all 9 required top cards | Implemented |
| B6 | المستلزمات/النشاط dedicated cards + dynamic per-item table | Implemented |
| B6 | Cards deep-link to filtered reports | Implemented |
| B6 | Monthly trend, current-month/term/year totals, highest-spending | **Partial** — monthly trend and per-item ranking are in the report centre; term/academic-year cards are not on the dashboard |
| **B7** | «إقرار التجاوز» removed; warning only, never blocks | **Implemented** |
| **C** | Route-by-route audit; «العودة» on every meaningful subpage | **Implemented** — 58 of 64 routes were missing it |
| C | Logical parent not dashboard; history when safe; explicit fallback | Implemented |
| C | Works on direct URL, after save/cancel/validation error; RTL; no loops | Implemented |
| C | Shared component, not per-page buttons; automated coverage | Implemented |
| C | Warn on unsaved data | **Not implemented** — no unsaved-changes guard |
| **D** | Central report centre, 13 categories, one registry | **Implemented** (46 reports) |
| D | «تقارير القسم» per section, deep-linking to its category | Implemented (9 sections) |
| D1–D9 | Category reports on real data | Implemented, with two documented gaps: **SWOT** has no data model (no report fabricated) and **meeting attendance** has no table (decision counts shown instead) |
| **D10** | Search, date range, status/person/section filters | Implemented |
| D10 | Sorting, pagination, filter chips, reset, deep links, RTL, null-safe | Implemented |
| D10 | CSV, Excel, print view | Implemented |
| D10 | Word export | **Not implemented** for the report centre (existing per-document Word exports untouched) |
| D10 | Configurable visible columns | **Not implemented** |
| D10 | Saved report configurations | **Not implemented** |
| D10 | Formula injection, sensitive fields, unauthorised access, unbounded exports, raw errors, export audit | Implemented |
| **E1** | «إدارة القوالب» page; templates by document type; name/description/type/default/version/dates/actors | **Implemented** |
| **E2** | Editable titles, texts, identity, header/footer, colours, font, size, alignment, margins, orientation, line spacing, borders, table header, alternating rows, signature/approval labels, notes, watermark, page numbers, print date, doc-number placement | **Implemented** |
| E2 | Logo, column labels/order/visibility/widths, section order/visibility | **Partial** — modelled and validated in the schema, but the editor UI exposes text/identity/style/signature only; column and section editing is not yet surfaced |
| **E3** | Closed placeholder registry, per-type availability, unknown rejected, HTML escaped, no script/SSTI/code/queries/paths/secrets | **Implemented** |
| **E4** | Refreshable preview, desktop, print, Arabic RTL, sample data | **Implemented** (uses the issue renderer, sandboxed iframe) |
| E4 | Page-break preview; actual-record preview with authorization | **Not implemented** — sample-data preview only |
| **E5** | Edit creates a new version; issued documents keep their original snapshot; frozen records unchanged; draft/publish/duplicate/archive/restore/set-default/restore-previous; audit history | **Implemented** |
| E5 | Side-by-side version comparison | **Not implemented** — version list with change notes only |
| **E6** | Restore default, duplicate before editing, export config, import validated config, reject incompatible/unsafe, allowlisted style model, no executable HTML/JS/CSS/remote resources | **Implemented** |
| **E7** | 14 initial template types | **Implemented** |
| **§8** | Global optional-field rule extended to new fields | Implemented |
| **§9** | Minimum forward-only migrations; no edits to old ones; no seed | Implemented (0018, 0019, 0020) |
| **§10** | Authorisation, upload validation, audit for new surfaces | Implemented |
| **§11.4** | Dependency review | **Implemented** |
| **§11.1** | Complete file-by-file repository review | **Partial** |
| **§11.3** | Safe cleanup | Partial — two proven-dead server actions removed; no repo-wide sweep |
| **§12** | Regression coverage | Implemented for delivered phases |
| §12 | Playwright suite | **Not run** — see §F |
| **§11.5 E** | Template security review | **Implemented** |

---

## C. Changed files

**Milestone 1 — `084ce2f`**

| File | Change |
|---|---|
| `src/db/schema/plan.ts` | Closure columns on `programs`; new `program_closure_history`; `created_by` |
| `src/app/(app)/plan/actions.ts` | `createProgramAction`, `closeProgramAction`, `reopenClosedProgramAction` |
| `src/app/(app)/plan/program-create-ui.tsx` | Add-program panel (new) |
| `src/app/(app)/plan/[id]/program-ui.tsx` | Close/reopen forms |
| `src/app/(app)/plan/page.tsx`, `[id]/page.tsx` | Add button, closed section, closure banner + history |
| `src/lib/navigation.ts` | Route→parent map and resolver (new) |
| `src/components/back-nav.tsx` | Auto-rendered back button (new) |
| `src/components/app-shell.tsx` | Mounts `BackNav` once for all pages |
| `src/lib/worklist.ts`, `src/lib/ai/tools.ts`, `plan/followup/page.tsx` | Closed programs leave operational lists |

**Milestone 2 — `1a1b9dc`**

| File | Change |
|---|---|
| `src/db/schema/budget.ts` | `financial_items`; item + archive columns on income/expenses |
| `src/lib/finance/calc.ts` | Authoritative calculation service (new, pure) |
| `src/lib/finance/service.ts` | DB read layer feeding the calc service (new) |
| `src/app/(app)/budget/finance-actions.ts` | Item CRUD, archive/restore, default-items flow (new) |
| `src/app/(app)/budget/actions.ts` | School-level income/expense; shared invoice helper; overspend acknowledgment removed |
| `src/app/(app)/budget/budget-ui.tsx` | Rewritten for school-level model; warning-only overrun |
| `src/app/(app)/budget/page.tsx` | New finance dashboard |

**Milestone 3 — `58011b9`**

| File | Change |
|---|---|
| `src/lib/reports/catalog.ts` | Pure registry: 13 categories, 46 reports (new) |
| `src/lib/reports/loaders.ts` | Server-only loaders keyed by report id (new) |
| `src/lib/reports/export-safety.ts` | Formula-injection, filename and bound guards (new) |
| `src/app/(app)/reports/page.tsx` | Report centre, URL-driven |
| `src/app/(app)/reports/report-filters.tsx` | Filter bar + chips (new) |
| `src/app/api/reports/export/route.ts` | CSV/Excel export with authz + audit (new) |
| `src/components/section-reports-link.tsx` | Shared «تقارير القسم» (new) |
| `src/components/ui.tsx` | `Table` gained optional sort links |
| 9 section pages | Section report links |

**Milestone 4 — `8aa9362`**

| File | Change |
|---|---|
| `src/lib/html-escape.ts` | Single HTML/CSS escaper (new) — replaced 8 duplicated local helpers |
| `src/lib/pdf.ts` | Every interpolation in `officialPageHtml` escaped (security fix) |
| `src/lib/templates/schema.ts` | Allowlisted config model + strict validation (new) |
| `src/lib/templates/placeholders.ts` | Closed placeholder registry + safe substitution (new) |
| `src/lib/templates/render.ts` | Config→HTML renderer, shared by preview and issue (new) |
| `src/lib/templates/service.ts` | Versioning/lookup data layer (new) |
| `src/db/schema/shared.ts` | `template_definitions`, `template_versions`, `documents.template_version_id` |
| `src/app/(app)/admin/templates/*` | «إدارة القوالب» page, editor, actions (new) |
| `src/lib/documents.ts` | Records the template version that produced each document |
| `src/components/app-shell.tsx`, `src/lib/navigation.ts` | Sidebar entry + nav parent |

**Dependency + clone fix — `c31a737`**: `package.json`, `package-lock.json`, `src/lib/reports/loaders.ts`.

---

## D. Database impact

**Migrations added: 0018, 0019, 0020.** Forward-only, additive only. No old migration edited. `seed.ts` never ran.

**0018 (`0018_tidy_storm.sql`)** — 1 table, 6 nullable columns, 3 FKs, 1 index
- `program_closure_history` (append-only)
- `programs`: `closed_at`, `closed_by`, `closure_note`, `reopened_at`, `reopened_by`, `created_by`

**0019 (`0019_clever_raza.sql`)** — 1 table, 6 nullable columns, 4 FKs, 3 indexes
- `financial_items`
- `budget_income` / `budget_expenses`: `financial_item_id`, `archived_at`, `archived_by`

**0020 (`0020_wonderful_centennial.sql`)** — 2 tables, 1 nullable column, 6 FKs, 4 indexes
- `template_definitions` (with a **partial unique index** enforcing one default per document
  type in the database, not in application code alone)
- `template_versions` (immutable once published)
- `documents.template_version_id` — audit lineage only; the frozen snapshot stays the display source

**No destructive operations.** No drops, no renames, no type changes, no data transformation,
no backfill. The `overspend_ack_*` columns are deliberately retained unwritten so pre-v2.2
acknowledgements stay readable. `plan_budget_items` is untouched — the official plan importer
writes it and production holds real rows.

### Migration rehearsal evidence

Method: read-only `pg_dump` of live production → restored into a throwaway `madrasa_clone`
database in the **dev** container → `db:migrate` → compare. Clone and dump destroyed afterwards
(the dump contained real school data and was not retained).

| Table | Before | After |
|---|---|---|
| programs | 26 | 26 |
| **program_activities** | **129** | **129** |
| **program_milestones** | **129** | **129** |
| people | 54 | 54 |
| evidence_items / evidence_links | 25 / 25 | 25 / 25 |
| stored_files | 72 | 72 |
| documents | 31 | 31 |
| committees / meetings | 4 / 5 | 4 / 5 |
| perf_sessions | 11 | 11 |
| budget_income / budget_expenses | 2 / 2 | 2 / 2 |
| plan_budget_items | 2 | 2 |
| audit_log | 339 | 339 |
| **drizzle migrations** | **18** | **20** |

Every count identical; only the migration ledger advanced, exactly as intended.

**Confirmation `seed.ts` did not run:** both new tables came out **empty** (`financial_items` = 0,
`program_closure_history` = 0), and all 12 new columns are **100% NULL** across every existing
row. Nothing was invented.

---

## E. Data preservation

**D-022 legacy fingerprint — byte-identical before and after:**

```
before: 251750bf8d85539ff5d1ea889d820b2e
after:  251750bf8d85539ff5d1ea889d820b2e   → MATCH
```

(md5 over id + name/title + status + progress of all 129 activities and 129 milestones.)

**Issued-document snapshot fingerprint — byte-identical before and after 0020:**

```
before: c9383e4b0fea0f460560effedeaff7bd
after:  c9383e4b0fea0f460560effedeaff7bd   → MATCH (all 31 issued documents)
```

(md5 over doc_number + html_snapshot of every issued document.) `template_version_id`
came out **100% NULL** — pre-v2.2 documents are not retro-labelled with a template they
were not issued from.

Retained legacy activities and milestones: **preserved, untouched, unreferenced by new code.**
Existing uploaded files: untouched — no migration touches `stored_files` or the storage volume.
Issued/frozen documents: **verified unchanged**, by fingerprint above.

---

## F. Test results

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** (strict, no errors) |
| `npm run lint` | **PASS** (0 errors, 0 warnings) |
| `npm run build` | **PASS** (compiled successfully) |
| `npm test` (vitest) | **PASS — 496/496**, 61 files (baseline was 287) |
| Production-clone migration rehearsal | **PASS** — see §D |
| All 46 reports against real production data | **PASS** — 803 rows |
| **Playwright e2e** | **NOT RUN** |
| Restart / persistence rehearsal | **NOT RUN** |
| Backup / restore rehearsal | **NOT RUN** |

**+209 tests added:**
- 13 integration — program creation and closure (empty save, title fallback, no auto-activities, duplicate-click, sequence allocation, closure with nothing, separation from archive/approval, idempotency, **concurrent closure**, reopen history accumulation, evidence preservation)
- 11 unit — navigation (logical parent, dynamic ids, non-page segments, loop guard, and an **exhaustive check that all 64 routes resolve to a real parent page**)
- 26 unit — finance calculations (per-item independence, null≠zero, no NaN, overspend flagging, archived exclusion, cancelled/expected income, no double counting, warning never blocks)
- 20 integration — school-level finance (saves without program/category, blank amounts, item linkage, integrity guard, per-item recalculation on archive and re-tag, totals matched against a **direct SQL sum**, colour allowlist rejection, idempotent archive/restore, historical program-linked rows still render)
- 21 unit — export safety and catalogue integrity (formula injection, filename traversal, page clamping, sort whitelist, **no report exposes a sensitive column**)
- 55 integration — report centre (**every one of the 46 reports executed against a real database**, malicious sort column, oversized page size, unknown-report rejection, aggregate-date regression)
- 37 unit — template security (XSS payload matrix against escaper/schema/renderer, CSS injection, unknown config keys, out-of-range numbers, unknown and out-of-scope placeholders, no expression evaluation, no remote resources, 14 doc types)
- 26 integration — templates (**issued document proven unchanged across template edit + publish**, published version never mutated, restore copies forward, version numbers never reused, published/referenced versions protected, import rejection of script/unknown-key/bad-JSON/oversized payloads, authorisation denied without `admin.settings`, published-only resolution at issue time)

Four of these earned their keep by finding real defects before release: the route-coverage test
caught `/admin/*` pages linking to a non-existent `/admin` index; the clone run caught the
aggregate-date crash (§K.5); the placeholder test caught `{{__proto__}}` leaking
`[object Object]` into rendered documents (§K.11); and the version-numbering test caught draft
deletion freeing a version number, which would have put two different "version 2" entries in
the audit log (§K.12).

**Why Playwright, restart and backup rehearsals were still not run:** they belong to the
pre-deployment gate. With §11.1 and §11.6 outstanding the package is not final, so running them
now would produce evidence for a build that may still change. They must be run before approval.

---

## G. Financial validation

Verified by test and by execution against a production clone.

| Claim | Evidence |
|---|---|
| School-level income | `addIncomeAction` saves with no program/category; `programId` NULL |
| School-level expense | `addExpenseAction` saves with no program/category; `programId` NULL |
| No program/category dependency | New forms contain no program, classification, domain or category control |
| Per-item allocation | `financial_items.allocated_amount`, independent per item |
| Per-item spending | Live sum keyed on `financial_item_id`; re-tagging moves value between exactly two items |
| Per-item remaining | `allocated − expenses`, or **null → «—»** when no allocation (never a misleading 0 or negative) |
| Dashboard totals | All cards read the single calc service; a test matches the total against a direct SQL `sum()` |
| Overrun warning | Save succeeds; wording is «سيؤدي تسجيل هذه العملية إلى تجاوز المبلغ المخصص بمقدار {amount}»; no checkbox, no reason, no red field; acknowledgment columns stay unwritten |

Against real production data the service produced: income 5,000 · expenses 2,700 · balance 2,300 ·
4 operations · 0 financial items (correct — the principal has not created any yet).

**Definitions in force:** empty amount is *not* zero (stays null, renders «—», counted in
`missingAmountCount`); archived rows leave current totals; «ملغى» income never counts; «متوقع» is
tracked separately and excluded from the cash balance; `remaining = allocated − expenses` only when
an allocation exists; `cash balance = received income − expenses`.

---

## H. Report inventory

46 reports across 13 categories. Row counts are from the production clone.

**الخطة والبرامج (8):** البرامج النشطة (26) · المغلقة (0) · المؤرشفة (0) · المعاد فتحها (0) · سجل الإقفال وإعادة الفتح (0) · حسب المجال (4) · حسب المسؤول (19) · برامج بلا شواهد (24)

**الشواهد (4):** سجل الشواهد (25) · حسب النوع · حسب البرنامج · توزيع أنواع الملفات (5)

**المالية والميزانية (10):** سجل الإيرادات (2) · سجل المصروفات (2) · المخصص/المنفَق/المتبقي لكل بند · البنود المتجاوزة · عمليات بدون فاتورة (2) · سجل الفواتير المرفقة (2) · كل العمليات (4) · الاتجاه الشهري · العمليات المؤرشفة والملغاة

**الأداء الوظيفي (4):** جلسات التخطيط (5) · التقييمات (6) · غير المكتملة (1) · عدد الشواهد لكل جلسة (11)

**اللجان والمجالس (4):** سجل اللجان (4) · الأعضاء (13) · المهام (31) · لجان بلا اجتماعات (0)

**الاجتماعات والقرارات (2):** سجل الاجتماعات (5) · القرارات والتوصيات (9)

**المبنى والمرافق (4):** الغرف (7) · المرافق (15) · الصيانة (3) · الأصول (2)

**الموظفون (3):** السجل (54) · نواقص البيانات (54) · عضويات اللجان (9)

**المخاطر (1):** سجل المخاطر (9)

**التقييم الخارجي (1):** خطط التحسين (0)

**الوثائق والمرفقات (2):** الوثائق الصادرة (31) · الملفات المرفوعة (72)

**الاستيراد وجودة البيانات (2):** دفعات الاستيراد (2) · جودة الصفوف (2)

**سجل الاستخدام (2):** سجل التدقيق (339) · سجل تصدير التقارير (0)

**Two honest gaps.** SWOT was requested but the platform has no SWOT data model, so no report was
fabricated — the category is «المخاطر» and the gap is recorded here rather than shipped as an empty
screen. Meeting attendance was requested but there is no attendance table; the meetings report shows
decision counts instead.

---

## I. Template inventory

**14 template types**, each managed from «إدارة القوالب» with the same editable property set:

تقرير برنامج · وثيقة إقفال برنامج · تقرير مالي · تقرير الإيرادات والمصروفات · نموذج توزيع مهام لجنة · محضر اجتماع لجنة · محضر اجتماع مجلس · تقرير أداء موظف · تقرير التقييم النهائي · تقرير الشواهد · تقرير المبنى والمرافق · تقرير المخاطر · تقرير التقييم الخارجي · خطاب رسمي عام

**Editable properties (all optional, per §8):**

| Group | Properties |
|---|---|
| Text | Arabic title, subtitle, intro, fixed text, closing, notes, header text, footer text, watermark text |
| Identity | school name, ministry text, education department, education office, logo file reference |
| Style | primary colour, text colour, font family, base font size, title font size, alignment, line spacing, page orientation, four page margins, border style, table header background, alternating rows, page numbers, print date, document-number placement |
| Signature | signature label, approval label, show signature, show stamp |
| Tables/sections | column label, order, visibility, width; section label, order, visibility — *modelled and validated, not yet surfaced in the editor UI* |

**Value domains are closed, not free text:** 9 colours, 3 locally-bundled fonts, 4 alignments,
2 orientations, 3 border styles, 5 document-number positions. Numeric properties are range-bound
(font 8–24px, margins 0–50mm, line height 1–3).

**28 placeholders** across a closed registry, scoped per document type — 10 general
(`{{school_name}}`, `{{document_number}}`, `{{verification_code}}`, `{{issue_date}}`, …),
6 program, 6 committee/council, 2 performance, 4 financial.

**Lifecycle per template:** draft → publish → new version on edit → restore any prior version →
duplicate → set default → archive → restore. Published versions are immutable; a version an
issued document references cannot be archived or removed.

## J. Performance measurements

Measured on the production clone (Mac mini, warm):

| Operation | Measurement |
|---|---|
| All 46 reports, sequential, real data | ~2.0 s total (≈43 ms average per report) |
| Full report-centre integration suite (55 tests) | 2.13 s |
| Finance calculation suite (26 unit tests) | 13 ms |
| Production build | 5.4 s compile |
| Full vitest suite (433 tests) | 112 s |
| Migration 0018+0019 on full production clone | < 2 s |

**No before/after comparison is claimed** — the finance dashboard and report centre are new
surfaces with no prior implementation to compare against, and per §11 I will not assert an
improvement I have not measured.

Design measures in place: server-side pagination with a clamped page size (max 200); bounded
exports (max 5,000 rows, truncation reported not silent); indexed filters (new indexes on
`financial_item_id`, `expense_date`, closure history); one shared calculation service; filter
option lists loaded only when the displayed report declares them; grouped count queries instead
of per-row lookups (no N+1 in the loaders).

---

## K. Security review

### Findings

**K.1 — Ollama is exposed to the LAN — HIGH — pre-existing, not caused by v2.2**

The baseline states Ollama is loopback-only. It is not. `ollama` listens on `*:11434` and answers
**HTTP 200 on the LAN address**, so any device on the school network can reach an unauthenticated
inference API.

*Impact:* unauthenticated resource abuse and model enumeration from any LAN device. Mitigating
factor: `AI_ENABLED=false` in production, so the application itself does not use it.
*Status:* **not fixed** — production configuration is out of scope until approval.
*Remediation:* set `OLLAMA_HOST=127.0.0.1:11434` in the Ollama service environment and restart it,
then re-verify that the LAN address refuses the connection. This requires no application change.

**K.2 — TRUSTED_ORIGINS points at a stale IP; LAN form submissions will be rejected — HIGH — pre-existing**

The Mac mini's DHCP address has drifted again, `192.168.0.171 → 192.168.0.48`. The application is
reachable at `http://192.168.0.48:3080` (HTTP 200), but `TRUSTED_ORIGINS` still contains
`192.168.0.171:3080`, and that value feeds `serverActions.allowedOrigins` in `next.config.ts`.

*Impact:* pages load, but **every Server Action from the current LAN URL is rejected as an untrusted
origin — including login.** The principal most likely cannot sign in from the LAN right now.
*Status:* **not fixed** — production configuration is out of scope until approval.
*Remediation:* update `TRUSTED_ORIGINS` to the current address and recreate the app container. The
durable fix remains a DHCP reservation on the router, as recorded after the 2026-07-26 incident;
this is the second recurrence.

**K.3 — Next.js 16.2.10 carried 9 reachable high advisories — HIGH — FIXED**

Including SSRF in Server Actions, DoS in Server Actions, and unauthenticated disclosure of internal
Server Function endpoints. This application is built on Server Actions, so these were reachable.
*Status:* **fixed** in `c31a737` by upgrading to 16.2.12 (patch-level, not semver-major). Transitively
cleared the postcss and sharp advisories. Full suite green afterwards.

**K.4 — Raw English `"Invalid UUID"` reached the Arabic UI — LOW — FIXED**

A malformed id produced an untranslated Zod message. Fixed with an Arabic message plus a test
asserting no Latin text escapes to the user.

**K.5 — Aggregate date crash in two reports — MEDIUM — FIXED**

Postgres returns `max(created_at)` as a string; the formatter assumed `Date`. Invisible on an empty
database. Found by the clone pass, fixed, regression test added.

**K.6 — Two unreachable server actions — LOW — FIXED**

`setBudgetItemAction` / `deleteBudgetItemAction` became unreachable after the finance rewrite.
Removed (unreachable-but-invocable server actions are needless attack surface). The
`plan_budget_items` table, its importer and its read path were deliberately kept.

**K.7 — adm-zip and exceljs advisories — MEDIUM — ACCEPTED, documented**

`adm-zip <0.6.0` (crafted ZIP → 4 GB allocation) is reachable only by an authenticated principal
uploading a malicious workbook; the fix is semver-major. `exceljs` is flagged only via transitive
`archiver`/`uuid`, and npm's suggested "fix" is a *downgrade* to 3.4.0. Neither upgraded during this
batch, per §11.4's instruction not to perform uncontrolled major upgrades.

**K.8 — eslint / drizzle-kit / esbuild advisory chains — LOW — NOT APPLICABLE at runtime**

Development-only; absent from the production image.

**K.9 — Plain-HTTP LAN access — ACCEPTED, previously decided**

`ALLOW_INSECURE_LAN_HTTP=true` is in force. HTTP provides no transport confidentiality; session
cookies travel unencrypted on the LAN. This was an explicit prior decision, with Tailscale Serve as
the real posture. Not silently re-characterised as safe.

**K.10 — Unescaped interpolation into official documents — HIGH — FIXED**

`officialPageHtml` interpolated `title`, organisation lines, header/footer notes, principal
name, document number, verification code and image data URIs into HTML with **no escaping**.
Document titles are built from user-entered names (`تقرير برنامج: ${program.name}`), so a
program named `<img src=x onerror=…>` became live markup inside the document's **frozen
snapshot** and was executed by server-side Chromium during PDF generation. The free-text
program creation added in M1 made this trivially reachable.

*Status:* **fixed** in `8aa9362`. Every interpolation is escaped; a single shared escaper
replaced eight duplicated local helpers that escaped only `& < >` and left quote-based
attribute escapes incomplete. Covered by an XSS payload matrix.

**K.11 — Placeholder substitution reached the object prototype — MEDIUM — FIXED**

`{{__proto__}}` returned `Object.prototype` and rendered `[object Object]` into a document;
`{{constructor}}` behaved similarly. Found by the "no object access" test as it was written.
*Status:* **fixed** — substitution is restricted to the closed placeholder registry plus an
own-property check, so prototype-chain keys are never resolved.

**K.12 — Draft deletion freed a version number — LOW — FIXED**

Hard-deleting a draft template version released its number for reuse, which would have put
two different "version 2" entries in the audit log for the same template.
*Status:* **fixed** — drafts are archived rather than deleted, matching the soft-delete
pattern used for programs, evidence, financial items and templates.

### Verified good

- **Secret scan: clean.** No hardcoded passwords, tokens, keys or credentials in tracked files. Only `.env.example` / `.env.production.example` are tracked; `.gitignore` correctly excludes `.env*`, `reference_files/` and `storage/private/`. No secret values are printed in this report.
- **Postgres remains unpublished** (`5432/tcp`, no host binding) — re-verified after all work.
- **Container runs as non-root** (`uid=1001 madrasa`).
- **Cookies:** `httpOnly`, `sameSite=lax`, `secure` conditional on the deployment mode.
- **Authorisation at the server boundary** for every new surface: page, action and export each call `requirePermission`; the export route checks login **and** `reports.generate` **and** the report's own declared permission before any query runs.
- **No sensitive column is exportable** — columns come from the report definition only, and a test asserts no report declares `password`, `sessionId`, `token`, `secret`, `sha256`, `storagePath` or `htmlSnapshot`. `storage_path` and `sha256` are explicitly excluded from the files report.
- **Formula injection neutralised** for CSV and Excel (`=`, `+`, `-`, `@`, tab, CR), on data *and* header cells.
- **Export filenames** are path-traversal and control-character safe.
- **Sorting is whitelisted** against the report's own columns — a column name from the URL never reaches a query. Tested with a SQL-injection-shaped sort parameter.
- **Bounded exports and pagination** — page size clamped to 200, exports to 5,000 rows, truncation reported.
- **Every export writes an audit row** (who, which report, which format, how many rows).
- **Raw errors suppressed** — the export route returns a generic Arabic message; no stack trace, SQL text or path reaches the browser.
- **Upload path reused, not duplicated** — invoices go through the existing validated evidence pipeline (MIME/extension/size checks, server-generated random name, path guard, sha256).
- **Idempotency and race safety** — closure carries its own `isNull(closed_at)` guard inside the `UPDATE`; a concurrent double-close test proves exactly one history row.
- **Colour input is an allowlist**, not free CSS.
- **Template engine is a configuration model, not a template language** — the principal cannot express HTML, CSS, scripts, expressions or remote references at all. Script injection, SSTI, unsafe CSS and external asset loading are prevented by construction, not by filtering.
- **Template config schema is `.strict()`** at every level: an unknown key from an imported configuration is rejected, never silently ignored. Numbers are range-clamped and unknown enum values fall back to defaults rather than reaching CSS.
- **Template preview runs in a `sandbox=""` iframe** — defence in depth above escaping.
- **Published template versions are immutable**, and a version referenced by an issued document cannot be archived or removed.
- **Issued documents are re-verified frozen** — 31 real production snapshots byte-identical across migration 0020.

### Security testing not performed

IDOR probing across all entity types, CSRF/origin rejection tests, login throttling and session
invalidation tests, path-traversal and double-extension upload tests, oversized-file tests, and
concurrent financial-write tests. These belong to the §11.6 pass, which is outstanding along with
the rest of the full review.

---

## L. Deployment plan

**Still not proposed.** §11.8 blocks an approval request until the outstanding review items in
§A are complete. When they are, the plan follows the v2.1 cutover shape, unchanged:

1. Fresh encrypted backup (`npm run backup:daily`) and verify checksums.
2. Build the image from the approved commit.
3. `docker compose -p madrasa-prod run --rm init` — **migrate only (0018 → 0020); `seed.ts` is
   never invoked by this path**.
4. Recreate the **app container only** — the database container is not touched.
5. Verify: migration ledger 18 → 21, table counts unchanged, legacy fingerprint
   `251750bf8d85539ff5d1ea889d820b2e`, issued-document fingerprint
   `c9383e4b0fea0f460560effedeaff7bd`, Postgres still unpublished, Ollama still loopback.

No production reset, no reseed, no truncation, no exposure change.

## M. Rollback plan

For the record, nothing needs rolling back: **production was never modified.** It remains at
migration 18, image `madrasa-app:0.1.0` (`fc8654e2`), with all counts unchanged.

To discard this work entirely: `git reset --hard 501e7e2` (the v2.1 head). Migrations 0018, 0019 and 0020
exist only in the repository and on the destroyed clones — they were never applied to production.

---

## N. Principal acceptance checklist (Arabic)

> **لم يكتمل النطاق بعد — هذه القائمة للمراجعة المبكرة لا للاعتماد النهائي.**
> المتبقي: محرّر القوالب (المرحلة E) والمراجعة الشاملة للشيفرة.

**البرامج**
- [ ] يظهر زر «إضافة برنامج» في صفحة الخطة التشغيلية
- [ ] يمكن حفظ برنامج بلا أي معلومات، ويظهر باسم «بدون عنوان»
- [ ] النقر المتكرر على الحفظ لا ينشئ برنامجين
- [ ] يظهر زر «إقفال البرنامج» ويعمل بلا اشتراط شواهد أو نتائج
- [ ] البرنامج المغلق يختفي من القائمة التشغيلية ويظهر في قسم «البرامج المغلقة»
- [ ] «إعادة فتح البرنامج» تُرجعه، وسجل الإقفال السابق يبقى ظاهراً

**التنقّل**
- [ ] زر «العودة» ظاهر في كل صفحة فرعية
- [ ] العودة تُرجع إلى الصفحة السابقة المنطقية لا إلى الرئيسية دائماً
- [ ] يعمل على الجوال وباتجاه من اليمين لليسار

**المالية**
- [ ] تسجيل إيراد ومصروف بلا اختيار برنامج أو تصنيف
- [ ] إنشاء بند صرف وتعديل مخصصه وأرشفته واستعادته
- [ ] بطاقات «مصروف المستلزمات» و«متبقي المستلزمات» و«مصروف النشاط» و«متبقي النشاط» صحيحة
- [ ] المصروف المتجاوز للمخصص **يُحفظ** ويظهر تنبيه بمقدار التجاوز بلا أي إقرار
- [ ] إرفاق فاتورة صورة أو PDF يعمل، والحفظ بلا فاتورة يعمل

**التقارير**
- [ ] «تقارير القسم» في كل قسم يفتح فئته الصحيحة
- [ ] المرشّحات والترتيب وتقسيم الصفحات تعمل
- [ ] تصدير CSV وExcel يعمل ويفتح بالعربية بشكل صحيح

**القوالب**
- [ ] تفتح صفحة «إدارة القوالب» وتعرض أنواع الوثائق
- [ ] إنشاء قالب وتعديل عنوانه ونصوصه وألوانه وخطه
- [ ] المعاينة تعرض الشكل النهائي بالعربية من اليمين لليسار
- [ ] النشر يجعل القالب مستعملاً في الوثائق الجديدة
- [ ] تعديل القالب بعد النشر يُنشئ **نسخة جديدة** ولا يغيّر القديمة
- [ ] **وثيقة صدرت سابقاً تبقى كما هي تماماً بعد تعديل القالب** (الأهم)
- [ ] استعادة نسخة سابقة تعمل ولا تحذف النسخ اللاحقة
- [ ] «إعادة الافتراضي» و«تكرار» و«أرشفة» و«استعادة» تعمل

**ملاحظات تشغيلية عاجلة (قبل أي اعتماد)**
- [ ] عنوان الجهاز تغيّر إلى `192.168.0.48` — لا بد من تحديث `TRUSTED_ORIGINS` وإلا **تعذّر تسجيل الدخول من الشبكة المحلية**
- [ ] Ollama مكشوف على الشبكة المحلية — يُقيَّد على `127.0.0.1`

---

## Outstanding work before approval can be requested

1. **§11.1** — complete file-by-file repository review with classified findings.
2. **§11.6** — security test suite for the older surfaces (IDOR, CSRF/origin, login throttling,
   session invalidation, upload attacks, concurrent writes).
3. **§12** — Playwright suite, RTL desktop + mobile, restart/persistence, backup/restore rehearsal.
4. **Feature gaps**, all documented in §B: saved report configurations, configurable report
   columns, Word export from the report centre, template column/section editing UI, version
   comparison view, actual-record template preview, term and academic-year dashboard cards,
   unsaved-changes warning.
5. **K.1 / K.2** — the two live production issues, worth acting on independently of this scope.

**Phase E is complete** and no longer blocks; item 1 and 2 are the substantive remainder.
