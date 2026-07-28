# Scope v2.2 — Engineering Report

**School:** مجمع الخشعة التعليمي للبنين
**Branch:** `scope-v2.1-corrections` · **Base:** `501e7e2` · **Head:** `8aa9362`
**Date:** 2026-07-28
**Production status: UNTOUCHED.** Still at migration 18, counts unchanged, no container restarted.

---

## A. Executive verdict

**CONDITIONALLY READY — every mandatory engineering gate has now been executed. Approval is a
judgement call for the principal, not a blocked gate.**

All five functional phases (A–E) are implemented. The §11.1 repository review, the §11.6 security
verification of the pre-existing codebase, and all four operational gates (Playwright, restart,
backup, restore) have been run, with findings recorded in
`docs/SCOPE_V2_2_CODE_REVIEW_FINDINGS.md`.

The review found and fixed **4 High** issues, of which two were latent in the pre-existing system:
production's compose ran `seed.ts` on every start (H1), and official documents interpolated
user-entered names into HTML unescaped (H2). It also resolved every reachable dependency advisory
(H3, H4) — `npm audit` now reports no direct dependency carrying its own advisory.

**I must correct an earlier statement.** I previously reported that a stale `TRUSTED_ORIGINS` entry
was rejecting Server Actions and probably blocking the principal's login. Empirical testing shows
that is **not true** — `allowedOrigins` is only consulted when Origin and Host differ, which never
happens for direct LAN browsing. Login works. See §K.2.

**What remains open is disclosed, not hidden:** a set of feature gaps inside §D10/§E/§B6/§C listed in
the matrix, and four accepted technical-debt items with stated rationale and remediation plans. The
two production-configuration observations (§K.1 Ollama LAN exposure, §K.2 stale allowlist entry) are
unchanged in production because I have made no production changes.

I am not marking this **Ready**: that word should follow the principal's own acceptance pass on
`/pilot`, plus a decision on the disclosed gaps.

## B. Requirement matrix

Every requirement marked **Implemented / Partial / Not Implemented**, each with evidence.
Evidence keys: `T` = automated test · `E` = executed/observed evidence · `C` = code location.

### Phase A — program creation and final closure

| § | Requirement | Status | Evidence |
|---|---|---|---|
| A1 | Add-program capability exists and is visible | **Implemented** | C `plan/program-create-ui.tsx`; discovery proved no create path existed before |
| A1 | Available from the operational-plan section | **Implemented** | C `plan/page.tsx` |
| A1 | Works on desktop and mobile | **Implemented** | T Playwright `mobile.spec.ts` viewport 390×844 |
| A1 | Optional-field rule; saves incomplete | **Implemented** | T "يحفظ برنامجاً فارغاً تماماً" |
| A1 | Missing title renders «بدون عنوان» | **Implemented** | T asserts `orFallback` output |
| A1 | Appears in list immediately | **Implemented** | C `revalidateProgramLists()` |
| A1 | Duplicate creation from repeated clicks prevented | **Implemented** | T "يمنع الإنشاء المكرر"; two layers (pending button + server window) |
| A1 | Arabic saving state and useful errors | **Implemented** | C `SubmitButton` pending + Arabic Zod messages |
| A1 | Does not auto-create activities/milestones | **Implemented** | T "لا يُنشئ أنشطة ولا معالم تلقائياً" |
| A2 | «إقفال البرنامج» action exists | **Implemented** | C `CloseProgramForm` |
| A2 | Arabic confirmation dialog | **Implemented** | C `SubmitButton confirmText` |
| A2 | Closure requires nothing at all | **Implemented** | T "يُقفل برنامجاً بلا شواهد ولا أنشطة ولا ملاحظة" |
| A2 | Preserves record, evidence, documents, finance, notes, reports | **Implemented** | T "الإقفال يحفظ الشواهد والوثائق والمراجع المالية" |
| A2 | Disappears from active lists; stays in history/reports; shows «مغلق» | **Implemented** | T report-centre test: absent from `programs-active`, present in `programs-closed` |
| A2 | Records closedAt/closedBy/optional note | **Implemented** | T asserts all three |
| A2 | «إعادة فتح البرنامج» restores and records reopenedAt/By | **Implemented** | T "إعادة الفتح تُرجع البرنامج" |
| A2 | Repeated close/reopen idempotent | **Implemented** | T idempotency + **concurrent double-close** produces exactly one history row |
| A2 | Historical audit never overwritten | **Implemented** | T "دورات إقفال/فتح متكررة تُراكم التاريخ" |
| A2 | Delete/archive vs close vs hide kept distinct | **Implemented** | T "الإقفال لا يمس الأرشفة ولا حالة الاعتماد" |

