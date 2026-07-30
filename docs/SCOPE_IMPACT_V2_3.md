# SCOPE IMPACT — v2.3.0 Principal Acceptance Release

> Requirements source: `docs/BRIEF_V2_3_0.md` (received 2026-07-31, principal's 5th round).
> Branch: `scope-v2.3-principal-acceptance` (base `6ce990b`, on top of deployed v2.2.1 /
> production migration 23). Decisions for this round: D-032+ in `docs/DECISIONS.md`.
> This document = Phase A inventory (brief §25) + gap analysis + implementation mapping.

Status: **Phase A COMPLETE (2026-07-31).** Decisions D-032…D-040 recorded in `docs/DECISIONS.md`.
Implementation proceeds per brief §25: B (data/domain) → C (reports/templates) → D (interface) →
E (simplification) → F (verification + controlled deployment).

---

## A1. Performance module map (brief §10–§12) — COMPLETE

### Routes
- `src/app/(app)/performance/page.tsx` (135) — landing: teacher/staff cycles, missing-signed-reports
  alert, prerequisite card, new-cycle form. Gates: `performance.read` / `performance.individual.read`
  / `performance.write`.
- `performance-ui.tsx` (81) — `NewCycleForm` (D-014 manual model selection + amber mismatch warning).
- `cycles/[id]/page.tsx` (254) — cycle detail: WorkflowSteps (تخطيط → منتصف → نهائي → الاكتمال),
  4 KPI tiles, sessions table, improvement plans, frozen-model table. **AskAssistant AI button
  at :82-84.**
- `cycles/[id]/cycle-ui.tsx` (77) — NewSessionForm / ImprovementPlanForm / PlanStatusControl.
- `cycles/[id]/sessions/[sid]/page.tsx` (229) — session detail: ratings, report issue (inline
  `issueReport` action :50), Word/Excel export links, signed-report upload, complete/reopen, version log.
- `sessions/[sid]/session-ui.tsx` (190) — RatingsForm, SignedReportUpload, CompleteSessionButton,
  ReopenSessionForm.
- `models/page.tsx` (75) + `models-ui.tsx` (110) + `models/[id]/page.tsx` (89) — model designer
  (only feature behind `performance.models.manage`).
- `actions.ts` (549) — all server actions.
- Adjacent: `api/export/perf-session-docx|xlsx/[id]/route.ts`, `src/lib/reports/session-report.ts`
  (PDF), `executive-report.ts:96-121`, `catalog.ts:337-370` (4 reports: perf-planning-sessions /
  perf-evaluations / perf-incomplete / perf-evidence-counts), `loaders.ts:430-470` (`loadPerfSessions`),
  `people/[id]/page.tsx:22-70`, `worklist.ts:335-382` (`performanceItems`), nav `app-shell.tsx:35-38`.

### Schema (`src/db/schema/performance.ts`, 192)
`perf_models` (key/nameAr/audience/official/status/version/approvedBy) · `perf_indicators`
(modelId cascade, sortOrder, weight numeric summing to 100, requiresEvidence) · `perf_cycles`
(personId, cycleType, yearKey, modelId, **calendarSnapshot + modelSnapshot jsonb frozen**, deadlines,
followupTarget default 5, status نشطة/مكتملة/مقفلة; unique (personId, yearKey)) · `perf_sessions`
(sessionType تخطيط/منتصف/نهائي/زيارة/متابعة, status مسودة/بانتظار التقرير الموقع/مكتملة/مقفلة,
strengths/improvementAreas/recommendations/actionsText, evaluationCompletedAt, **sessionResult +
coverage server-computed**, reportDocId, signedReportFileId, warningFlags jsonb) ·
`perf_signed_report_versions` (0012) · `perf_ratings` (rating int 1..5 nullable, unique
(sessionId, indicatorId)) · `improvement_plans`.

D-014: `src/lib/performance/d014.ts` — runtime-derived «بانتظار المطابقة مع نظام فارس» flags +
final-lock gate in `completeSessionAction` (:442-447). D-028: `src/lib/performance/scoring.ts:21-60`
`cycleProgress()` excludes «تخطيط», returns `evaluated` flag.

### Scoring (single source of truth for the new §11 analytics)
`src/lib/performance/scoring.ts` (72, unit-tested): `weightedScore = (rating/5)*weight`;
`sessionResult` = sum over rated + `coverage`; `cycleProgress` = latest rating per indicator across
non-planning sessions; `validRating` int 1..5; **`weakIndicators` = rating ≤ 2** (existing seed of
rules-based weakness detection). Only writer of sessionResult/coverage: `actions.ts:331-335`.

### Simplification candidates (§12)
Dead/write-only: `markEvaluationCompletedAction` (actions.ts:401-421, no UI caller — the only path
to «بانتظار التقرير الموقع»); `missingSignedReportCount()` (signed-reports.ts:40, no caller);
`perf_signed_report_versions` write-only (inserted actions.ts:372, never read in src/ — surface in
new individual report or leave); `perf_sessions.recommendations/principalComment/employeeComment`
never rendered by RatingsForm (`sessions/[sid]/page.tsx:133-140` omits them) → always null;
`perf_indicators.key/description`, `perf_models.description` never displayed;
`improvement_plans.sessionId` never populated, `.suggested` written not read.
Experimental/out-of-core: session types «زيارة»/«متابعة», followupTarget + warningFlags
(actions.ts:259-267), improvement_plans side-workflow. Triplicated indicator-table renderers:
session-report.ts:47-70 (PDF) / perf-session-docx:37-51 / perf-session-xlsx:43-47.

## A2. AI dependency map (brief §12 AI removal) — COMPLETE

- **package.json: ZERO AI dependencies** (all raw fetch to Ollama/AnythingLLM/api.anthropic.com).
- **SWOT import is 100% AI-free** — `src/lib/imports/plan.ts` imports only drizzle/schema/xlsx/framework;
  `parseSwotWorkbook` :427, `commitSwotRows` :445. **PRESERVE INTACT.**
- Delete entirely (~3,086 lines): `src/lib/ai/` (provider/settings/orchestrator/tools/assist, 1,815),
  `src/app/api/ai/` (chat, conversations, proposals, **test** = model-health endpoint),
  `src/app/(app)/assistant/` (chat + drafts pages), `src/app/(app)/admin/settings/ai/`,
  `src/components/assistant/` (assistant-chat 417, assistant-dock 94, ask-assistant 15),
  `tests/integration/ai.test.ts`, `tests/e2e/assistant.spec.ts`.
- Edit (19 files): `(app)/layout.tsx` (AssistantDock + getAiConfig), `app-shell.tsx:18` (nav),
  AskAssistant on 4 pages (perf cycle :82-84, plan/[id]:126, building/rooms/[id]:76,
  building/inspections:51-52), meetings page `AiMeetingAssistant` (:85-86),
  `integrations-actions.ts:13-33` (**keep `emailDocumentAction` — M365, not AI**),
  `integrations-ui.tsx:6-29` (**keep `EmailDocumentButton`**), admin/settings AI card (:65-76),
  **`pilot-status.ts:60-70` `aiStatus()` — health check firing on every /pilot render**,
  `pilot/page.tsx:234-244`, `feedback/constants.ts:58,79`, `navigation.ts:90-91`,
  `tasks/page.tsx:25`, `seed-data/permissions.ts:67-68` (`ai.use`/`ai.manage`),
  `admin/cleanup/page.tsx:146`, `playwright.config.ts:36-39` (AI_ENABLED=true in e2e server cmd),
  `RUNBOOK.md:37`.
- Env to drop: AI_ENABLED, AI_PROVIDER, OLLAMA_BASE_URL, OLLAMA_MODEL, OLLAMA_VISION_MODEL,
  ANYTHINGLLM_*, ANTHROPIC_API_KEY, CLAUDE_MODEL (in .env.example, .env.production.example,
  untracked .env/.env.production).
- Compose: `compose.production.yml` L29-31 (AI env) + L106-108 (extra_hosts host-gateway) + L3 comment.
  `docker-compose.yml`, Dockerfiles, next.config.ts: no AI references. `api/health` is DB-only — keep.
- DB: `ai_conversations/ai_messages/ai_action_proposals/ai_drafts` (`src/db/schema/ai.ts`, migration
  0002). Tables can stay in place (no destructive migration) with schema exports removed only if
  nothing references them — decision D-03x below.
- No AI-generated performance analysis exists anywhere; the «اقتراح» improvement-plan banner is the
  deterministic `weakIndicators()` rule. D-016 individual-score exclusion honored by AI tools (which
  are deleted anyway).

## A3. Date handling map (brief §2) — COMPLETE

**Headline: a working Hijri layer already exists for DISPLAY (`src/lib/dates.ts`, Umm al-Qura via
`Intl` `ar-SA-u-ca-islamic-umalqura-nu-latn`); every INPUT is Gregorian-only. Zero date libraries;
zero pg `date()` columns — storage is `timestamptz` (130 cols, mostly audit stamps) or ISO/verbatim
`text` (27 cols = the user-entered business dates).**

### Existing utilities (choke points)
- `src/lib/dates.ts` (102): `parseIsoDate` (noon-anchored UTC to dodge TZ day drift), `toHijriLong/
  Numeric`, `toGregorianLong/Numeric`, **`dualDisplay(iso, context, officialHijri?)`** — teacher →
  Hijri primary, employee → Gregorian primary, official Hijri strings rendered VERBATIM (load-bearing
  rule, tested `tests/unit/dates.test.ts`); `todayIso()`; `holidayWarnings()` (written+tested, zero
  callers — ready hook for the picker). Missing: the inverse `fromHijri(y,m,d)→ISO`, Hijri parsing,
  Hijri month-grid.
- `src/components/ui.tsx:146` `DualDate` display component (primary over secondary).
- `src/components/ui.tsx:181` **`Field`** — the single input primitive (D-029-hardened,
  data-1p-ignore, min-h-11).

### Entry points (15 total, all Gregorian)
11 via `Field type="date"`: tasks/task-ui:27; committees committee-ui:188, meeting-ui:41,132;
performance-ui:68-70 (3 deadlines); cycle-ui:23; session-ui:68-69. 2 via `Field` as PLAIN TEXT
(bug): budget-ui:66 incomeDate, :141 expenseDate (accepted as bare `z.string()`; malformed dates
silently dropped by `finance/calc.ts:253-255` monthly aggregation). 4 raw `<input type="date">`:
reports/report-filters:71,75; admin/feedback/page:83,87. Plus a disabled preview input in
inspection template-preview (responseType "date" has NO live run form).

### Schema decisions to settle
- Bimodal storage: 27 business dates are text ISO, but `meetings.meetingDate` (committees.ts:162)
  and `actionTasks.dueDate` (shared.ts:116) are `timestamptz` → lossy `.toISOString().slice(0,10)`
  round-trips at 6 sites, re-introducing the TZ drift `parseIsoDate` exists to prevent.
- Verbatim-Hijri rule: `programs.hijriStart/hijriEnd`, `calendarEvents.hijriFrom/hijriTo/
  gregorianText` are official source text NEVER recomputed (incl. «يُعتمد هجرياً» with null gregFrom).
  The new picker must round-trip these without normalizing.

### Display bypasses to consolidate
5 hand-rolled Hijri `Intl` sites (app-shell:211 — the D-029 suppressHydrationWarning shell date;
admin/feedback pages; pilot; feedback-xlsx) + ~25 Gregorian-only `toLocaleDateString` sites.
**The entire building/inspections/maintenance domain has no Hijri display at all.**
Documents: all 11 generators use `${toHijriNumeric}هـ (${toGregorianNumeric}م)` except
building-report.ts:69 + building-docx:47 (Gregorian-only) and building-xlsx:54 (raw ISO).
`templates/records.ts:68-71` `dateText()` hardcodes "employee" context for all doc types.

### Highest-leverage unimplemented hook
`reports/catalog.ts:10` declares ColumnType "date" and ~28 columns are tagged with it, but
`reports/page.tsx:34-48` renderCell has NO date case (falls through to raw string) — one `case
"date":` + mirror in `api/reports/export/route.ts:58-59,87` reaches every report table.

### Validation today
Nearly none: scattered `^\d{4}-\d{2}-\d{2}$` regexes (feedback pages), everything else
`z.string().optional()`; no cross-field checks (start ≤ end, session within cycle) anywhere.

## A4. Reports / templates / document generation map (brief §7–§9, §20, §22) — COMPLETE

### Generation stack
playwright chromium (PDF via `src/lib/pdf.ts:121-136` `htmlToPdf` — the ONLY renderer), docx 9.7.1
(`reports/word-export.ts` — only builder, **font "Arial"**, hard-coded org line :56), exceljs,
@fontsource/ibm-plex-sans-arabic (base64-inlined into PDFs, weights 400/700). No puppeteer/jsPDF/
docxtemplater/handlebars.

### Report centre
2 routes only (`/reports` query-string driven + `/reports/executive`). Registry
`reports/catalog.ts`: **13 categories, 54 reports** (PROGRESS says 53 — one behind), shape
{key, category, label, description, permission, columns, filters}. Loaders `reports/loaders.ts`
(1120) with LOADERS dispatch, runReportForExport caps 5000 rows. **Matrix test
`tests/unit/report-coverage.test.ts` — every route must be classified; every SectionReportsLink
must map to a real report; restructuring MUST update MATRIX.**
**All 54 reports are screen+CSV+XLSX only — NO PDF/Word path** (= biggest §7 gap). The 7 issued-PDF
documents are a SEPARATE system (program/executive/committee/assignment/minutes/perf-session/
building generators → officialPageHtml → issueDocument → htmlToPdf).

### Template system (`src/lib/templates/`, 1828 lines, 7 files)
14 doc types (schema.ts:20-35; 13 with record sources, official_letter sample-only) — release needs
~9 more added in lockstep to TEMPLATE_DOC_TYPES + DOC_TYPE_LABELS + DOC_COLUMNS + PLACEHOLDERS +
RECORD_SOURCES (guard test template-structure.test.ts enforces columns per type). 9 sections
registry; strict-zod allowlisted config (9 colors, 3 fonts, clamps, findUnsafeText); 26 placeholders;
GET-driven read-only diff; versioning with frozen history + partial unique default-per-type index.
**CRITICAL: `service.ts:87-105 resolveTemplateForIssue` has ZERO production callers** — templates
govern only /api/templates/preview; the 7 real generators hand-build HTML and never load a template.
**docType vocabulary mismatch**: generators write committee_report/executive_report/meeting_minutes/
performance_report — not in TEMPLATE_DOC_TYPES (only program_report/building_report/
committee_assignment overlap). Must reconcile before templates drive issuance.

### Document identity / header (brief §8)
Central store EXISTS: `src/lib/document-identity.ts` — 14 fields incl. principalName (default ""),
ministry/school logo file-ids, toggles; stored in `settings` key "document.identity".
**Gaps: `saveDocumentIdentity` has NO caller (no admin UI); only 1 of 7 generators uses the
identity (assignment-form) — the other 6 silently get the hard-coded fallback org block
(pdf.ts:54) and never show the principal name.** «حسين» appears NOWHERE in code (good — name must
come from settings). Hard-coded strings to eliminate: pdf.ts:54,58 («مدير المجمع»),
session-report.ts:130 sig line, word-export.ts:56 org line, integrations-actions.ts:55,
templates schema.ts:191/render.ts:239 defaults. Missing field: principalTitle.
**Assets: public/ has NO ministry logo, NO school logo, NO fonts.** TEMPLATE_FONTS advertises
Noto Naskh Arabic + Amiri which are NOT installed (silent fallback, real bug).

### Issued snapshots
`documents` table (docNumber unique — count-based generation, racy; verificationCode, htmlSnapshot
frozen, templateVersionId, pdfFileId). Immutability tested (templates.test.ts:158 core assertion;
record-preview leaves record byte-identical). Doc-number prefix from settings KHS-DOC-.
No in-app fingerprint helper (ops scripts only).

### Audit
16 generation/export audit actions + 14 template.* lifecycle actions; report.exported includes
label/format/rowcount/truncation. Export hardening: sanitizeCell (CSV formula injection), BOM,
safeFileName, MAX 5000 rows.

### Choke points (ranked)
1. `pdf.ts officialPageHtml` — header for all 7 issued PDFs.
2. `templates/render.ts:122-128` header — SECOND independent header impl; unify into one
   `renderOfficialHeader(identity, toggles)`.
3. Wire `resolveTemplateForIssue` into the 7 generators (after docType reconciliation).
4. `api/reports/export/route.ts:36` format enum csv|xlsx → +pdf|docx = all 54 reports downloadable
   in every format at one point (uniform {headers, rows} already exists); UI = 2 more anchors in
   reports/page.tsx:224-239.
5. `word-export.ts` — ministry Header section + embedded Arabic font + drop hard-coded line.
6. document-identity: add principalTitle, admin UI, wire 6 generators.
7. The 4 lockstep template registries for ~9 new doc types.
8. `catalog.ts ReportDefinition` — add docType?/formats? to join the 54-report registry with the
   template registry.
9. report-coverage MATRIX updates for any route changes.
10. Ship ministry emblem asset + install @fontsource/noto-naskh-arabic (+amiri) or trim
    TEMPLATE_FONTS.

## A5. Inspection / readiness / maintenance / building map (brief §14–§18) — COMPLETE

### Building + sketch (§14)
Viewer `building/floor-viewer.tsx`: **only sizing = `aspectRatio` at :206** (no vh/max-h anywhere —
sketch grows unbounded on desktop). Resize = container class change on the overflow-hidden div :197
(e.g. `h-[50dvh]`) + `h-full` SVG; keep controls `absolute bottom-2 end-2 z-10` :179 BELOW sticky
header z-20 (app-shell:195-198; regression #6 of v2.2.1); `viewer-view.ts` pure math untouched, but
`fitToContent` :103 fits the base aspect — with a viewport-locked container the rendered aspect ≠
drawing aspect → re-verify preserveAspectRatio/fit math. e2e building-viewer.spec reads SVG
width/height :107 + boundingBox :122 — must update.

### Room types (§17)
**NO room-type registry exists** — 4-5 divergent hardcoded lists: `geometry.ts:117` ROOM_TYPES (20),
`rooms/[id]/room-ui.tsx:7-10` (14, different), `floor-viewer.tsx:12-27` TYPE_COLORS (14),
schema comment, facilities STANDARD_FACILITIES (15). `rooms.roomType` is free text, no FK.
**Critical mismatch: system templates use «مختبر»/«مختبر حاسب» which match NO room list (rooms use
«معمل») — template↔room match is exact string equality → those templates can never match a room.**

### Inspection templates + versioning (§16-17)
Schema: `inspectionTemplates` (code family / rootId / version / roomType nullable free text /
sections jsonb / isSystem / status مسودة-معتمد-معطّل; migration 0009), `inspections`
(clientOpId idempotency, results jsonb {key,ok,note}, **templateSnapshot + templateVersion frozen
online at actions.ts:537-538**, status column DEAD — defaults «مكتمل», never written),
`inspectionSchedules` — zero code references (dead table). 10 system templates seeded (KHS-TPL-0001…10).
Versioning works: edit of used/active template → NEW row same code+rootId version+1
(template-actions.ts:114-137, tested). **Two competing activation paths** (template-actions.ts:141
transaction vs legacy actions.ts:494 one-click). Gaps: **offline sync insert
(api/sync/inspections/route.ts:82-96) does NOT set templateSnapshot/templateVersion** —
historical-integrity hole; offline payload ships flattened items only (loses sections/severity);
nothing ever READS templateSnapshot (room page shows ok/total only); `severityOnFail` +
`correctiveActionRequired` exist on template items but are never persisted into results nor consumed;
no findings/remediation entity; no route for تنفيذ الفحص (inline form on room page) / نتائج الفحص /
إجراءات المعالجة.

### Readiness (§16)
`building/readiness.ts` (37 lines): override wins; else opaque 50/30/20 blend (inspection% —
**50 if never inspected** — assets%, open issues max(0,100−25n); comment says 15/60, code 25).
No ready boolean, no critical-item concept, no explanation. Overrides: insert-only ledger with
mandatory reason + audit, but UI shows reason only (no actor/when/history/revoke).
**Reusable precedent: `src/lib/plan/readiness.ts` (225 lines) already implements the transparent
model wanted — ReadinessCheck{applicable,passed,missing}, percent over applicable, ready boolean,
statusAr, MissingItem{labelAr,href}.**

### Maintenance (§18)
Rename is ~2 strings (nav app-shell:55 «الصيانة», metadata maintenance/page:10) — H1/report/perms
already say «بلاغات الصيانة». Schema `maintenanceIssues` :195-218: code KHS-MNT-####, roomId/assetId
FKs, ownerPersonId (**no FK declared**), priority, status default مفتوح, photos jsonb, repairNote,
closedAt, verifiedBy/At. Current statuses (actions.ts:617): مفتوح/قيد الإصلاح/تم الإصلاح/مغلق ومتحقق —
free transitions, no state machine. Gaps vs the 7-status lifecycle: no مسودة/معتمد/تم الإرسال/
تحت المعالجة/لم يتم الإصلاح; no approval step/recipient/sent-at; no failure-reason; no transition
history (**precedent: program_closure_history with from/to**); no detail route (list + #anchor only);
one image at creation only; **no inspection↔maintenance link of any kind**; no document generation —
plug into existing `issueDocument()` (documents.ts:19-70 immutable snapshot + doc number +
verification code) + templates schema/structure/records registries (no maintenance doc type yet).

### Facilities list (§15)
`facilityChecklist`/`facilityRoomLinks` are FULLY self-contained — zero cross-module consumers
(not readiness/inspections/maintenance/reports/dashboard/worklist/entity-registry). Label
«قائمة المرافق المطلوبة» at facilities/page:47 (+nav «قائمة المرافق» app-shell:52). Statuses
موجود/غير موجود/غير مطلوب; linking a room auto-flips to موجود. Removal is low-risk (4 files, nav
entry, 2 tables, 1 integration test); clarification requires inventing a consumer.

### Cross-cutting
New Arabic statuses need `badgeColors` entries (ui.tsx:28-88) or render grey («جارٍ الفحص»,
«يحتاج معالجة», «غير جاهز», «معتمد», «تم الإرسال», «تحت المعالجة», «لم يتم الإصلاح» …);
status-labels unit test to update.

## A6. Finance map (brief §6) — COMPLETE

### Schema (`src/db/schema/budget.ts`)
- `financial_items` (:33-53, migration 0019): nameAr nullable, **allocated_amount nullable (null ≠ 0)**,
  color (allowlist `finance/colors.ts`), sort_order, archived_at/by, created_by. **No updated_by.**
- `budget_income` (:56-92): plan_year_id NOT NULL, source, **income_date TEXT**, amount nullable,
  financial_item_id (SET NULL), status متوقع/مستلم/ملغى. **No invoice-number column on income.**
- `budget_expenses` (:95-146): **expense_date TEXT**, category, `items` = legacy textual البند
  (excluded from live math), financial_item_id authoritative, supplier,
  **payment_reference = رقم الفاتورة**, responsible_person_id, overspend_ack_* (abolished v2.2,
  retained read-only), archived_at/by, created_by.
- `plan_budget_items` (plan.ts:370) — LEGACY import-only; actions deliberately deleted.
- Receipts via unified evidence registry (`evidence_items`+`evidence_links`, entityType
  budget_income/budget_expense); deep link `?إيراد=/?مصروف=#receipt`.

### Calculation layer — SINGLE SOURCE OF TRUTH
`src/lib/finance/calc.ts` (pure, header asserts no second path): `financialItemLines` :104-154 —
remaining = allocated − expenses (null when allocated null), spentPercent, overspent,
nearExhaustion ≥90%, operationCount (**counts null-amount rows** — watch when surfacing on cards);
`summarizeSchoolFinance` :156+ — cash = received − expenses (متوقع excluded), allocations,
expenditure all separated correctly; `overrunWarning` :234-247 (advisory only, never blocks);
`monthlyTotals` :249+. Service: `finance/service.ts:101-174` `getSchoolFinance` (derives per
request, no stored spent), `spentOnItem` :180-191.
**Legacy parallel path** `src/lib/budget/{calc,service}.ts` compiled but only test-reachable
(`tests/integration/budget.test.ts`) — extend `finance/calc.ts` ONLY.

### UI (`/budget` = only finance page)
10 Stat summary cards :165-195 (some deep-link to reports); 2 HARD-CODED named cards
المستلزمات/النشاط :199-227 (not clickable); «بنود الصرف» table :246-262 (**rows not links — no
drill-down**); income :293-305 / expense tables :318-339 (رقم الفاتورة shown :333); ReceiptCell
:355-362. Main `/dashboard` has ZERO finance content.

### Actions (`budget/actions.ts`, `finance-actions.ts`)
addIncome :89 / addExpense :172 (zod, item validation, createdBy, audit, optional invoice upload);
deleteIncome/Expense (hard delete + audit). **NO update/edit action for income or expense.**
Item CRUD/archive/restore/reorder + createDefaultFinancialItems (idempotent, never seeds
allocation). Audit coverage complete for existing mutations but `detail` (before/after jsonb)
never populated; `record_versions` never used for finance.

### Gaps vs brief §6
- Cards: عدد العمليات table-only; **آخر عملية مالية + قيمة آخر عملية missing entirely**; generic
  per-item card grid missing (only 2 hard-coded); item color loaded but never rendered.
- Drill-down: **no route** (`/budget/[itemId]` or `?بند=`); user attribution stored (created_by)
  but never joined/displayed; **no modification history** (no edit action, no updated_by, no
  record_versions); running balance not computed; income lacks invoice number; description is
  ad-hoc (notes??supplier / purpose??source).
- Dashboard: totals exist on /budget but not /dashboard; البنود الأعلى صرفاً missing; القريبة من
  النفاد only a count (no list); recent-activity slice not exposed.
- Cash/allocation/expenditure distinction: data layer correct, presentation flat (one 10-card grid).
- Tests exist for math/reconciliation (finance-calc unit 307 lines, school-finance integration 375
  lines incl. raw-SQL sum reconciliation, e2e س2ب); missing: edit, attachment replacement,
  drill-down reconciliation, running balance, historical totals.
- Engineering risks: text dates unvalidated (ordering for آخر عملية unreliable on malformed input);
  finance tables absent from cleanup-archive registry; report exports CSV/XLSX only.

## A7. Terminology / tutorials / feedback button / upload approval / dashboard map (brief §3–§5, §13, §19, §21) — COMPLETE

### «اعتماد وإقفال» → «اعتماد» (§3)
13 exact occurrences + 1 near-variant («اعتماد التشكيل وإقفاله», committee-ui:151) across 5 layers:
button labels (plan program-ui:31; perf session-ui:163 «اعتماد وإقفال التقييم النهائي»), success
message (plan/actions.ts:82), **persisted audit summary** (plan/actions.ts:79), **seeded permission
nameAr** (permissions.ts:23,33 — needs UPDATE for existing DB rows, not just seed edit),
doc comments (status-labels.ts:5,21; plan/actions.ts:61), 2 e2e selectors (workflows.spec:275,633),
unit test names (status-labels.test:5,8). Derived labels: «معتمد ومقفل»/«معتمدة ومقفلة»
(status-labels.ts:13,18 + 4 consumers + badge keys ui.tsx:32-33) — must change together or UI is
internally inconsistent. **Safe rename: three-state lifecycle owns a distinct vocabulary**
(lifecycle.ts: قيد التنفيذ/مكتمل/مغلق; action verb «إقفال» in program_closure_history; «إقفال
البرنامج نهائياً») — plus separate «إقفال» axes NOT to touch: year close (plan.close_year, «مقفل»),
committee close («مقفلة»), perf final-session lock («مقفلة»), readiness helper, plan.override.

### Workflow tutorials (§4)
**The feature does not exist.** Only `WorkflowSteps` stage strip (ui.tsx:299-330, server component,
stateless) + hard-coded «الخطوة التالية» sentences on 6 pages (plan/[id]:175, committees/[id]:89,
meetings/[mid]:93, perf cycles/[id]:91, imports/new:26, imports/[id]:64). Not collapsible, no
persistence. localStorage precedent: exactly one file (pilot/retest-checklist.tsx:38-63,
per-browser). No user-preferences column/table. Building §4 = new client Tutorial component +
persistence decision + retrofit 6 pages + add to pages with none (dashboard, budget, building,
reports, …). Panels live in server components → client-boundary split needed.

### «إرسال ملاحظة» (§19)
`feedback-dock.tsx` — floating amber pill `fixed bottom end-4 z-30 min-h-12`, mounted in
(app)/layout.tsx:34 (opposite assistant dock start-4 — symmetric pair documented in :15-16).
Panel: fixed inset-0 z-50 mobile / lg:w-[440px] sheet. Move-to-header notes: header is py-1.5 with
min-h-11 controls (≈56px) — icon-only variant needed at 390px (breaks name-based e2e selectors
form-stability:61, pilot-retest:41); panel z-50 escapes fine; `main pb-24` (app-shell:224) exists
only to clear the two docks — with AI dock deleted (Phase E) and feedback in header, restore pb-6.

### Upload approval (§5)
**No approval state exists.** `evidence_items.reviewStatus` («لم يراجع»/«مقبول»/«مرفوض») is
non-blocking review, reset on replacement (evidence/actions.ts:338-339 — would wipe an acceptance
marker). `stored_files` has NO approval column. **19 upload paths, ALL through
`saveUploadedFile` (storage.ts:128-161)** — the single chokepoint (validation: size/MIME/extension/
magic-bytes; 0600 files; sha256; file-before-DB). 13 of 19 paths never create evidence_items → the
acceptance state belongs on `stored_files`. **Role not available server-side**: CurrentUser
(session.ts:69-77) has permissions only; getCurrentUser reads userRoles :115-117 then discards —
expose roleKeys (principal role key = "principal", seeded permissions.ts:84-88). `audit()` shape
already fits «قبول تلقائي بواسطة المدير»/«اعتماد يدوي بواسطة المدير» but saveUploadedFile emits
zero audit rows today (callers audit ad-hoc; 4 audit the parent only). storage.ts is server-only
with no session access — thread actor/role context in as an option.

### Dashboard (§13)
`dashboard/page.tsx` (228) «مركز عمل مدير المدرسة»: strategic-decisions card, «ما يحتاج إجراء الآن»
(urgent union, deduped by href), 6 capped-at-8 work sections, «نظرة سريعة» 4 raw counts.
**Drill-down already strong** (every row/tile a Link with record anchors). Gaps: only 4 true
metrics (no finance/KPI/inspection/readiness/budget); no charts; section headers not clickable
(moreHref only past cap); totalPending computed then discarded; `urgent` = hard-coded boolean in
7 worklist.ts sites (no age/severity weighting); no per-user layout state; getWorkCenter = 9
queries in Promise.all + 5 more on page (all force-dynamic).

### Shell / scrolling (§21)
Sticky header app-shell:195-221 (`sticky top-0 z-20`, ≈56px implicit). Z-ladder: header 20 → docks
30 → nav backdrop 40 → sidebar/panels 50 → PWA banner 60; `.mobile-action-bar` sticky bottom z-10.
Root scroll only (main has no overflow — sticky works); nested scrollers all intentional (sidebar,
Table overflow-x-auto, dock panels, 2 assistant panes [deleted in Phase E]). Body-scroll locks
imperative in 3 places.
