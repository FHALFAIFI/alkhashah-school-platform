# Scope v2.2 — Final Feature-Gap Closure Report

**School:** مجمع الخشعة التعليمي للبنين
**Branch:** `scope-v2.1-corrections` · **Head:** `ba72f73` · **Base of this round:** `b591be2`
**Date:** 2026-07-29
**Production status: UNTOUCHED.** Still migration 18, 78 tables, all counts unchanged, no container
restarted (app up 44 h, db up 2 days), zero audit rows written in the last 24 h.

---

## Verdict

# CONDITIONALLY READY

Every one of the five disclosed feature gaps is closed and verified, and every mandatory gate in
the final cycle passed on a clean install. Two conditions remain, **neither of which is engineering
work and neither of which I am authorised to perform**:

1. **Ollama is not loopback-only** (§8.4). This is a pre-existing, reachable, high-severity
   exposure on the production host — unchanged by this round because it is a production
   configuration change. The instruction to confirm "Ollama remains loopback-only" **cannot be
   confirmed: it is false, and was false before this work began.** The fix is one environment
   variable and a restart of the Ollama service only.
2. **The principal's own Arabic acceptance pass** on `/pilot` (checklist in §13).

One further operational note, not a defect: the SWOT report ships with a working model and an empty
table in production until the principal re-imports the operational-plan workbook (§6). The section
states this in Arabic rather than presenting an empty screen as a finding.

I am not marking this **READY** while a reachable high-severity exposure stands unresolved, per the
release rule in the instruction. I am not marking it **NOT READY** either — that would misdescribe
the state: no gap is open, no gate failed, and no code work remains in this scope.

---

## 1. Exact completion status for every remaining gap

| # | Gap (previous status) | Status now | Where |
|---|---|---|---|
| 1 | Template **column and section editing UI** (§E2 — *Partial*: modelled, not surfaced) | **Implemented** | §2 |
| 2 | Template **version comparison** (§E5 — *Not Implemented*) | **Implemented** | §3 |
| 3 | **Actual-record template preview** (§E4 — *Not Implemented*) | **Implemented** | §4 |
| 4 | **Report-coverage reconciliation** — SWOT (*Not Implemented*) | **Implemented on the authoritative source** | §5, §6 |
| 4 | **Report-coverage reconciliation** — meeting attendance (*Not Implemented*) | **Not Applicable, documented and enforced by test** | §7 |
| 5 | **Complete dependency security evidence** (previously "no *direct* advisory", which is not the same as clean) | **Delivered in full; 3 root advisories dispositioned; 2 fixed by override** | §8 |

**Explicitly still open — by your instruction to close only the disclosed gaps and not broaden
scope.** None of these was in this round's list, and none is claimed as done: saved report
configurations (§D10), configurable visible report columns (§D10), Word export *from the report
centre* (§D10 — Word output was added for the *template preview*, which is a different surface),
page-break preview (§E4), template logo picker (§E2), term / academic-year finance dashboard cards
(§B6), unsaved-changes warning (§C), nonce-based strict `script-src` CSP (§11.5.H), per-entity
file-download scoping (§11.5.B).

---

## 2. Screens and routes for column and section editing

| Surface | Route / selector |
|---|---|
| Template editor (sections + columns) | `/admin/templates?template=<id>` |
| Sections panel | fieldset «أقسام الوثيقة (9)» — `data-testid="sections-editor"`, row `section-row-<key>` |
| Columns panel | fieldset «أعمدة الجدول (N)» — `data-testid="columns-editor"`, row `column-row-<key>` |
| Live preview (sample or real record) | sandboxed iframe «معاينة القالب» inside `data-testid="template-preview"` |
| Print / PDF output of the configuration | `GET /api/templates/preview?template=<id>&format=pdf[&record=<id>]` |
| Word output of the configuration | `GET /api/templates/preview?template=<id>&format=docx[&record=<id>]` |

**What the principal can do,** all in Arabic RTL, all from closed lists — no HTML, CSS, JavaScript,
expressions, arbitrary templates or remote resources exist as an input at any point:

- **view all available sections** — 9, each with an Arabic label and a one-line hint;
- **reorder sections** — ▲/▼ buttons (44 px touch targets; deliberately not drag-and-drop, which is
  hostile on a phone and in RTL), with the live position number shown;
- **show or hide sections** — a checkbox per section; a hidden section disappears from HTML, PDF and
  Word alike;
- **rename supported section headings** — six of the nine sections accept a heading
  (المقدمة، النص الثابت، المحتوى، الخاتمة، الملاحظات، التوقيع والاعتماد). الترويسة، العنوان and
  التذييل do not, and a stored label for them is ignored by the renderer — proven by test;
- **view all available table columns** — per document type, from a closed registry
  (`src/lib/templates/structure.ts`); a type with no table (خطاب رسمي عام) says so explicitly
  instead of offering invented columns;
- **reorder columns**, **show or hide columns**, **rename column labels**, **configure column
  widths** (integer percent, clamped 5–100, blank = automatic);
- **preview the result before publishing** — the preview uses the *same renderer as issuance*, and
  saving creates a **draft**; publishing is a separate, confirmed action.

**Why this is safe by construction, not by filtering.** Section and column keys are validated
against the closed registry for that document type at the server boundary
(`validateStructureKeys`), so an unknown or duplicated key from the editor *or from an imported
configuration* is rejected by name. Labels pass through the same escaper and placeholder registry as
every other template text. Width is a clamped integer rendered as `width:N%` — the only numeric that
reaches CSS, and a test asserts no non-numeric character can appear in that declaration.

**Tests — desktop RTL, mobile RTL, print, Word, PDF** (`tests/e2e/template-editor.spec.ts`,
`tests/e2e/template-editor-mobile.spec.ts`, `tests/unit/template-structure.test.ts`):