### Phase B — school-level finance

| § | Requirement | Status | Evidence |
|---|---|---|---|
| B1 | Finance decoupled from program/classification/domain/category | **Implemented** | T income and expense save with `programId` NULL; new forms contain no such control |
| B1 | Existing records preserved, not deleted | **Implemented** | E clone rehearsal: `budget_income`/`budget_expenses` counts unchanged |
| B1 | Legacy program/domain values preserved for history | **Implemented** | T "السجلات التاريخية المرتبطة ببرنامج ما زالت تُعرض" |
| B1 | Neutral historical label | **Implemented** | C renders «(تاريخي)» beside legacy text item |
| B1 | Existing reports/exports not broken | **Implemented** | T full suite green; legacy `getBudgetOverview` retained |
| B2 | Create / edit name / edit allocation / archive / restore / order / colour | **Implemented** | T "ينشئ بنداً ويعدّله ويؤرشفه ويستعيده"; reorder action |
| B2 | Per-item income, expenses, balance | **Implemented** | T per-item independence tests |
| B2 | Seed scripts must not run | **Implemented** | E new tables empty after clone rehearsal; **H1 fixed: seed removed from prod compose** |
| B2 | Controlled creation flow for المستلزمات/النشاط | **Implemented** | T idempotent, creates no allocation amount |
| B3 | Income school-level, optional item, blank amount, blank source/date/notes | **Implemented** | T blank-amount save; amount stays NULL |
| B3 | Invoice/receipt attachment, image or PDF, linkage preserved | **Implemented** | C shared `attachInvoice`; T signature validation |
| B3 | Edit and archive/delete; summaries update | **Implemented** | T archive recalculation |
| B4 | Expense school-level, optional item, blank amount, invoice number | **Implemented** | T |
| B4 | Image/PDF invoice; attachments preserved on edit | **Implemented** | C evidence-link pipeline |
| B4 | Recalculates only the affected item | **Implemented** | T "نقل مصروف إلى بند آخر يعيد حساب البندين فقط" |
| B5 | Authoritative server-side calculation | **Implemented** | C `src/lib/finance/calc.ts`, single service |
| B5 | Allocated / income / expenses / remaining / net per item | **Implemented** | T 26 unit tests |
| B5 | No double counting, no silent null→zero, no NaN, no raw null | **Implemented** | T explicit assertions each |
| B5 | Archived/cancelled/draft treatment defined | **Implemented** | T archived excluded, «ملغى» excluded, «متوقع» separated |
| B5 | One service for dashboard/details/reports/exports/print | **Implemented** | C report loaders call `getSchoolFinance` |
| B6 | All 9 required top cards | **Implemented** | C `budget/page.tsx` |
| B6 | Dedicated المستلزمات/النشاط cards | **Implemented** | C |
| B6 | Dynamic per-item table | **Implemented** | C |
| B6 | Monthly income/expense trend | **Implemented** | C report `monthly-trend` |
| B6 | Current month / term / academic-year totals | **Partial** | Monthly trend and date filtering exist; **no term/academic-year dashboard cards** |
| B6 | Highest-spending, near-exhaustion, over-allocation, attachment completeness | **Implemented** | C `nearExhaustion`, `overAllocationCount`, invoice counts |
| B6 | Cards deep-link to filtered reports | **Implemented** | C `href` on each `Stat` |
| B7 | «إقرار التجاوز» removed | **Implemented** | T success message contains no «إقرار»; ack columns unwritten |
| B7 | Overrun does not block saving; shows amount; no checkbox; no red field | **Implemented** | T "يحفظ مصروفاً يتجاوز المخصص بلا أي إقرار" |
| B7 | Format/upload validation still enforced | **Implemented** | T invalid amount rejected; unsafe upload rejected |

