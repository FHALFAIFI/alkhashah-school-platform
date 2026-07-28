# Scope v2.2 — Engineering Report

**School:** مجمع الخشعة التعليمي للبنين
**Branch:** `scope-v2.1-corrections` · **Base:** `501e7e2` · **Head:** `c31a737`
**Date:** 2026-07-28
**Production status: UNTOUCHED.** Still at migration 18, counts unchanged, no container restarted.

---

## A. Executive verdict

**NOT READY for production approval.**

This is not a quality judgement on what was built — the four commits below are complete,
tested and rehearsed against a real production clone. It is a scope judgement, and §11.8 of
the brief is explicit: *"Do not request production approval if the complete code review,
security review, safe cleanup, dependency review, and quality gates have not been completed
and documented."*

Two things block approval:

1. **Phase E (template editor) is not implemented.** It is a large greenfield subsystem —
   template definitions, versioning, frozen render snapshots, an allowlisted style model, a
   safe placeholder engine, preview, and 14 template types. None of it exists yet. Starting
   it partially would have left a half-built document-issuance path touching frozen records,
   which is worse than not starting.
2. **The full-repository review (§11.1) is partial.** The dependency review, secret scan,
   infrastructure/exposure review and migration review are done and are below. A
   file-by-file review of every route, action, service and component in the repository is
   not.

Separately, this work surfaced **two live production issues that exist right now, before
any v2.2 deployment** (§K.1 and §K.2). One of them almost certainly means the principal
cannot log in from the LAN today. Those want attention regardless of this scope.

**Delivered and ready for review:** Milestones 1–3 (Phases A, B, C, D) plus a security-driven
dependency patch. 433 tests green, migrations rehearsed on a production clone with a matching
legacy fingerprint.

---

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
| **E1–E7** | Template editor, versioning, frozen snapshots | **Not implemented** |
| **§8** | Global optional-field rule extended to new fields | Implemented |
| **§9** | Minimum forward-only migrations; no edits to old ones; no seed | Implemented (0018, 0019) |
| **§10** | Authorisation, upload validation, audit for new surfaces | Implemented |
| **§11.4** | Dependency review | **Implemented** |
| **§11.1** | Complete file-by-file repository review | **Partial** |
| **§11.3** | Safe cleanup | Partial — two proven-dead server actions removed; no repo-wide sweep |
| **§12** | Regression coverage | Implemented for delivered phases |
| §12 | Playwright suite | **Not run** — see §F |

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

**Dependency + clone fix — `c31a737`**: `package.json`, `package-lock.json`, `src/lib/reports/loaders.ts`.

---

## D. Database impact

**Migrations added: 0018, 0019.** Forward-only, additive only. No old migration edited. `seed.ts` never ran.

**0018 (`0018_tidy_storm.sql`)** — 1 table, 6 nullable columns, 3 FKs, 1 index
- `program_closure_history` (append-only)
- `programs`: `closed_at`, `closed_by`, `closure_note`, `reopened_at`, `reopened_by`, `created_by`

**0019 (`0019_clever_raza.sql`)** — 1 table, 6 nullable columns, 4 FKs, 3 indexes
- `financial_items`
- `budget_income` / `budget_expenses`: `financial_item_id`, `archived_at`, `archived_by`

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

Retained legacy activities and milestones: **preserved, untouched, unreferenced by new code.**
Existing uploaded files: untouched — no migration touches `stored_files` or the storage volume.
Issued/frozen documents: untouched — no migration touches `documents` or its snapshots.

---

## F. Test results

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** (strict, no errors) |
| `npm run lint` | **PASS** (0 errors, 0 warnings) |
| `npm run build` | **PASS** (compiled successfully) |
| `npm test` (vitest) | **PASS — 433/433**, 59 files (baseline was 287) |
| Production-clone migration rehearsal | **PASS** — see §D |
| All 46 reports against real production data | **PASS** — 803 rows |
| **Playwright e2e** | **NOT RUN** |
| Restart / persistence rehearsal | **NOT RUN** |
| Backup / restore rehearsal | **NOT RUN** |