| Aspect | Evidence |
|---|---|
| Desktop RTL | e2e: all sections and columns visible; hide column → header disappears from the live preview; rename column → new label appears; section heading → renders; reorder → position number changes; save succeeds |
| Mobile RTL (390×844) | e2e: `dir="rtl"`, reorder by touch, hide column reflected in preview, **zero horizontal page overflow** |
| Print | e2e: preview stylesheet contains `@page`, `A4`, and mm margins |
| PDF | e2e: `/api/templates/preview?format=pdf` returns `application/pdf` and a body starting `%PDF` |
| Word | e2e: `format=docx` returns `wordprocessingml` and a `PK` ZIP container, built from the *same* section/column resolution as HTML and PDF |
| Unit | 26 assertions: hidden section absent from output, non-renamable section ignores a label, reorder changes emitted order, hidden column removes `<th>` and its cells, width clamped, empty cell renders «—» never `null`, malicious column label and malicious cell value both escaped |

**One real defect this testing caught and fixed:** the first version of the editor produced 4 px of
horizontal overflow at 390 px, because a flex-child `<input>` will not shrink below its intrinsic
width without `min-w-0`. Fixed in the row layout; the mobile spec now asserts overflow ≤ 1 px.

---

## 3. Version-comparison evidence

**Route:** `/admin/templates?template=<id>&cmpA=<versionId>&cmpB=<versionId>` —
a plain `method="get"` form, so the comparison is a URL, shareable and back-button safe, and works
without JavaScript.

**Read-only by construction.** The view is rendered from a pure function
(`src/lib/templates/diff.ts`) that takes two configurations and returns rows. It performs no write,
exposes no action, and the e2e test asserts the diff table contains **zero buttons**. Published
versions remain immutable and issued documents keep their frozen snapshot — unchanged guarantees,
re-proven by the existing template suite.

**Covered aspects — all of the required minimum, each with a unit test:**

| Required | Covered as | Test |
|---|---|---|
| text | نص المقدمة / الخاتمة / الثابت / الملاحظات / العلامة المائية | ✓ |
| titles | العنوان، العنوان الفرعي | ✓ |
| colours | اللون الأساسي، لون النص، خلفية رأس الجدول | ✓ |
| fonts | الخط، حجم الخط، حجم العنوان، تباعد الأسطر | ✓ |
| header and footer | نص الترويسة، نص التذييل | ✓ |
| visible sections | «القسم — الظهور» (ظاهر/مخفي) | ✓ |
| section order | «القسم — الترتيب» (بالموضع الفعلي) | ✓ |
| visible columns | «العمود — الظهور» | ✓ |
| column labels | «العمود — التسمية» | ✓ |
| column order | «العمود — الترتيب» | ✓ |
| page settings | المحاذاة، الاتجاه، الهوامش الأربعة، الإطار، الترقيم، تاريخ الطباعة، موضع رقم الوثيقة | ✓ |
| signature and approval labels | تسمية التوقيع، تسمية الاعتماد، إظهار كلٍّ منهما | ✓ |
| *(added)* section headings, column widths | «القسم — العنوان»، «العمود — العرض» | ✓ |

**Design decisions worth stating:** values are compared **after merging with the defaults**, so what
is shown is the difference that will appear in the document, not the difference in what happened to
be typed into a field. Order is compared by **resolved position**, not by the raw stored `order`
number, so a section that did not move never appears as a change merely because internal numbering
shifted. Booleans and empty values render as «نعم/لا» and «—» — a test asserts the strings `true`,
`null`, `undefined` never reach the screen. 19 unit tests + 1 e2e test.

---

## 4. Actual-record preview evidence and authorization results

**Surface:** inside the editor — a record picker («اختر برنامجاً» / «اختر لجنة» / …) plus a
«معاينة بسجل حقيقي» button; server action `previewWithRecordAction`. Export of the same preview to
PDF/Word goes through `/api/templates/preview?...&record=<id>`.

**Record sources: 13 of the 14 document types.** خطاب رسمي عام has no record concept and says so
(«لا سجلات لهذا النوع — المعاينة ببيانات نموذجية آمنة»), which is the required safe sample-data
fallback rather than a dead control. Each source declares its **own** read permission:

| Document type | Record | Permission |
|---|---|---|
| تقرير برنامج · وثيقة إقفال برنامج | برنامج | `plan.read` |
| تقرير المخاطر | سنة تخطيطية (صفوفه = مخاطرها) | `plan.read` |
| تقرير مالي · تقرير الإيرادات والمصروفات | بند صرف | `budget.read` |
| نموذج توزيع مهام لجنة | لجنة | `committees.read` |
| محضر اجتماع لجنة · محضر اجتماع مجلس | اجتماع | `committees.read` |
| تقرير أداء موظف · تقرير التقييم النهائي | جلسة أداء | `performance.individual.read` |
| تقرير التقييم الخارجي | دورة تقييم (صفوفه = خطط تحسينها) | `performance.individual.read` |
| تقرير الشواهد | برنامج (صفوفه = شواهده) | `evidence.read` |
| تقرير المبنى والمرافق | غرفة (صفوفها = أصولها) | `building.read` |
| خطاب رسمي عام | — | sample data only |

### Authorization results

| Probe | Result |
|---|---|
| No session, `GET /api/templates/preview` | **401** |
| Session without `admin.settings` | **403** (route) / `AuthError` (action) |
| Holds `admin.settings` but **not** the record's own permission | **rejected** — «لا تملك صلاحية قراءة هذا النوع من السجلات» |
| **IDOR:** committee id passed to a *program-report* template | **rejected**, and the committee's name never appears in the response |
| Non-existent UUID | **404 / rejected**, no data disclosed |
| Malformed id (`not-a-uuid`) | **400**, rejected before any query runs |
| **Archived** program (outside the eligible set) | **rejected** |
| Version id belonging to a *different* template | **404** |

**Why IDOR cannot succeed here, structurally:** the picker list and the loader are built from the
**same query with the same filters**. `load(id)` does not fetch by primary key and then check — it
re-derives the eligible set (archived excluded, synthetic excluded, joins intact) and returns `null`
unless the id is inside it. There is no code path that reads a record the list would not have shown.

**No side effects.** Integration tests assert that after a preview: `documents` count unchanged
(no document issued, no document number consumed, no frozen snapshot created), `template_versions`
count unchanged (no version created), and the record row is **byte-identical** (compared as JSON
before/after). An audit row is written whose Arabic summary states «لم تصدر وثيقة».