### Phase C — global navigation

| § | Requirement | Status | Evidence |
|---|---|---|---|
| C | Route-by-route audit | **Implemented** | E 64 routes audited; 58 lacked a back action |
| C | «العودة» on every meaningful subpage | **Implemented** | T exhaustive test over every route from the filesystem |
| C | Returns to logical parent, not always dashboard | **Implemented** | T parent-map assertions |
| C | Uses history when safe; explicit safe fallback | **Implemented** | C real `<a href>` + `router.back()` when history exists |
| C | Works on direct URL, after save, cancel, validation error | **Implemented** | C link works without JS; `usePathname` is post-navigation |
| C | Desktop and mobile; RTL preserved | **Implemented** | T Playwright mobile RTL |
| C | Prevents navigation loops | **Implemented** | T explicit loop-guard assertion |
| C | Shared component, not per-page buttons | **Implemented** | C `BackNav` mounted once in the shell |
| C | Automated route/navigation coverage | **Implemented** | T 11 unit tests incl. "every parent is a real page" (caught `/admin/*` → non-existent `/admin`) |
| C | Do not lose unsaved data silently; warn where necessary | **Not Implemented** | No unsaved-changes guard exists |

### Phase D — report centre

| § | Requirement | Status | Evidence |
|---|---|---|---|
| D | «تقارير القسم» in each major section | **Implemented** | C 9 sections wired |
| D | Opens the central reports page at the right category | **Implemented** | C `reportHref`; T deep-link assertions |
| D | One central registry, no per-section engine | **Implemented** | C `catalog.ts` + `loaders.ts` |
| D | All 13 required categories | **Implemented** | T `REPORT_CATEGORIES` length = 13 |
| D1–D9 | Meaningful reports on real existing data | **Implemented** (46 reports) | E all 46 executed against a production clone, 803 rows |
| D1 | No reintroduction of activities/milestones/weights/readiness/quotas | **Implemented** | C catalogue comment + absent columns |
| D8 | SWOT reports | **Not Implemented** | No SWOT data model exists in the platform; deliberately not fabricated |
| D5 | Attendance | **Not Implemented** | No attendance table; meetings report shows decision counts instead |
| D10 | Search, date range, status/person/section filters | **Implemented** | C filter bar; T filtered runs |
| D10 | Sorting, pagination | **Implemented** | T clamped page size, whitelisted sort |
| D10 | Print-friendly view | **Implemented** | C `print:hidden` on chrome |
| D10 | CSV export, Excel export | **Implemented** | C `/api/reports/export`; T injection guards |
| D10 | Word export | **Not Implemented** | Report centre exports CSV/Excel only; existing per-document Word exports untouched |
| D10 | PDF/print rendering | **Implemented** | Print view; per-document PDF unchanged |
| D10 | Configurable visible columns | **Not Implemented** | Columns come from the registry (this is also what makes the sensitive-column guarantee hold) |
| D10 | Saved report configurations | **Not Implemented** | Deferred; needs a migration + UI |
| D10 | Deep links, filter chips, reset filters | **Implemented** | C URL-driven state |
| D10 | Arabic RTL output, null-safe rendering | **Implemented** | T no raw null/undefined/NaN |
| D10 | Export auditing | **Implemented** | C audit row per export |
| D10 | Prevent formula injection | **Implemented** | T `= + - @ tab CR` neutralised in CSV and Excel, data and headers |
| D10 | Prevent sensitive field exposure | **Implemented** | T no report declares password/session/token/sha256/storagePath/htmlSnapshot |
| D10 | Prevent unauthorized report access | **Implemented** | T category + report permission both enforced server-side |
| D10 | Prevent unbounded exports | **Implemented** | T 5,000-row cap, truncation reported not silent |
| D10 | Prevent raw database errors | **Implemented** | C generic Arabic error on failure |