**+146 tests added:**
- 13 integration — program creation and closure (empty save, title fallback, no auto-activities, duplicate-click, sequence allocation, closure with nothing, separation from archive/approval, idempotency, **concurrent closure**, reopen history accumulation, evidence preservation)
- 11 unit — navigation (logical parent, dynamic ids, non-page segments, loop guard, and an **exhaustive check that all 64 routes resolve to a real parent page**)
- 26 unit — finance calculations (per-item independence, null≠zero, no NaN, overspend flagging, archived exclusion, cancelled/expected income, no double counting, warning never blocks)
- 20 integration — school-level finance (saves without program/category, blank amounts, item linkage, integrity guard, per-item recalculation on archive and re-tag, totals matched against a **direct SQL sum**, colour allowlist rejection, idempotent archive/restore, historical program-linked rows still render)
- 21 unit — export safety and catalogue integrity (formula injection, filename traversal, page clamping, sort whitelist, **no report exposes a sensitive column**)
- 55 integration — report centre (**every one of the 46 reports executed against a real database**, malicious sort column, oversized page size, unknown-report rejection, aggregate-date regression)

Two of these earned their keep by finding real defects before release: the route-coverage test
caught `/admin/*` pages linking to a non-existent `/admin` index, and the clone run caught the
aggregate-date crash described in §K.5.

**Why Playwright, restart and backup rehearsals were not run:** they belong to the pre-deployment
gate for a *complete* scope. With Phase E absent the build cannot be proposed for deployment, so
running them now would produce evidence for a package that will change. They must be run before
any approval request.

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

**Not implemented.** No template definitions, versions, snapshots, placeholders, preview, or
editable properties were built. Phase E remains entirely outstanding.

---

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

### Security testing not performed

IDOR probing across all entity types, CSRF/origin rejection tests, login throttling and session
invalidation tests, path-traversal and double-extension upload tests, oversized-file tests, and
concurrent financial-write tests. These belong to the §11.6 pass, which is outstanding along with
the rest of the full review.

---

## L. Deployment plan

**Not proposed.** Per §A this build is not ready for approval, so no deployment commands are given
here. When Phase E and the full review are complete, the plan will follow the v2.1 cutover shape:
fresh encrypted backup → build image → `docker compose run --rm init` (**migrate only, never
`seed.ts`**) → recreate the app container only → verify counts, fingerprint and exposure. No
production reset, no reseed, no exposure change.

---

## M. Rollback plan

For the record, nothing needs rolling back: **production was never modified.** It remains at
migration 18, image `madrasa-app:0.1.0` (`fc8654e2`), with all counts unchanged.

To discard this work entirely: `git reset --hard 501e7e2` (the v2.1 head). Migrations 0018 and 0019
exist only in the repository and on the destroyed clone — they were never applied to production.

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

**ملاحظات تشغيلية عاجلة (قبل أي اعتماد)**
- [ ] عنوان الجهاز تغيّر إلى `192.168.0.48` — لا بد من تحديث `TRUSTED_ORIGINS` وإلا **تعذّر تسجيل الدخول من الشبكة المحلية**
- [ ] Ollama مكشوف على الشبكة المحلية — يُقيَّد على `127.0.0.1`

---

## Outstanding work before approval can be requested

1. **Phase E** — template editor, versioning, frozen snapshots (largest item).
2. **§11.1** — complete file-by-file repository review with classified findings.
3. **§11.6** — security test suite (IDOR, CSRF, throttling, upload attacks, concurrency).
4. **§12** — Playwright suite, RTL desktop + mobile, restart/persistence, backup/restore rehearsal.
5. **D10 gaps** — saved report configurations, configurable columns, Word export.
6. **B6 gap** — term and academic-year dashboard cards.
7. **C gap** — unsaved-changes warning.
8. **K.1 / K.2** — the two live production issues, which are worth acting on independently of this scope.