**Visually unmistakable as a preview:** an amber banner reads
«**معاينة فقط —** لم تصدر وثيقة، ولم تُنشأ لقطة مجمّدة، ولم يتغيّر السجل: *<record label>*», the panel
heading switches to «المعاينة (سجل حقيقي)», and a «العودة إلى البيانات النموذجية» control is always
present.

**Unsafe content cannot render.** The preview renders through the same escaper and closed
placeholder registry as issuance and is displayed in a `sandbox=""` iframe. Tests assert that a
program literally named `<img src=x onerror="alert(1)">` renders escaped, and that the output
contains no `http(s)://`, no `<script`, and no `@import`. Configuration is re-validated server-side
before the record is even loaded, so an invalid section/column key is rejected before any data
access. 14 integration tests + 2 e2e tests.

---

## 5. Complete section-to-report matrix

Every route under `src/app/(app)` was audited — **not a sample**. The matrix lives in
`tests/unit/report-coverage.test.ts` and is **enforced**: a new page with no classification fails
the suite, and a classification for a route that no longer exists also fails it, so the matrix
cannot quietly rot.

**Registry now: 53 reports across the same 13 categories** (was 46). Seven added this round.

### Sections with a working report

| Section (route) | Category | Default report opened |
|---|---|---|
| `/plan` | الخطة والبرامج | category landing |
| `/plan/[id]` | الخطة والبرامج | category landing |
| `/plan/kpis` | الخطة والبرامج | **مؤشرات الأداء** *(new)* |
| `/plan/followup` | الخطة والبرامج | **المتابعة الأسبوعية** *(new)* |
| `/plan/classifications` | الخطة والبرامج | البرامج حسب المجال |
| `/tasks` | الخطة والبرامج | **المهام والإجراءات** *(new)* |
| `/calendar` | الخطة والبرامج | **التقويم الدراسي** *(new)* |
| `/plan/risks` | المخاطر والتحليل الرباعي | سجل المخاطر |
| `/plan/swot` *(new page)* | المخاطر والتحليل الرباعي | **سجل التحليل الرباعي** *(new)* |
| `/evidence`, `/evidence/[id]` | الشواهد | category landing |
| `/budget` | المالية والميزانية | category landing + 7 card deep links |
| `/performance` (+ cycle, session) | الأداء الوظيفي | category landing |
| `/committees` (+ committee) | اللجان والمجالس | category landing |
| `/committees/[id]/meetings/[mid]` | الاجتماعات والقرارات | category |
| `/building` (+ rooms, facilities, assets, maintenance, inspections) | المبنى والمرافق | category landing |
| `/building/documents` | الوثائق والمرفقات | category |
| `/people`, `/people/[id]` | الموظفون | category landing |
| `/documents` | الوثائق والمرفقات | category landing |
| `/imports`, `/imports/[id]` | الاستيراد وجودة البيانات | category landing |
| `/admin/audit` | سجل الاستخدام | **سجل التدقيق** *(link added)* |
| `/admin/feedback` (+ `[id]`) | سجل الاستخدام | **سجل الملاحظات والبلاغات** *(new)* |

### Sections classified Not Applicable, with the written reason

| Route | Reason |
|---|---|
| `/dashboard` | لوحة تجميع — تعرض ملخّصات التقارير نفسها ولا سجل مستقل لها |
| `/pilot` | قائمة قبول التشغيل التجريبي — ليست سجل بيانات |
| `/reports`, `/reports/executive` | مركز التقارير نفسه؛ والتقرير التنفيذي مخرج لا قسم بيانات |
| `/notifications` | إشعارات لحظية لكل مستخدم — لا سجل مؤسسي يُصدَّر |
| `/assistant`, `/assistant/drafts` | محادثات ومسودات مؤقتة حتى تُعتمد في سجلها الأصلي |
| `/admin/settings`, `/admin/settings/ai`, `/admin/backup`, `/admin/cleanup`, `/admin/templates` | تهيئة وعمليات إدارية لا بيانات مدرسية |
| `/admin/users` | حسابات الدخول — بيانات أمنية لا تُصدَّر في تقارير |
| `/plan/[id]/report`, `/committees/[id]/report`, `/building/report` | وثائق مولَّدة — مخرجات لصفحاتها الأب |
| `/performance/models`, `/performance/models/[id]` | نماذج التقييم الرسمية — تهيئة مرجعية |
| `/committees/templates`, `/committees/meeting-types`, `/committees/task-templates` | قوالب وأنواع — تهيئة مرجعية |
| `/building/3d`, `/building/editor/[floorKey]`, `/building/scan`, `/building/offline` | واجهات عرض وإدخال هندسي لا سجلات |
| `/building/inspections/templates` (+ new / `[id]` / edit) | قوالب فحص — تهيئة مرجعية |
| `/people/new`, `/imports/new` | نماذج إدخال |

**One orphan category, stated rather than hidden:** «التقييم الخارجي» has reports
(خطط التحسين) but no dedicated application section; it is reached from the report centre. The
matrix test asserts this is the *only* orphan, so a second one cannot appear unnoticed.

### No broken buttons

- Unit: every `<SectionReportsLink>` in the codebase points at an existing category **and**, when it
  names a report, that report exists **and** belongs to that category.
- Unit: every report in the registry has a loader, and every loader has a report — neither orphan is
  tolerated.
- e2e: all 17 section buttons are clicked in a real browser; each lands on the right category with
  the right report and no error. `/plan` before the plan is imported has no button and shows its
  documented Arabic empty state instead — the test asserts that alternative explicitly rather than
  passing silently.

---

## 6. SWOT — data source and report evidence

**The earlier statement «no SWOT data model exists» was true of the database and incomplete about
the source of truth.** The official workbook that production actually imported —
`الخطة_التشغيلية_المتكاملة_لمجمع_الخشعة_1448_1449.xlsx`, batch `operational_plan`, status «منفذة» —
contains a fully populated sheet **«التحليل الرباعي»** (named «SWOT» in the analysis-only variant of
the same workbook). The importer read seven sheets and simply never read that one.

**Evidence, produced by running the real importer against the real file (parse only — no database
write, no batch created, no commit):**