### Phase E — template editor

| § | Requirement | Status | Evidence |
|---|---|---|---|
| E1 | Central «إدارة القوالب» page | **Implemented** | C `/admin/templates` |
| E1 | Manage by document/report type | **Implemented** | T 14 types |
| E1 | Name, description, type, active/default, version, dates, created/modified by | **Implemented** | C schema + page columns |
| E2 | Titles, subtitles, fixed/intro/closing text, notes | **Implemented** | C editor fields |
| E2 | School name, ministry/department text | **Implemented** | C identity group |
| E2 | Header, footer, colours, font family/size, alignment, margins, orientation, line spacing, borders, table header styling, alternating rows | **Implemented** | C style group; T CSS built from allowlist |
| E2 | Signature/approval labels, notes, watermark, page numbering, print date, document-number placement | **Implemented** | C |
| E2 | School logo | **Partial** | Modelled and validated (`logoFileId`, internal file id only, rejects external URLs); **no picker in the editor UI** |
| E2 | Column labels/order/visibility/widths; section order/visibility | **Partial** | Modelled and schema-validated; **not surfaced in the editor UI** |
| E3 | Controlled placeholder system | **Implemented** | C closed registry, 28 placeholders |
| E3 | Show available placeholders per type | **Implemented** | C editor panel |
| E3 | Reject unknown placeholders | **Implemented** | T unknown and out-of-scope rejected by name |
| E3 | Escape unsafe HTML; prevent script execution | **Implemented** | T XSS payload matrix |
| E3 | Prevent SSTI, arbitrary code, DB queries, filesystem paths, secrets | **Implemented** | T no expression evaluation; no prototype access; unknown keys not substituted |
| E4 | Live/refreshable preview; desktop; print; Arabic RTL | **Implemented** | C `useMemo` preview in sandboxed iframe using the issue renderer |
| E4 | Sample data preview | **Implemented** | C `sampleValues()` |
| E4 | Page-break preview | **Not Implemented** | — |
| E4 | Actual-record preview with authorization | **Not Implemented** | Sample data only |
| E5 | Editing creates a new version | **Implemented** | T published version untouched; new row created |
| E5 | Issued documents retain their original snapshot | **Implemented** | T **explicit test**; E 31 real snapshots byte-identical across migration 0020 |
| E5 | Draft, publish, duplicate, archive, restore, set default, restore previous | **Implemented** | T each |
| E5 | Compare versions | **Not Implemented** | Version list with change notes only |
| E5 | Audit history | **Implemented** | C audit row per lifecycle action |
| E6 | Restore default; duplicate before editing | **Implemented** | T |
| E6 | Export / import template configuration | **Implemented** | C export to clipboard; T import validation |
| E6 | Reject incompatible/unsafe imports | **Implemented** | T script content, unknown key, bad JSON, oversized payload |
| E6 | No executable HTML/JS/CSS imports/external scripts/remote resources | **Implemented** | T rendered output contains no `http(s)://` and no `@import` |
| E6 | Safe allowlisted style model | **Implemented** | C closed enums + clamped numerics |
| E7 | 14 initial template types | **Implemented** | T length = 14 with Arabic labels |

### Cross-cutting

| § | Requirement | Status | Evidence |
|---|---|---|---|
| §8 | Global optional-field rule for all new fields | **Implemented** | T blank saves across finance, programs, templates |
| §9 | Minimum forward-only migrations; no edits to old; no seed | **Implemented** | 0018–0020 additive only; E rehearsed twice |
| §10 | Authorisation for finance/reports/exports/templates | **Implemented** | T 158/158 actions, 21/21 routes |
| §10 | Upload validation, filename sanitisation, path traversal, MIME/extension, size limits | **Implemented** | T + **new signature validation** |
| §10 | Audit logs for sensitive actions | **Implemented** | C program create/close/reopen, finance, template lifecycle, exports, document issuance |
| §10 | Postgres unpublished; Ollama loopback; no broadened exposure | **Partial** | E Postgres unpublished ✓, app binding unchanged ✓; **Ollama is NOT loopback-only** (K.1, pre-existing, unchanged by me) |
| §11.1 | Complete repository review | **Implemented** | `docs/SCOPE_V2_2_CODE_REVIEW_FINDINGS.md` |
| §11.2 | Coding best practices, single source of truth, strict typing | **Implemented** | Escaper, finance calc, report registry each unified; strict `tsc` clean |
| §11.3 | Safe cleanup | **Implemented** | 2 dead server actions + 2 unused dependencies removed, each proof-checked; 1 suspected orphan retained after proving it is used |
| §11.4 | Dependency review | **Implemented** | No direct dependency carries its own advisory |
| §11.5 | Complete security review | **Implemented** | Findings register §11.5.A–K |
| §11.6 | Security testing | **Implemented** | 30 new integration tests over pre-existing surfaces |
| §11.7 | Quality gates | **Implemented** | See §A and §F |
| §12 | Regression coverage; do not reduce prior coverage | **Implemented** | 526 vitest (was 287); Playwright suite retained and updated for intentional v2.2 UI changes |

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
| `npm run build` | **PASS** |
| `npm test` (vitest) | **PASS — 526/526**, 62 files (baseline 287) |
| **Playwright e2e** | see §F.1 |
| **Restart rehearsal** | **PASS** — §F.2 |
| **Backup rehearsal** | **PASS** — §F.3 |
| **Restore rehearsal** | **PASS** — §F.4 |
| Production-clone migration rehearsal (0018+0019, then 0020) | **PASS** — §D |
| All 46 reports against real production data | **PASS** — 803 rows |
| `npm audit` — direct dependencies | **PASS** — no direct dependency carries its own advisory |

### F.2 Restart rehearsal — PASS

Run on a **fully isolated stack** (own network, own containers, own volumes) using the production
image against a production data clone. Production was never restarted; its uptime is unchanged.

| Step | Result |
|---|---|
| App start against clone | `{"status":"ok","db":"up","version":"0.1.0"}` |
| `docker restart` both containers | completed |
| Health after restart | `{"status":"ok","db":"up"}` |
| Data after restart | programs 26 · activities 129 · milestones 129 · documents 31 — unchanged |

Production's own persistence configuration was separately verified: named volumes
(`madrasa-prod_pgdata`, `_storage`, `_backups`), `restart=unless-stopped` on both services, both
healthy. Audit rows spanning 2026-07-20 → 07-27 across the 07-27 app-container replacement are
empirical proof that data already survives container replacement.

### F.3 Backup rehearsal — PASS

`pg_dump` executed **inside** the production network (read-only), then encrypted with the same
cipher the scripts use (`aes-256-cbc`, PBKDF2, 200k iterations).

| Step | Result |
|---|---|
| Production dump | 6.1 MB |
| Encrypt → decrypt round-trip | **byte-identical** |
| Restore into isolated rehearsal DB | programs 26 · activities 129 · milestones 129 · documents 31 · migration 18 |
| Cleanup | rehearsal DB and all temp artifacts destroyed |

### F.4 Restore rehearsal — PASS (against a real historical backup)