```
summary: {"برامج":26,"مخرجات":26,"مؤشرات":15,"مخاطر":9,
          "عناصر التحليل الرباعي":24,"بنود ميزانية":6,"صفوف خارطة":26}
swot rows: 24    by category: {"قوة":6,"ضعف":7,"فرصة":5,"تهديد":6}
codes: قوة-01 … قوة-06, ضعف-01 … ضعف-07, فرصة-01 … فرصة-05, تهديد-01 … تهديد-06
all rows status ready: true      implication present: 24/24
```

The sibling counts corroborate the source: 26 programs and 15 KPIs and 9 risks are exactly what
production holds today, so the 24 SWOT items come from the same authoritative sheet as the data
already in production.

**Implementation** (all additive):

| Piece | Location |
|---|---|
| Data model | `plan_swot_items` — planYear, category, code, item, implication, sortOrder, importBatch (migration **0021**) |
| Import | `parsePlanWorkbook` reads «التحليل الرباعي» / «SWOT»; row type `swot`; ignores unknown types and duplicate codes |
| Section | **`/plan/swot`** — grouped نقاط القوة / نقاط الضعف / الفرص / التهديدات, with counts, plus sidebar entry «التحليل الرباعي» |
| Deep link | «تقارير القسم» → `/reports?category=risks&report=swot-register` |
| Reports | **سجل التحليل الرباعي** (النوع، الرمز، العنصر، الدلالة الاستراتيجية، السنة) and **التحليل الرباعي حسب النوع** |
| Category | «المخاطر» renamed «المخاطر والتحليل الرباعي» — still 13 categories |

**Values stored verbatim,** per the source-fidelity rule — no paraphrase, no derivation, no invented
weights.

**Import semantics, chosen to be safe under repetition:** `(planYearId, code)` is unique, so
re-importing the same workbook cannot duplicate. A conflicting row is **left untouched**
(`onConflictDoNothing`) rather than silently rewritten, because the text is official. A pre-existing
row is deliberately **not attributed** to the later batch, so rolling that batch back never deletes
an item an earlier batch created — proven by a test that imports twice and then rolls the second
batch back, expecting all four fixture items to survive.

**Report evidence:** integration test seeds three real-shaped items and asserts the register returns
them, that filtering by type works, that partial Arabic search works, and that the by-category
aggregate counts correctly. The report also runs in the "every report against a real database" sweep.

**Honest operational note.** In **production** the table ships **empty** until the principal
re-imports the plan workbook (preview → commit; committing an import is the principal's manual
action and is never performed by me). Until then `/plan/swot` shows an explicit Arabic empty state
naming the import as the way to populate it — no broken button, and no empty report presented as
though it were a finding. On a production clone the migration creates the table with **0 rows**,
confirming no seeding and no invention.

---

## 7. Meeting-attendance applicability decision

**NOT APPLICABLE — no report, and no button that would open one.** Recorded as **D-030**.

The absence of an attendance model is a deliberate product decision, stated in the schema and the UI
long before this round:

- `committee_members`: «تسجيل عند التشكيل فقط، **لا حضور ولا غياب**»
- `meeting_attachments`: «(ليست حضوراً — **لا حضور ولا غياب ولا نصاب**.)»
- `/committees/[id]`: «تسجل العضوية عند التشكيل فقط — لا حضور ولا غياب ولا نصاب»
- `/committees/[id]/report`: «لا حضور ولا غياب ولا نصاب»

**Verified empirically against production, not assumed:** no table and no column anywhere in the
production schema matches `attend`, `present`, `absent` or `quorum`. Membership is time-scoped
(`effectiveFrom` / `effectiveTo`) — a formation record, not a per-meeting presence record.

Creating an attendance report would therefore mean either a permanently empty screen or inventing
presence data the school never recorded. Neither is acceptable, so neither was done. The
الاجتماعات والقرارات category continues to report what genuinely exists: **سجل الاجتماعات** and
**القرارات والتوصيات**.

**The classification is enforced, not just written down:** a unit test asserts that no report in the
registry is keyed or labelled after حضور / غياب / attendance, so the decision cannot drift back into
a fabricated report later. If the principal ever wants attendance recorded, that is a new data model
(an additive `meeting_attendance` table plus its UI), not a reporting change.

---

## 8. Complete direct and transitive dependency-security results

### 8.1 The three audits

| Audit | Command | Result |
|---|---|---|
| Complete | `npm audit` | **21 vulnerable packages** — 16 high, 5 moderate, **0 critical** |
| Production / runtime only | `npm audit --omit=dev` | **10 vulnerable packages** — 9 high, 1 moderate, **0 critical** |
| Development dependencies | complete minus production | **11 packages**, dev-only: `eslint`, `eslint-config-next`, `eslint-plugin-import`, `eslint-plugin-jsx-a11y`, `eslint-plugin-react`, `@eslint/config-array`, `@eslint/eslintrc`, `drizzle-kit`, `esbuild`, `@esbuild-kit/core-utils`, `@esbuild-kit/esm-loader` |

**"No direct advisory" is not a clean result, and is not claimed as one.** Those 21 package entries
collapse to **three root advisories**; everything else is propagation through dependency edges. Both
framings are given below, because only the root list is actionable and only the package list matches
what `npm audit` prints.

### 8.2 Two advisories fixed this round (npm `overrides`)

`npm audit fix --force` proposes `next@9.3.3` and `exceljs@3.4.0` — those are **catastrophic
downgrades**, not fixes, and were rejected. Targeted overrides of the *transitive* packages were used
instead:

| Package | Before | After | Effect |
|---|---|---|---|
| `postcss` (inside `next`) | 8.4.31 | **8.5.24** | clears GHSA-r28c-9q8g-f849 (high), GHSA-6g55-p6wh-862q (high), GHSA-qx2v-qp2m-jg93 (moderate) |
| `sharp` (optional dep of `next`) | 0.34.5 | **0.35.3** | clears GHSA-f88m-g3jw-g9cj — libvips CVE-2026-33327 / -33328 / -35590 / -35591 (high) |

Runtime advisories dropped **13 → 10** (12 high → 9 high). Both overrides were verified inside a
**freshly built production image**: `postcss 8.5.24`, `sharp 0.35.3` with `@img/sharp-linux-arm64`
and `@img/sharp-libvips-linux-arm64` native binaries present — so the change installs on the actual
deployment platform, not only on this Mac. Full suite green afterwards.