Tested the **existing** `backups/predeploy/db-20260727-131643.dump.enc`, not a freshly made one —
this answers "are the backups we already hold genuine and restorable?"

| Step | Result |
|---|---|
| `SHA256SUMS` verification | **OK** (db + storage archives) |
| Decryption | OK (5.3 MB) |
| Restore into isolated DB | 78 tables · programs 26 · **activities 129 · milestones 129** · people 54 · users 2 · migration 17 |
| Interpretation | migration 17 is correct for a pre-0017 predeploy snapshot; documents 22 vs 31 today reflects documents issued since |

This also disproved a concern raised during review: the held backups do contain genuine production
data. The related defect was that *future* backups could silently target the dev database — fixed
under M4 in the findings register.

**+239 tests added:**
- 13 integration — program creation and closure (empty save, title fallback, no auto-activities, duplicate-click, sequence allocation, closure with nothing, separation from archive/approval, idempotency, **concurrent closure**, reopen history accumulation, evidence preservation)
- 11 unit — navigation (logical parent, dynamic ids, non-page segments, loop guard, and an **exhaustive check that all 64 routes resolve to a real parent page**)
- 26 unit — finance calculations (per-item independence, null≠zero, no NaN, overspend flagging, archived exclusion, cancelled/expected income, no double counting, warning never blocks)
- 20 integration — school-level finance (saves without program/category, blank amounts, item linkage, integrity guard, per-item recalculation on archive and re-tag, totals matched against a **direct SQL sum**, colour allowlist rejection, idempotent archive/restore, historical program-linked rows still render)
- 21 unit — export safety and catalogue integrity (formula injection, filename traversal, page clamping, sort whitelist, **no report exposes a sensitive column**)
- 55 integration — report centre (**every one of the 46 reports executed against a real database**, malicious sort column, oversized page size, unknown-report rejection, aggregate-date regression)
- 37 unit — template security (XSS payload matrix against escaper/schema/renderer, CSS injection, unknown config keys, out-of-range numbers, unknown and out-of-scope placeholders, no expression evaluation, no remote resources, 14 doc types)
- 30 integration — §11.6 security over pre-existing surfaces (argon2 + salting, session-token hashing, rate limiting, TOTP rejection, open-redirect rejection, per-module authorization denial for finance/plan/committees/imports/templates, **repository-wide sweeps asserting all 158 server actions and all 21 API routes are guarded**, upload rejection for bad/double extension, MIME mismatch, oversize, signature mismatch and path traversal, SQL/wildcard/sort injection through report filters, document escaping, frozen-snapshot immutability)
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

**K.2 — TRUSTED_ORIGINS names a stale IP — LOW — investigated, NOT a defect. My earlier claim was wrong.**

I previously reported this as HIGH and stated that Server Actions — including login — were being
rejected from the LAN URL. **That was incorrect, and I asserted it without testing.** The correction:

The machine is now `192.168.0.48` while `TRUSTED_ORIGINS` still lists `192.168.0.171:3080`. But
Next.js only consults `allowedOrigins` when the Origin header does **not** match the Host header
(`action-handler.js`: `else if (!host || originHost !== host.value)`). A browser opening
`http://192.168.0.48:3080` sends matching Origin and Host, so the allowlist is never reached.

Verified empirically against production with a non-destructive probe (bogus action id, which cannot
execute anything):

| Probe | Result | Meaning |
|---|---|---|
| Origin == Host, current LAN IP `.48` | `Server action not found.` | **Origin check passed — login works normally** |
| Origin `http://evil.example`, Host `.48` | `E80 Invalid Server Actions request` + server log `does not match … Aborting the action.` | CSRF protection working |
| Origin `.171` (the listed entry), Host `.48` | passed | allowlist honoured when origins genuinely differ |

**Does the principal have a problem? No.** Authentication and every Server Action work normally over
the LAN.