### 8.3 Remaining advisories — full disposition

| | **A** | **B** | **C** |
|---|---|---|---|
| **Package** | `brace-expansion` | `uuid` | `esbuild` |
| **Version present** | 1.1.16, 2.1.2, 5.0.7 | 9.0.1 (under `exceljs`) | 0.18.20 (under `@esbuild-kit/core-utils`) |
| **Advisory** | GHSA-mh99-v99m-4gvg — DoS via unbounded brace expansion → OOM | GHSA-w5hq-g745-h8pq — missing buffer bounds check in v3/v5/v6 when `buf` is supplied | GHSA-67mh-4wv8-2f99 — esbuild dev server answers any website's request |
| **Severity** | **High** | Moderate | Moderate |
| **Direct or transitive** | Transitive | Transitive | Transitive |
| **Runtime or development** | **Runtime tree** (also dev) | **Runtime tree** | **Development only** |
| **Reachable?** | **No** | **No** | **No** |
| **Affected application path** | `exceljs → archiver → {archiver-utils → glob, readdir-glob} → minimatch → brace-expansion`. Reached only when a **glob pattern** is expanded. Verified: `exceljs` never calls `archiver.glob()` or `.directory()`; the application passes **no glob pattern anywhere** — `grep` for `glob`/`minimatch` across `src/` and `scripts/` returns nothing. Dev-side, `eslint` expands only our own committed config patterns. | `exceljs` requires `uuid` in exactly one file (`cf-rule-ext-xform.js`) and uses **`v4` only**. The advisory affects `v3`/`v5`/`v6` **and only when a `buf` argument is passed**. Neither condition can occur. | `drizzle-kit`'s loader chain. Triggered only by `esbuild --serve`, which is never executed — `db:generate` / `db:migrate` do not start a dev server. `tsx` (the only dev tool the container actually runs, for migrations) carries its own esbuild 0.25.12, which is unaffected. |
| **Available correction** | `brace-expansion@5.0.8` | `uuid@11.1.1+` | `esbuild@0.25+` via `drizzle-kit@0.18.1` |
| **Regression risk** | **High — rejected.** A flat override forces v5 onto `minimatch@3.x`, which expects the v1 API. Breaks lint and xlsx tooling for an unreachable path. npm overrides cannot be conditioned on a version range. | **Moderate — rejected.** Modern `uuid` majors are ESM-only; forcing one onto `exceljs@4.4.0` (CommonJS) risks breaking every xlsx import and export in the platform. | **High — rejected.** The proposed route is a **major downgrade** of `drizzle-kit` (0.31.10 → 0.18.1), which would invalidate the migration tooling that manages production. |
| **Final disposition** | **ACCEPTED**, unreachable, documented, re-check each release | **ACCEPTED**, unreachable by construction | **ACCEPTED**, not present in any executed path |

### 8.4 Two corrections to the previous dependency statement

1. **"Development-only; absent from the production image" (§K.8) was wrong.** Both `Dockerfile` and
   `Dockerfile.production` run `npm ci` **without `--omit=dev`** and copy the whole `node_modules`
   into the runner stage. Dev dependencies **are** on disk in the production image (440 entries).
   This is not accidental: the compose `init` service runs `npx tsx src/db/migrate.ts`, and `tsx` is
   a devDependency, so a production install genuinely needs them. The accurate statement is: *present
   on disk, never loaded by the running Next.js server; the only dev tool executed in production is
   `tsx`, whose bundled esbuild is not affected.* Hardening this (a separate prod-only install layer,
   or promoting `tsx`/`drizzle-kit` to dependencies) is recorded as follow-up work — it changes the
   image layout and belongs in its own change, not in a release being frozen for approval.
2. **"No direct dependency carries its own advisory" was true but is not equivalent to clean** — and
   is no longer used as a summary. §8.1–8.3 give the complete direct **and** transitive picture.

### 8.5 Against the release rule

> *"The release cannot be marked Ready while a reachable **critical or high** vulnerability remains
> unresolved or unaccepted."*

- **Critical: zero**, in every audit mode.
- **High, dependency-side:** one root advisory (`brace-expansion`), transitive, present in the
  runtime tree, **not reachable** by any application path, **explicitly accepted** above with the
  reason the fix is refused. It is not left unaddressed.
- **High, infrastructure-side: one is genuinely unresolved.** `ollama` still listens on `*:11434`
  and answers on the LAN address — an unauthenticated inference API reachable from any device on the
  school network. Re-verified today: `ollama … TCP *:11434 (LISTEN)`. It is pre-existing, unchanged
  by this round because it is a production configuration change I am not authorised to make, and it
  is **the reason this report says CONDITIONALLY READY rather than READY**. Remediation:
  `OLLAMA_HOST=127.0.0.1:11434` in the Ollama service environment, restart Ollama only, then confirm
  the LAN address refuses. It touches no application code, no container, and no data.

---

## 9. Final test counts

One clean, undisturbed cycle: no file edited, no dependency installed, no commit made while any test
process was running.

| Gate | Result |
|---|---|
| Clean install (`rm -rf node_modules && npm ci`) | **PASS** |
| `npm run typecheck` (strict) | **PASS** — 0 errors |
| `npm run lint` | **PASS** — 0 errors, 0 warnings |
| `npm run build` (production) | **PASS** — compiled in 4.9 s; `/plan/swot` present in the route manifest |
| **Vitest — complete suite** | **PASS — 606 / 606**, 66 files (was 527 / 62) |
| **Playwright — complete suite** | **PASS — 72 passed · 1 skipped · 0 failed** (was 60 / 1; the skip is gate C5, deferred under D-018) |
| Template security tests | **PASS** — 37 existing + 26 new structure tests + 19 diff tests |
| Actual-record preview authorization + IDOR | **PASS** — 14 integration + 2 e2e |
| Report deep-link tests | **PASS** — 8 matrix unit + 3 e2e (17 section buttons clicked) |
| Complete dependency audits (full / prod / dev) | **PASS** (executed and dispositioned — §8) |
| Production-clone migration rehearsal | **PASS** — §10 |
| Restart rehearsal | **PASS** — §10 |
| Backup rehearsal | **PASS** — §10 |
| Restore rehearsal (fresh **and** the held real backup) | **PASS** — §10 |