**Is a correction required? Not for function.** The `.171` entry is dead configuration: it grants a
cross-origin allowance for an address the machine no longer holds. The residual risk is small —
another LAN device acquiring `.171` by DHCP could send cross-origin Server Action requests, though
`SameSite=lax` prevents the victim's session cookie from riding along on a cross-site POST.

**Minimal safe fix (optional, not required):** drop the IP entry from `TRUSTED_ORIGINS`, leaving only
the Tailscale hostname. It shrinks the allowlist without changing any behaviour, because direct LAN
access never needs it. Do **not** replace it with `.48` — that would re-create the same staleness at
the next DHCP change. The durable fix remains a router DHCP reservation.

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

**K.13 — Production compose ran `seed.ts` on every start — HIGH — FIXED**

`compose.production.yml`'s `init` service was `migrate.ts && seed.ts`, and `app` depends on it
completing. `seed.ts` is idempotent and truncates nothing, so **no data was lost** — production
surviving many deploy cycles proves it — but the standing rule is that it must never run, and any
reference row added to seed data in a later version would have been inserted silently.
*Status:* **fixed** — `init` is migrate-only; seeding moved behind an explicit `bootstrap` profile.
Verified with `docker compose config`.

**K.14 — Uploads trusted browser MIME with no signature check — MEDIUM — FIXED**

§11.5.F requires that images and PDFs not be trusted on browser MIME alone. Added magic-byte
validation for every supported type. HTML disguised as `.pdf` is now rejected at save time.

**K.15 — No HTTP security headers — MEDIUM — FIXED (partially, honestly scoped)**

No CSP, frame protection, referrer or permissions policy existed. Added them.
*Important caveat:* the first CSP used `default-src 'self'` with no `script-src`, which made
`script-src` inherit `'self'` and blocked Next.js's inline hydration scripts — **every page rendered
empty**. The Playwright gate caught it. `script-src`/`style-src` now permit inline; nonce-based
hardening needs a request middleware and is recorded as accepted debt (D2), not claimed as done.

**K.16 — Raw error messages reached the UI — MEDIUM — FIXED**

Nine files returned `e.message` directly, which could disclose filesystem paths or raw English text.
Now only our own typed Arabic validation errors surface. The import-commit path had a comment
claiming sanitisation while returning the raw message; it now returns a generic message plus its
correlation reference, with full detail kept server-side in the audit row.

**K.17 — Backup scripts could silently target the DEV database — MEDIUM — FIXED**

Production's DB is unpublished and `.env` sets the dev DSN, so a terminal-run backup produced a
successful-looking encrypted file containing no school data. Scripts now print the target and refuse
port 5544 without `ALLOW_DEV_BACKUP=1`. The existing predeploy backup was separately verified to
contain genuine production data.

**K.18 — `adm-zip` crafted-ZIP memory exhaustion — HIGH — FIXED**

Reachable through xlsx import. Upgraded to 0.6.0 (semver-major, verified: all 31 import tests pass).
`npm audit` now reports **no direct dependency carrying its own advisory**.

**K.19 — Flat file-download authorization — MEDIUM — ACCEPTED, documented**

Any holder of `files.download` can fetch any file by UUID; there is no per-entity scope check. No
practical exposure under the current two-administrator role model, and sensitive files carry an
extra permission gate plus audit. Must be revisited if per-teacher accounts are introduced.

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

Provided for review. **Do not execute without the principal's explicit approval** — no production
change has been made and none is proposed here unilaterally.