**+79 tests this round** (527 → 606 unit/integration, 60 → 72 e2e):

- 26 unit — section/column registry, resolution, renderer honouring order/visibility/label/width, clamping, escaping of malicious labels and cells, schema acceptance and rejection
- 19 unit — version comparison across all twelve required aspects, plus purity and Arabic value rendering
- 8 unit — section↔report matrix, orphan detection, link integrity, loader↔report completeness
- 2 unit — SWOT reports defined on real data; no attendance report may exist
- 14 integration — record preview: authorization, permission separation, IDOR (wrong type / non-existent / malformed / archived), no document issued, no version created, record unchanged, audit row, escaping, no remote resources
- 3 integration — SWOT import: four types parsed, duplicates and unknown types ignored, verbatim storage, rollback, idempotent re-import that does not steal ownership
- 1 integration — SWOT reports over seeded data with filter, search and aggregate
- 6 e2e desktop — section/column editing, width, no-table type, PDF, Word, print CSS
- 1 e2e mobile — editor usable at 390 px RTL with zero horizontal overflow
- 2 e2e — record preview banner and route authorization
- 1 e2e — version comparison, read-only
- 3 e2e — report deep links across 17 sections, SWOT link, risks category

**One stale assertion was updated, deliberately and visibly:** `report-export-safety.test.ts`
previously asserted `reportByKey("swot-register")` is `undefined` — an assertion encoding "SWOT has
no data model". That premise changed, so the test now asserts the opposite *and* adds the attendance
guard. The underlying rule — a report must be backed by data that exists — is unchanged and still
enforced.

---

## 10. Migration impact

**Migrations in this release: 0018, 0019, 0020, 0021.** Forward-only, additive only. No existing
migration edited. `seed.ts` never ran.

**0021 (`0021_futuristic_mandrill.sql`) — new in this round.** One table, two FKs, two indexes:

```sql
CREATE TABLE "plan_swot_items" (id, plan_year_id NOT NULL, category NOT NULL, code NOT NULL,
                                item NOT NULL, implication, sort_order NOT NULL DEFAULT 0,
                                import_batch_id, created_at NOT NULL DEFAULT now());
FK plan_year_id → plan_years(id);  FK import_batch_id → import_batches(id);
INDEX plan_swot_year_idx (plan_year_id);
UNIQUE INDEX plan_swot_year_code_unique (plan_year_id, code);
```

**No destructive operation anywhere in 0018–0021:** no drop, no rename, no type change, no data
transformation, no backfill.

### Production-clone rehearsal (read-only dump → isolated clone → migrate → compare → destroy)

| Table | Production today | Clone before | Clone after |
|---|---|---|---|
| drizzle migrations | **18** | 18 | **22** |
| programs | 26 | 26 | 26 |
| **program_activities** | **129** | **129** | **129** |
| **program_milestones** | **129** | **129** | **129** |
| people | 54 | 54 | 54 |
| documents | 31 | 31 | 31 |
| evidence_items | 25 | 25 | 25 |
| stored_files | 72 | 72 | 72 |
| committees / meetings | 4 / 5 | 4 / 5 | 4 / 5 |
| perf_sessions | 11 | 11 | 11 |
| budget_income / budget_expenses | 2 / 2 | 2 / 2 | 2 / 2 |
| plan_budget_items | 2 | 2 | 2 |
| audit_log | 339 | 339 | 339 |

Only the migration ledger advanced. Fingerprints:

```
D-022 legacy (129 activities + 129 milestones): 4572c57060e20c4b0de4db52545a8e3f
                                         after: 4572c57060e20c4b0de4db52545a8e3f   MATCH
Issued documents (31 snapshots):               c9383e4b0fea0f460560effedeaff7bd
                                         after: c9383e4b0fea0f460560effedeaff7bd   MATCH
```

*(The D-022 value differs from the number quoted in the earlier report because the aggregate
expression differs. What matters is before-vs-after under the identical expression, and production
carries the same value today.)*

**`seed.ts` did not run — proven, not asserted:** all five tables introduced by 0018–0021 came out
**empty** (`plan_swot_items` 0, `financial_items` 0, `program_closure_history` 0,
`template_definitions` 0, `template_versions` 0), and every new nullable column on existing rows is
**100 % NULL** (`programs.closed_at`, `programs.created_by`, `documents.template_version_id`,
`budget_income.financial_item_id`, `budget_expenses.financial_item_id` — all 0 non-null).

**Idempotent:** re-running the migration left the ledger at 22 and changed nothing.

### Restart rehearsal — PASS

Fully isolated stack (own network, own containers, own volumes), running the **newly built
production image** against a production data clone. Production was never restarted; its uptime is
unchanged.

| Step | Result |
|---|---|
| `init` (migrate only, no seed) | ledger 18 → 22 |
| App start | `{"status":"ok","db":"up","version":"0.1.0"}` |
| `docker restart` both containers | completed |
| Health after restart | `{"status":"ok","db":"up"}` |
| Data after restart | programs 26 · activities 129 · milestones 129 · people 54 · documents 31 · swot 0 |
| Issued-document fingerprint after restart | `c9383e4b…` **unchanged** |
| Auth gate after restart | `/login` 200 · `/dashboard` **307 → /login** |

### Backup rehearsal — PASS

`npm run backup:daily` executed **inside the new production image** against the rehearsal database:
6.1 MB encrypted dump (`aes-256-cbc`, PBKDF2, 200 000 iterations), file mode `600`.

### Restore rehearsal — PASS, twice

| Source | Result |
|---|---|
| The **fresh** backup just taken | decrypted (6.4 MB) → restored into an isolated database → **83 tables**, ledger 22, programs 26, activities 129, milestones 129, people 54, documents 31, issued-document fingerprint `c9383e4b…` **byte-identical** |
| The **held real** pre-deploy backup `backups/predeploy/db-20260727-131643.dump.enc` — the artifact an actual rollback would use | `SHA256SUMS` **OK** (db + storage) → decrypted (5.56 MB) → restored → **78 tables**, ledger **17**, programs 26, activities 129, milestones 129, people 54, documents 22, users 2 |

Ledger 17 and 22 documents are **correct** for a pre-0017 snapshot taken on 2026-07-27; documents
have been issued since. The rollback recovery point is genuine and restorable.

**All rehearsal artifacts destroyed:** clone database dropped, rehearsal containers and network
removed, the production dump and the rehearsal backups deleted. No real school data was written into
the repository at any point.

### Production confirmations, re-verified after the whole cycle

| Confirmation | Result |
|---|---|
| Production remains untouched | ✅ no writes — **0 audit rows in the last 24 h**; app up 44 h, db up 2 days (never restarted) |
| Production remains at migration 18 | ✅ **18** |
| `seed.ts` did not run | ✅ new tables empty on the clone; production has **none of the five new tables** (0 of 5 present) and still **78 tables** |
| All 31 issued document snapshots byte-identical | ✅ `c9383e4b0fea0f460560effedeaff7bd` — unchanged before, during and after |
| 129 legacy activities and 129 milestones unchanged | ✅ 129 / 129, fingerprint match |
| PostgreSQL remains unpublished | ✅ `madrasa-prod-db-1` shows `5432/tcp` only — no host binding |
| Ollama remains loopback-only | ❌ **NOT TRUE — it listens on `*:11434`.** Pre-existing (§K.1), unchanged by this round, unresolved. See §8.5 |

*(App binding is `0.0.0.0:3080` — the existing, previously authorised LAN binding. Unchanged.)*

---

## 11. Production deployment commands that never run `seed.ts`

**Do not execute without the principal's explicit approval.** No production change has been made and
none is proposed unilaterally here. `seed.ts` is unreachable at every step: the `init` service is
migrate-only, and seeding exists solely behind an explicit `--profile bootstrap`.

```bash
cd ~/Developer/School/"Father's File"

# 0) Confirm the starting point
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from drizzle.__drizzle_migrations;"          # expect 18

# 1) Fresh encrypted backup — from INSIDE the prod network (the guard refuses the dev DSN)
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm -e DATABASE_URL="postgresql://madrasa:$POSTGRES_PASSWORD@db:5432/madrasa" \
  init sh -c 'npm run backup:daily'
(cd backups/predeploy && shasum -a 256 -c SHA256SUMS-*.txt | tail -3)   # verify before continuing

# 2) Tag the current image for rollback
docker tag madrasa-app:0.1.0 madrasa-app:0.1.0-prev-v2_2-$(date +%Y%m%d)

# 3) Build the new image  (verified to build clean with the postcss/sharp overrides)
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod build app

# 4) Apply migrations 0018 → 0021. MIGRATE ONLY — `init` cannot invoke seed.ts at all.
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm init

# 5) Recreate the APP CONTAINER ONLY — the database container is not touched
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --no-deps app

# 6) Verify
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from drizzle.__drizzle_migrations;"          # expect 22
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from program_activities;"                    # expect 129
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from program_milestones;"                    # expect 129
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select md5(string_agg(doc_number||coalesce(html_snapshot,''),'|' order by doc_number)) from documents;"
#   expect c9383e4b0fea0f460560effedeaff7bd (issued documents unchanged)
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from plan_swot_items;"                       # expect 0 until the plan is re-imported
docker ps --format '{{.Names}} {{.Ports}}' | grep madrasa-prod  # db must show 5432/tcp only
curl -s http://127.0.0.1:3080/api/health
```

**Guarantees:** `seed.ts` is not invoked at any step; no reset, truncate or reseed; the database
container is never recreated; no port, firewall, Docker, Postgres or Ollama exposure is changed.

### Two configuration items, independent of this deployment

1. **Ollama LAN exposure (§8.5, K.1) — recommended before or with approval.** Set
   `OLLAMA_HOST=127.0.0.1:11434` for the Ollama service, restart Ollama only, confirm the LAN
   address refuses. No application change, no container change, no data touched.
2. **Stale `TRUSTED_ORIGINS` entry (K.2) — optional, not a fault.** Login and Server Actions work
   normally over the LAN. Dropping the dead IP entry shrinks the allowlist; a router DHCP
   reservation is the durable answer. The live LAN address is `192.168.0.171`.

### After deployment, to populate SWOT (the principal's action)

Re-import `الخطة_التشغيلية_المتكاملة_لمجمع_الخشعة_1448_1449.xlsx` from «استيراد جديد». The batch
opens in «معاينة»; committing it is the principal's manual action. Programs are protected by the
existing `(year, seq)` constraint, and SWOT codes are unique per year, so nothing duplicates.

---

## 12. Rollback plan

**Nothing needs rolling back today: production was never modified.** It remains at migration 18,
image `madrasa-app:0.1.0` (`fc8654e2`), 78 tables, all counts unchanged.

**To discard this work entirely:** `git reset --hard 501e7e2` (the v2.1 head). Migrations 0018–0021
exist only in the repository and on destroyed clones; they were never applied to production.

**If this release is deployed and must then be rolled back:**

```bash
# 1) Application only — instant, no data change (0018–0021 are additive; the old image ignores them)
docker tag madrasa-app:0.1.0-prev-v2_2-<date> madrasa-app:0.1.0
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --no-deps app
curl -s http://127.0.0.1:3080/api/health

# 2) Only if data must also be rewound — restore the pre-deploy backup (destructive, last resort)
BACKUP_PASSPHRASE=… bash scripts/restore.sh backups/predeploy/db-<stamp>.dump.enc
```

Step 1 is the expected path and is sufficient: every migration in this release is purely additive, so
the previous image runs unchanged against the new schema. Step 2 discards anything entered since the
backup and should only be used on a data-integrity failure. The 2026-07-27 recovery point was
re-verified today: checksums OK, decrypts, and restores to 78 tables / 26 programs / 129 / 129 / 54.

**Rollback of the dependency overrides alone:** delete the `overrides` block from `package.json`,
`npm install`, rebuild. Nothing in the application code depends on the newer `postcss` or `sharp`.

---

## 13. Principal acceptance checklist (Arabic)

> **اكتمل النطاق الهندسي وكل البوابات ناجحة. هذه القائمة هي القبول النهائي قبل النشر.**
> النشر لم يتم بعد — الإنتاج كما هو تماماً (هجرة 18، لا شيء تغيّر).