```bash
cd ~/Developer/School/"Father's File"

# 0) Confirm the starting point
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from drizzle.__drizzle_migrations;"          # expect 18

# 1) Fresh encrypted backup — from INSIDE the prod network (the guard now refuses the dev DSN)
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm -e DATABASE_URL="postgresql://madrasa:$POSTGRES_PASSWORD@db:5432/madrasa" \
  init sh -c 'npm run backup:daily'
#    verify checksums before continuing
(cd backups/predeploy && shasum -a 256 -c SHA256SUMS-*.txt | tail -3)

# 2) Tag the current image for rollback
docker tag madrasa-app:0.1.0 madrasa-app:0.1.0-prev-v2_2-$(date +%Y%m%d)

# 3) Build the new image
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod build app

# 4) Apply migrations 0018 → 0020. MIGRATE ONLY — `init` no longer runs seed.ts at all.
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm init

# 5) Recreate the APP CONTAINER ONLY — the database container is not touched
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --no-deps app

# 6) Verify
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from drizzle.__drizzle_migrations;"          # expect 21
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from program_activities;"                    # expect 129
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from program_milestones;"                    # expect 129
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select md5(string_agg(doc_number||coalesce(html_snapshot,''),'|' order by doc_number)) from documents;"
#   expect c9383e4b0fea0f460560effedeaff7bd (issued documents unchanged)
docker ps --format '{{.Names}} {{.Ports}}' | grep madrasa-prod   # db must show 5432/tcp only
curl -s http://127.0.0.1:3080/api/health
```

**Guarantees of this plan:** `seed.ts` is not invoked at any step (it is no longer reachable without
`--profile bootstrap`); no reset, truncate or reseed; the database container is never recreated; no
port, firewall, Docker, Postgres or Ollama exposure changes.

### Two optional configuration items (independent of this deployment)

Neither is required for this release, and neither has been applied:

1. **Ollama LAN exposure (K.1)** — set `OLLAMA_HOST=127.0.0.1:11434` for the Ollama service and
   restart it, then confirm the LAN address refuses. No application change.
2. **Stale `TRUSTED_ORIGINS` entry (K.2)** — optionally drop `192.168.0.171:3080`, leaving only the
   Tailscale hostname. **This is not a fix for a fault** — login works today; it merely removes a
   dead allowance. Do not substitute the current IP; a router DHCP reservation is the durable answer.

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

**ملاحظات تشغيلية (للعلم لا للإصلاح العاجل)**
- تسجيل الدخول من الشبكة المحلية **يعمل بشكل طبيعي** — تقريرٌ سابق قال بغير ذلك وقد صُحِّح بعد اختبار فعلي.
- Ollama مكشوف على الشبكة المحلية بدل الاقتصار على 127.0.0.1 — إصلاحه إعدادٌ مستقل عن هذه النسخة.
- عنوان الجهاز الحالي 192.168.0.48؛ الحجز الثابت في الموجّه هو الحل الدائم لتغيّر العنوان.

---

## Outstanding work — disclosed, not hidden

Nothing below blocks an engineering gate. Each item is a scope decision for the principal:

| Item | § | Why it is not done |
|---|---|---|
| Saved report configurations | D10 | Needs a migration + UI; deferred |
| Configurable visible report columns | D10 | Columns come from the registry — which is also what makes the "no sensitive column" guarantee provable |
| Word export from the report centre | D10 | CSV/Excel/print delivered; per-document Word exports unchanged |
| Template column/section editing UI | E2 | Modelled and schema-validated; not surfaced in the editor |
| Template logo picker | E2 | Modelled (internal file id only); no picker UI |
| Version comparison view | E5 | Version list with change notes delivered |
| Actual-record template preview | E4 | Sample-data preview delivered |
| Page-break preview | E4 | — |
| Term / academic-year dashboard cards | B6 | Monthly trend + date filters delivered |
| Unsaved-changes warning | C | No guard exists anywhere in the app |
| SWOT reports | D8 | **No SWOT data model exists** — deliberately not fabricated |
| Meeting attendance reports | D5 | **No attendance table exists** — decision counts shown instead |
| Nonce-based strict `script-src` CSP | 11.5.H | Needs request middleware; accepted debt D2 |
| Per-entity file-download scoping | 11.5.B | No exposure under the two-administrator role model; accepted debt |