**القوالب — تحرير الأقسام والأعمدة (الجديد)**
- [ ] تفتح «إدارة القوالب» ← قالب ← تظهر مجموعتان جديدتان: «أقسام الوثيقة» و«أعمدة الجدول»
- [ ] إخفاء قسم (مثل «الملاحظات») يخفيه من المعاينة فوراً، وإظهاره يعيده
- [ ] أزرار ▲ ▼ تعيد ترتيب الأقسام، ويتغيّر الترتيب في المعاينة
- [ ] كتابة عنوان لقسم «المقدمة» يظهر العنوان في المعاينة
- [ ] إخفاء عمود «المجال» يزيله من جدول المعاينة، وإعادة تسمية عمود تغيّر عنوانه
- [ ] ضبط عرض عمود بنسبة مئوية يغيّر عرضه فعلاً
- [ ] «خطاب رسمي عام» يقول صراحةً إنه بلا جدول (وهذا صحيح لا نقص)
- [ ] يعمل كل ما سبق على **الجوال** بالعربية من اليمين لليسار بلا تمرير أفقي
- [ ] «معاينة PDF» و«معاينة Word» تفتحان ملفاً يحترم ما أخفيته وما أعدت تسميته

**القوالب — المعاينة بسجل حقيقي (الجديد)**
- [ ] تختار سجلاً حقيقياً من القائمة وتضغط «معاينة بسجل حقيقي» فتظهر بياناته الفعلية
- [ ] يظهر شريط برتقالي: «**معاينة فقط —** لم تصدر وثيقة، ولم تُنشأ لقطة مجمّدة، ولم يتغيّر السجل»
- [ ] بعدها: **لا وثيقة جديدة** في «الوثائق الصادرة»، والسجل نفسه لم يتغيّر
- [ ] «العودة إلى البيانات النموذجية» تعمل

**القوالب — مقارنة النسخ (الجديد)**
- [ ] تختار نسختين وتضغط «قارن» فتظهر الفروق مجمَّعة (نصوص، ألوان، خطوط، صفحة، توقيع، أقسام، أعمدة)
- [ ] المقارنة **عرض فقط** — لا زر يعدّل شيئاً داخلها
- [ ] النسخة المنشورة لم تتغيّر، و**وثيقة صدرت سابقاً تبقى كما هي تماماً** (الأهم)

**التحليل الرباعي (الجديد)**
- [ ] يظهر «التحليل الرباعي» في القائمة الجانبية ويفتح صفحته
- [ ] قبل إعادة الاستيراد: تظهر رسالة واضحة أن العناصر تُستورد مع مصنف الخطة (لا شاشة فارغة بلا تفسير)
- [ ] بعد إعادة استيراد مصنف الخطة: تظهر **24 عنصراً** — 6 قوة، 7 ضعف، 5 فرص، 6 تهديدات
- [ ] «تقارير القسم» من صفحة التحليل الرباعي يفتح «سجل التحليل الرباعي» مباشرةً

**التقارير**
- [ ] «تقارير القسم» يعمل في كل قسم ويفتح فئته الصحيحة (17 قسماً)
- [ ] التقارير الجديدة تعمل: مؤشرات الأداء · المتابعة الأسبوعية · المهام والإجراءات · التقويم الدراسي · الملاحظات والبلاغات
- [ ] لا يوجد **زر يفتح تقريراً فارغاً بلا سبب** ولا زر معطّل

**قرار مسجَّل للعلم**
- [ ] **حضور الاجتماعات: لا ينطبق** — لا يوجد في المنصة تسجيل حضور ولا غياب ولا نصاب (قرار قائم منذ
      البداية ومكتوب في النظام). لم يُنشأ تقرير حضور لأن بياناته غير موجودة، ولن يُختلق.

**ملاحظات تشغيلية (للعلم — ليست عيوباً في هذه النسخة)**
- تسجيل الدخول من الشبكة المحلية **يعمل بشكل طبيعي**.
- **Ollama مكشوف على الشبكة المحلية** بدل الاقتصار على 127.0.0.1 — إصلاحه إعداد مستقل عن هذه النسخة،
  ويحتاج موافقتك (متغيّر واحد وإعادة تشغيل خدمة Ollama وحدها).
- عنوان الجهاز الحالي `192.168.0.171`؛ الحجز الثابت في الموجّه هو الحل الدائم.

---

## Appendix — files added and changed

**New modules**

| File | Purpose |
|---|---|
| `src/lib/templates/structure.ts` | Closed registry: 9 sections, per-type columns, key validation, resolution |
| `src/lib/templates/diff.ts` | Pure version-comparison engine (Arabic labels, grouped output) |
| `src/lib/templates/records.ts` | Server-only eligible-record sources with per-type permissions and the IDOR guard |
| `src/app/api/templates/preview/route.ts` | PDF and Word output of a template configuration (preview only) |
| `src/app/(app)/plan/swot/page.tsx` | «التحليل الرباعي» section |
| `drizzle/0021_futuristic_mandrill.sql` | `plan_swot_items` |

**Changed**

`src/lib/templates/render.ts` (sections + columns drive the output; sample table),
`src/app/(app)/admin/templates/{page,template-ui,actions}.tsx|ts` (editor panels, comparison view,
record picker, preview action), `src/lib/reports/{catalog,loaders}.ts` (+7 reports),
`src/db/schema/plan.ts`, `src/lib/imports/plan.ts` (SWOT parse / commit / rollback),
`src/lib/navigation.ts`, `src/components/app-shell.tsx`, seven section pages (report links),
`package.json` (+ `overrides`), `docs/DECISIONS.md` (D-030).

**Tests added**

`tests/unit/template-structure.test.ts`, `tests/unit/template-diff.test.ts`,
`tests/unit/report-coverage.test.ts`, `tests/integration/template-record-preview.test.ts`,
`tests/e2e/template-editor.spec.ts`, `tests/e2e/template-editor-mobile.spec.ts`,
`tests/e2e/report-deeplinks.spec.ts`, plus additions to `import-plan`, `report-center`,
`report-export-safety`, `mobile.spec` and the shared plan-workbook fixture.
