# سجل القرارات التقنية — Technical Decisions Log

> Language note: this file is technical documentation, so English is permitted per the master prompt.

## D-001 — Repository root
The repository root is the project directory itself. Original reference files stay in `reference_files/` which is **git-ignored** (school data must never enter Git). Derived runtime data lives in `local_data/` (also ignored).

## D-002 — Stack selection (pinned)
| Concern | Choice | Version | Rationale |
|---|---|---|---|
| Framework | Next.js (App Router) | 16.2.10 | Current stable; RSC + server actions suit a modular monolith |
| Language | TypeScript | 5.9.3 | TS 7.x (Go compiler) just shipped; 5.9 is the proven line for Next 16 |
| Runtime | Node.js | ≥20.9 (dev machine: 24.16) | |
| DB | PostgreSQL | 16 (Docker, host port **5544**) | Port 5432 already occupied by another project's container on this Mac |
| ORM | Drizzle ORM + drizzle-kit | 0.45.2 / 0.31.10 | SQL-first, light on 8 GB RAM, transactional SQL migrations |
| Validation | Zod | 4.4.3 | |
| CSS | Tailwind CSS | 4.3.2 | Logical properties give real RTL support |
| Auth | Custom DB-backed sessions + `@node-rs/argon2` | 2.0.2 | No suitable maintained session lib for Next 16; hand-rolled is auditable. Argon2id hashing |
| 2FA | otplib (TOTP) + recovery codes | 13.4.1 | Optional per master prompt |
| 2D plan | Konva / react-konva | 10.3.0 / 19.2.5 | Canvas editing with two-way dimension binding |
| 3D overview | three.js | 0.185.1 | Simple isometric view from same geometry |
| XLSX | exceljs | 4.4.0 | Parse (imports) + generate (exports) |
| DOCX export | docx | 9.7.1 | |
| PDF | Playwright Chromium rendering controlled HTML | 1.61.1 | Only reliable server-side Arabic/RTL shaping; Chromium reused by e2e tests |
| QR | qrcode | 1.5.4 | |
| Hijri | `Intl.DateTimeFormat` with `islamic-umalqura` calendar | built-in | Umm al-Qura compatible, no dependency; official Hijri text from the Ministry calendar is stored verbatim and never recomputed |
| Tests | Vitest (unit/integration) + Playwright (e2e) | 4.1.10 / 1.61.1 | |
| Offline | PWA (manifest + service worker) + IndexedDB queue | hand-rolled | Serwist/next-pwa churn vs Next 16; a small custom SW is auditable and scoped to inspections only |

## D-003 — App port
Dev/prod app port **3080** (3000 commonly taken on this machine).

## D-004 — File storage
`StorageProvider` abstraction with a `LocalStorageProvider` writing under `storage/` (outside `public/`, git-ignored, served only through authenticated, authorized, path-safe API routes). Interface is S3-compatible-ready for later.

## D-005 — Signature & stamp
Imported at seed time from `reference_files/` into `storage/private/branding/` (never Git). Per mapping: `WhatsApp Image 2026-07-15 at 9.23.26 PM.jpeg` = principal signature, `...9.23.25 PM.jpeg` = school stamp. Use is permission-gated and audited. No application-level encryption in first release (approved decision; Tailscale + FS permissions + auth).

## D-006 — Missing reference files (recorded blocker, work continues)
Three files named in the master prompt are **absent** from `reference_files/`:
1. `نماذج تقيم اداء شاغلي الوظائف التعليمية1.pdf` — the 8 official performance models. Official indicator names/weights **must not be invented**, so Phase 3 ships the full model infrastructure (models, indicators, weights, cycles, sessions, scoring) plus the flexible form designer, with the 8 official models left as **pending official content** to be entered/verified visually when the file arrives.
2. `الدليل الارشادي لادارة الاداء الوظيفي.pdf` — guidance only; no invented policy content.
3. `بيانات الموظفين في فارس.xlsx` — the 52-employee source. The full safe-import pipeline is built and tested with **synthetic fixtures**; the real file can be imported through the UI when available.
Also absent: `Pasted markdown.md` (workflow reference only — ignorable by instruction).

## D-007 — Operational plan source of truth
`الخطة_التشغيلية_المتكاملة_...xlsx` is the import source (it is a superset: 26 programs + execution details + deliverables/evidence sheets). The other three plan workbooks are earlier revisions kept for reference only. Official values (including program end date 5/1/1449هـ and Hijri date strings) are stored verbatim.

## D-008 — Dates
Business dates stored as Gregorian ISO (`date`/`timestamptz`). Official Hijri strings from source files stored verbatim alongside. Display: teacher contexts Hijri-first, employee contexts Gregorian-first, both always shown. Calendar snapshots are frozen per cycle (JSONB copy at cycle creation).

## D-009 — Extra reference files not in the prompt's mapping
`الخطة_التشغيلية_الرسمية_...xlsx`, `الخطة_التشغيلية_لمجمع_..._مرتبطة_بالتقويم_...xlsx`, `تحليل_وخطة_...xlsx`, `الخطة_التشغيلية_لمجمع_...docx`, `تقرير_التحليل_والخطة_...docx` — earlier revisions/exports of the same plan; reference only (see D-007). `WhatsApp Image 2026-07-11 at 9.23.33 PM.jpeg` is unmapped; treated as sensitive, not used until identified by the principal.

## D-010 — RBAC design
Permission-based RBAC: `roles` ⇄ `permissions` via `role_permissions`, users get roles. All checks are permission-keyed (e.g. `performance.individual.read`), never role-name-keyed, so future roles (teacher/coordinator) can be added without code changes. Individual performance data requires an explicit permission granted only to the principal role by default.

## D-011 — Import framework
Generic `import_batches` + `import_rows` tables. Every import: upload → parse (no business writes) → preview → validate → correct → explicit approve → transactional commit → error log kept → whole-batch rollback when safe (tracked via `import_batch_id` on created rows).

## D-012 — PDF engine and Chromium
PDF service launches Playwright Chromium with `--font-render-hinting=none`, A4, embedded local Arabic fonts (IBM Plex Sans Arabic, bundled as static assets under version-controlled `src/assets/fonts/` — open SIL license). No network fetch at render time.

## D-013 — Sysadmin excluded from individual performance data
The `sysadmin` role is deliberately **not** granted `performance.individual.read` (see `src/db/seed-data/permissions.ts`): individual performance details remain principal-only per the master requirements. (Entry added retroactively 2026-07-16 — the code referenced D-013 since Phase 3 but the entry was missing from this log.)

## D-014 — Real-data validation pass (delivered source files; supersedes the D-006 blocker)
All three files listed in D-006 were delivered on 2026-07-16 and processed. Full verification log: `docs/PERFORMANCE_MODEL_VALIDATION.md`.

1. **Official models entered.** The 8 in-school models from `نماذج تقيم اداء شاغلي الوظائف التعليمية1.pdf` (الإصدار الأول, printed pp.4–11) were transcribed **verbatim after page-by-page visual inspection** (Arabic text extraction is corrupted; digits cross-checked as a second signal) into `src/db/seed-data/performance-models-official.ts`, seeded idempotently by `seedOfficialPerfModels()` (`src/db/seed-official-models.ts`) as `official=true`, status «معتمد» — which locks normal editing; only the documented-reason reopen path remains. Every model totals exactly 100% (guarded at seed time and at approval). The supervisory form (printed pp.12–13) is outside school scope and was not entered. Model keys align with `suggestModelKey()`; two new suggestion rules added (توجيه صحي → `health-advisor`, رياض الأطفال → `kindergarten-teacher`). Known gap: `lrc-specialist` (أمين مصادر) has **no official model** in the ministry file — the principal assigns a model manually; nothing invented.
2. **Documented cross-check discrepancy (not silently resolved).** The guide `الدليل الارشادي لادارة الاداء الوظيفي.pdf` (الإصدار الثاني) shows **15%** where the models PDF shows **5%** in exactly 3 cells (رياض الأطفال «تهيئ بيئة تعلمية آمنة…», وكيل «ينفذ إجراءات علمية…», مدير «ينفذ إجراءات علمية…»). With 15% those guide tables would total **110%** — arithmetically impossible for evaluation weights — while all models-PDF tables total exactly 100%. **Adopted: the models PDF values.** The principal should compare these 3 cells against نظام فارس at the first real cycle and, if Fares differs, correct via the documented reopen path.
3. **Fares employees: preview only.** `npm run fares:preview` (`scripts/fares-preview.ts`) mirrors the `/imports` upload path: 52 rows parsed, sensitive columns (الهوية الوطنية، تاريخ الميلاد، رقم الجوال، هوية المدير المباشر) detected and **never stored**, classification suggested (42 معلم / 10 موظف — the 10 flagged «يحتاج مراجعة»), batch left in «معاينة». **Commit/approval remains a manual principal action.** Detailed per-row review written outside Git (`storage/private/fares-import-preview.md`). No employee data, fixtures, or names committed to Git.
4. **Teacher-return date revalidated.** Seeded anchor `teacher_return` = «عودة المعلمين الممارسين للتدريس، الأحد، 1448/3/10 = 2026/8/23» matches row 6 of sheet «التقويم الدراسي الرسمي 1448/1449هـ» in both official workbooks (الرسمية and المتكاملة), and 2026-08-23 is a Sunday. The derived «مرتبطة بالتقويم» workbook uses different prep dates (عودة المعلمين والمعلمات 1448/3/3) — a planning-map variance, not adopted.
5. **Pinned by tests.** `tests/integration/official-models.test.ts`: 8 models, verbatim names, full weight sequences + order, 100% totals, edit-lock, principal-model self-evaluation rejection, and real-Fares-file checks (52 rows, minimization, pre-approval editability — auto-skip when the gitignored file is absent).

## D-015 — Mobile remediation (corrective release, 2026-07-16)
Root cause of the broken iPhone UI: the navigation drawer was anchored to `inset-inline-end` (the **left** edge in RTL) and "hidden" with `translate-x-full`, which pushed it *into* a 390px viewport instead of off-screen. Fixed by anchoring to the RTL start edge (right), width `min(86vw, 360px)`, full off-screen translate, dark backdrop, in-drawer close button, close on backdrop/Escape/navigation, body scroll-lock, and iPhone safe-area padding. Global mobile rules: `viewport-fit=cover`, ≥16px font inside form controls below 1024px (Safari anti-zoom), ≥44px touch targets on mobile (`min-h-11 lg:min-h-0` pattern). Wide tables intentionally keep **contained** horizontal scroll inside their own container (explicitly allowed by the corrective spec) rather than a lossy card conversion of every register; card layouts are used where lists are simple. No global `overflow-x: hidden` fake fix — every route was measured element-by-element at 390/393/430/360px widths (`scripts/mobile-audit.mjs`) and pinned by `tests/e2e/mobile.spec.ts` running real WebKit.
The digital-twin read view moved from a fixed-pixel SVG to `FloorViewer`: fits the screen width, pinch-zoom (two fingers), pan when zoomed, +/−/reset controls, tappable rooms — `touch-action: pan-y` until zoomed so the map never hijacks page scrolling. Precise polygon/wall editing remains desktop/tablet (Konva editor unchanged). Simple room fields (name, type, length, width, capacity, notes) are editable from the room page with recomputed area/perimeter; a maintenance report with camera capture is available on the room page itself.

## D-016 — GenAI assistant architecture «مساعد المدير الذكي» (corrective release, 2026-07-16)
- **Providers.** Ollama (default) and AnythingLLM are local; Claude API is an optional external provider hard-gated behind an explicit recorded consent flag (`allowExternal`) — without it the provider refuses to construct. Enable/disable, provider, base URLs, model, timeout, response limit and retention are managed **from the UI** (`/admin/settings/ai`, permission `ai.manage`) and stored in the `settings` table; secrets (API keys) live only in env outside Git and only their presence is displayed.
- **Action layer.** The model never gets DB or raw execution access. It emits JSON (`tool_call` / `answer`) validated with zod against an application-controlled typed tool registry; free-form model output is never executed (a non-JSON reply is treated as a final answer, not an action). This structured-action protocol was chosen over native tool calling so any local model works; AnythingLLM is deliberately knowledge-only (document retrieval) and never an application-action executor.
- **Tools.** Read-only tools (search across 10 entities, overdue programs/tasks, missing evidence, upcoming performance sessions — no grades exposed, rooms needing inspection, open maintenance, dashboard explainer) execute immediately **under the current user's permissions**, rechecked inside every tool. Write tools (save_draft, create_task, create_maintenance_issue, create_email_draft) always produce an itemized preview proposal requiring explicit confirmation; permissions are rechecked at execution time; a guarded status transition («بانتظار التأكيد» → «منفذ») plus a unique idempotency key make duplicate confirmation a no-op. Drafts land in a review inbox (`/assistant/drafts`) and the principal transfers them to official records manually. Email drafting uses the existing M365 draft integration (never sends) with a mailto fallback.
- **Hard exclusions.** No approve/lock/sign/stamp/score/model-weight/import-commit/delete/final-send/user-management/raw-SQL tools exist; `tests/integration/ai.test.ts` pins the registry to an explicit allowlist so any new tool must be consciously reviewed there.
- **Audit & retention.** Prompt, provider, model, proposal, confirmation, execution, result, settings changes, connection tests and history deletion are all written to the audit log (`ai.*` actions). Conversations are per-user, deletable individually or wholesale, and auto-pruned by a configurable retention policy.
- **Ollama latency.** `think: false` is sent to Ollama (qwen3 family) — measured answer time dropped from ~158s to ~4s on the Mac mini for a tool-using question.

## D-017 — Tailscale HTTPS is mandatory (corrective release, 2026-07-16)
iPhone Safari requires a secure context for camera capture, service worker, offline mode and installed-PWA behavior, so `tailscale serve` (tailnet-only reverse proxy to :3080) is now a mandatory deployment step on both macOS and Ubuntu; **Funnel is forbidden** (no public exposure). The session cookie is `Secure` whenever the request arrives via HTTPS (`x-forwarded-proto`) and always in production. Server actions behind the proxy are allowed via `TRUSTED_ORIGINS` env (default `*.ts.net`) — no machine hostname is hardcoded anywhere; room/asset QR codes derive from the request host for the same reason. One-time tailnet HTTPS-certificates enablement is an operator action in the Tailscale admin console (documented in RUNBOOK.md).

## D-018 — Gate C5 DEFERRED_BY_PRODUCT_OWNER; priority shifted to workflow/process quality (2026-07-16)
The product owner explicitly deferred gate C5 (real-origin Tailscale HTTPS: camera capture, service worker/offline, installed PWA). Status recorded as **DEFERRED_BY_PRODUCT_OWNER — outside the current workflow-validation scope**. It is **not** marked passed; the existing Tailscale **HTTP** access remains in use. All certificate/HTTPS/Tailscale-Serve/PWA/camera/offline work is stopped until the owner re-opens it. Consequences:
- Camera-dependent steps (room QR scan, in-room photo capture) must never block a workflow: manual room/QR-code entry and normal file upload are the supported paths under HTTP.
- `v1.0.0-pilot` is **not** tagged until the workflow acceptance (see below) is completed — the tag no longer waits on C5.
- Current priority: principal-centered workflow audit and remediation («مركز عمل مدير المدرسة» + end-to-end scenario validation of imports, plan, committees, performance, digital twin, in-workflow AI), with scenario Playwright tests on desktop and 390×844.

## D-019 — Employee type labelling under scope v2 (OPEN — 2026-07-23)
The approved product scope v2 names the two employee types **«معلم»** and **«موظف إداري»**. The
`people.category` column stores `معلم` / `موظف`, and those stored tokens are what the *uncommitted*
Fares preview batch classification (42 معلم / 10 موظف) is expressed in. Rewriting stored values
would modify a protected preview batch, which the agent must not touch.
**Recommendation (not yet approved):** additive nullable `people.employee_type` column defaulted
from `category`, plus a display-layer relabel `موظف` → `موظف إداري`. Fares preview rows untouched.
Awaiting the principal's confirmation.

## D-020 — Activity progress model under scope v2 (OPEN — 2026-07-23)
Scope v2 introduces «الأنشطة» between البرنامج and المخرجات. Program progress is currently computed
from weighted `program_milestones` (`src/lib/plan/progress.ts`; 64 milestone rows exist under the
official year). It is not specified whether activities become the weighted progress unit (absorbing
or replacing milestones) or coexist alongside them. This determines whether migration 0010 stays
purely additive or requires a milestone data-migration path.
**Blocked on:** the truncated portion of the scope prompt (section 3 rules onward). No schema change
made until resolved.

## D-021 — Scope v2 prompt received truncated (2026-07-23)
The product-scope-refinement prompt terminates inside section 3's code fence, immediately after the
approved hierarchy diagram. Sections 1, 2 and the section-3 hierarchy are analyzed in
`docs/SCOPE_IMPACT_V2.md`. Section 3's rules and all subsequent sections (implied by section 2's
references to KPI cycles, budget expenses, committees, meetings, rooms and assets) were not received.
Work stopped at the analysis gate rather than guessing the missing workflow requirements.

## D-020 — RESOLVED 2026-07-23: activities are the canonical, sole weighted progress unit
The product owner locked the decision. `program_activities` absorbs `program_milestones`
functionally; `program_milestones` survives physically as a **read-only rollback source only**.

- Users see and manage activities only. New application code reads/writes activities only.
- Only `program_activities` contributes to program execution progress. No double counting.
- Every legacy milestone is backfilled into exactly one activity, carrying a unique traceable
  legacy reference (`program_activities.migrated_from_milestone_id`, UNIQUE, nullable).
- `program_milestones` is never dropped, rewritten, truncated, or destructively transformed in
  this engagement. Physical removal is a later, separately approved cleanup migration, only after
  production verification and principal acceptance.
- The migration therefore stays additive.

**Migration 0010 carries no D-020 conflict.** It touches only `evidence_versions`,
`evidence_items.version/archived_*` and `people.employee_type` — nothing in the plan module.
It is applied to `madrasa_test` and is treated as immutable. The activity model goes into a
new forward migration, **0011**.

## D-022 — Legacy milestone baseline is 129, not 64 (2026-07-23)
The scope states an expected baseline of **64** `program_milestones` and requires a stop-and-report
if the live count differs. Observed on 2026-07-23:

| Database | `program_milestones` | Migration state |
|---|---|---|
| `madrasa` (production) | **129** | 0000–0009 (0010 NOT applied) |
| `madrasa` (local dev) | 194 | 0000–0007 (behind) |
| `madrasa_test` | 1 residual (truncated per run) | 0000–0010 |

**Cause — not data corruption.** The 64 figure comes from the 2026-07-18 checkpoint, which
counted the *local dev* database at that time. Production's 129 rows were created when the
principal committed the official operational-plan batch on **2026-07-21** (26 programs). The
distribution is regular and consistent with generated plan milestones: 25 programs × 5 milestones
and 1 program × 4 milestones, every row `weight = 20`, every row `status = لم يبدأ`, `progress = 0`.

Consequences carried into the design:
1. Reconciliation asserts **the observed live count**, whatever it is, not a hardcoded 64. The
   count is captured immediately before backfill and proven equal afterwards.
2. 25 programs have milestone weights summing to exactly 100; **one program sums to 80**
   (4 × 20). Under custom weighting that total is invalid, and per the scope it must **not** be
   silently normalized — it surfaces in the readiness checklist and blocks normal completion.
   This is the designed behaviour, not a migration defect.
3. Nothing is applied to production until reconciliation passes there and the operator authorizes it.

## D-022 — APPROVED 2026-07-23: 129 is the authoritative production baseline
The product owner acknowledged and approved D-022. The authoritative production baseline is
**129 legacy `program_milestones`**, all legitimate principal-approved records that must be
preserved:
- 25 programs × 5 milestones = 125
- 1 program × 4 milestones = 4
- Total = **129**

Binding reconciliation controls (enforced by `scripts/verify-milestone-baseline.ts` and the
deployment plan):
1. 129 recorded as the approved baseline.
2. Every captured source milestone is dynamically proven to map to exactly one activity.
3. The live count is verified == 129 **immediately before backup** and **again immediately
   before migration**; a captured source-row fingerprint (sorted `program_id|weight|status|
   progress|sort_order` per milestone, hashed) must match at both points.
4. If the count or fingerprint changes, STOP and report — never silently accept a new count.

**Migration mode for the backfill (corrected):**
- The legacy `weight=20` values are preserved on each activity **for traceability only**.
- The backfill does **not** infer custom weighting from those values. Programs keep the default
  **equal mode** (`weighting_mode = "متساوٍ"`). Equal mode gives the four/five active
  activities equal effective weight and is always valid.
- Custom mode is never auto-activated. If a user later selects custom mode, the total must equal
  100 exactly; the four-activity program (Σ=80) then blocks normal completion and is never
  silently normalized.

**Production deployment authorization:** NOT granted. No production-write attempts via Docker,
psql, or any other path. Permission denial is not the deployment safety control — the gate is
the completed scope + recovery evidence + an explicit owner authorization.

## D-023 — Production rollback strategy (corrected) 2026-07-23
Supersedes the rollback note in the earlier scope-impact doc.
- **Preferred production rollback is APPLICATION rollback** — redeploy the previous app image
  while leaving the additive schema (0010/0011 tables and columns) intact. The additive schema
  is inert to older code because Drizzle emits explicit column lists (never `SELECT *`).
- Dropping the four new tables and twelve new columns is permitted **only** before they contain
  any production-created data, **or** after that data has been safely exported and its
  restoration verified.
- Rollback must **never** destroy newly created KPI, committee, report, activity, or related
  records.
- "Clean production" means production carrying its retained legitimate pilot data (54 people,
  26 programs, 129 milestones, …) — **not** an empty database. Never reset, reseed, delete, or
  replace that data.

## D-024 — Activities & closure-readiness removed from the app layer (2026-07-25) — SUPERSEDES D-020
Principal feedback (Scope v2.1) reverses the activities-canonical model. The operational program is
now the execution and follow-up unit; the intermediate «الأنشطة» level and «جاهزية الإقفال»
(closure readiness) are **removed from the user-facing software**.
- Removed at the app layer: the activities list inside programs; add/edit/reorder/weight/complete
  activity workflows; activity-weight calculations and weighting mode; readiness percentage +
  missing-requirements checklist; activity-based completion blocking and the principal-only
  override workflow (`plan.override`); activity/readiness sections in program reports, dashboards,
  imports, and `/pilot`. Plan imports **stop creating** `program_activities`.
- **Program status/progress is maintained directly on the program** (`programs.progress`,
  `programs.executionStatus` — existing columns; `progress` was previously overwritten by
  `recomputeProgramProgress()` from activities and becomes directly editable). **Not** recreated
  under another name.
- **Data preserved, unchanged.** The 129 migrated `program_activities` (and `activity_deliverables`,
  `activity_evidence_requirements`, `activity_state_history`) and the 129 legacy
  `program_milestones` are **not deleted, rewritten, or destructively transformed**. They are
  deprecated at the application layer only — no write path, no read into current progress/reports/
  alerts/follow-up — and retained for audit, traceability, and rollback. Program completion/override
  columns are retained (nullable, additive) and unused going forward. **No destructive migration is
  authorized.**
- D-020's canonical-activity rule is superseded at the product-workflow level; the physical
  read-only-rollback status of `program_milestones` from D-020 still holds and is extended to
  `program_activities`.

## D-025 — Program evidence is informational, never a target/quota/blocker (2026-07-25)
Evidence has **no predetermined required quantity**. A program may legitimately have zero, one, or
many evidence records.
- **Removed:** every target/limit/quota/percentage/"remaining evidence" count; "N of M uploaded";
  "X remaining"; evidence-readiness percentage; missing evidence as a completion blocker; any
  mandatory evidence count by program or evidence type. Concretely retires `computePackageReadiness`
  (deliverable "package readiness" %), the `checkRequiredEvidence` count-vs-`minCount` check, the
  worklist `evidenceGaps` + dashboard «تنبيهات نقص الشواهد», and the AI required/missing-evidence
  framing. `activity_evidence_requirements.minCount/required` columns are retained but carry no quota
  semantics.
- **Weekly follow-up reports the actual current condition** and nothing more: `0 → «لم يتم رفع أي
  شاهد حتى الآن»`, `1 → «تم رفع شاهد واحد»`, `2 → «تم رفع شاهدان»`, `3–10 → «تم رفع N شواهد»`,
  `≥11 → «تم رفع N شاهداً»` (correct Arabic count wording), with the latest evidence upload date and
  a link to open the program's evidence.
- Evidence count is informational and **must not** determine whether a program can be completed.
- **Scope boundary:** this concerns operational-plan *program* evidence. The performance module's
  per-indicator "required evidence" completion gate is a separate ministry-aligned control and is
  **left unchanged** pending an explicit separate instruction (see `docs/SCOPE_IMPACT_V2_1.md` §12).

## D-026 — Budget wording «البند» + optional receipt upload (2026-07-25)
- Income field label «الغرض/التخصيص» → **«البند»**; expense field label «المستلزمات/البنود» →
  **«البند»**. Applied consistently across forms, tables, filters, validation text, reports, exports,
  and empty states. The expense «البند» value is now shown in the table (previously collected but
  hidden).
- Every income and expense record gets a **receipt upload** capability: direct file upload **and**
  linking an existing shared evidence/file record (reusing the shared evidence pipeline —
  `createEvidenceAction` / `linkEvidenceAction` / `EvidencePanel` / `/api/files` /
  `replaceEvidenceContentAction`). Receipts show on record details + relevant reports; download/open
  + safe replacement with version history.
- The receipt is **not mandatory by default** (only if separately configured). No duplicate upload
  when the same document already exists in shared evidence. The prior red «ناقص» / «مصروفات بلا
  إيصال» framing becomes neutral/informational, not a deficiency or blocker.

## D-027 — Committee signatures per document type + predefined task templates (2026-07-25)
- **Signatures are not globally mandatory.** The de-facto global rule (the hard gate in
  `completeMeetingAction` requiring a signed minutes file for *every* meeting, plus the
  close-committee gate and hardcoded report text) is made **document-type-dependent** via an additive
  `requiresSignature` attribute (default false); most documents (minutes, results, impact, general
  reports) no longer force a signature unless their type is configured to require it.
- The committee **assignment / task-distribution table** carries a signature column and columns
  المهمة / العضو المكلف / الصفة-الدور / توقيع العضو / ملاحظات, shown in the printable form.
- **Predefined tasks per committee/council/learning-community type:** select type → load predefined
  standard tasks → review → add/edit/exclude/reorder → assign to members → generate the distribution
  table with signature fields → preserve the issued document as a historical snapshot. Templates are
  centrally manageable and reusable; editing a template later does **not** rewrite previously issued
  assignments/reports (enforced by the existing `issueDocument` + `htmlSnapshot` freeze). Committee
  tasks are valid and remain — **separate** from the removed operational-plan activities (D-024).

## D-028 — KPI planning session «جلسة التخطيط» excluded from evaluation calculations (2026-07-25)
The first session («جلسة التخطيط», `session_type = "تخطيط"`) is planning only and must never be
treated as an evaluation score.
- It stays **mandatory and visible**, keeping its targets, planning info, comments, evidence, and
  signed-report workflow.
- Its scores/zero values are **excluded** from all KPI averages, trends, performance percentages,
  summaries, rankings, dashboards, and final results. The exclusion lives at the single cross-session
  rollup (`cycleProgress`, `src/lib/performance/scoring.ts`). Per-session `sessionResult` is preserved.
- Planning zeros are never interpreted as poor performance. If only the planning session exists, the
  UI shows «لم يبدأ التقييم بعد» / «لا توجد نتائج تقييمية حتى الآن», not 0%. Mid-cycle and final
  calculations remain valid after excluding planning (final already uses only the `"نهائي"` session).
- Proven by a test: changing a planning session's score values cannot change any calculated KPI result.

## D-029 — Cross-application `insertBefore` DOM crash: class-level fix + probable root cause (2026-07-25, updated 2026-07-26)
**Probable (leading) root cause** of `Failed to execute 'insertBefore' on 'Node'` reported across many
buttons, forms, and uploads: React reconciling over a DOM mutated **outside React**, primarily by
**browser auto-translation** of the 100%-Arabic app (no `translate="no"` guard) interacting with the
pervasive `text {cond && <el/>}` JSX idiom; secondarily by password-manager/form-filler injection into
unguarded inputs; amplified by an unguarded `islamic-umalqura` `new Date()` hydration in the app shell.
**Status: PROBABLE, not yet conclusively proven.** The class-level fix is applied and the app is stable
in automated real-browser tests, but the root cause is labeled **probable** until verified under the
principal's actual conditions (clean Chrome/Edge no-extensions; translation on / DOM-mutation simulation;
the principal's normal profile + password manager; repeated clicks / dialog cancel / upload / save /
navigation while pending). The principal's browser retest is the acceptance gate and may remain
post-deployment. Secure client-side diagnostics (`src/components/error-diagnostics.tsx`) classify any
occurrence into browser-translation / password-manager-injection / hydration-mismatch / dialog-portal /
duplicate-submission and log it technically (never shown to the user), so a real occurrence is captured
with evidence to confirm or refine the root cause.
- Fixed at the **class level, not per page**: add `translate="no"` + `<meta name="google"
  content="notranslate">` to the root document, `global-error.tsx`, and PDF/print HTML; harden shared
  primitives (`SubmitButton`, `Field`/`Select`/`TextArea`, `Labeled`) so bare text is never a direct
  sibling of a conditional, and add `autoComplete`/`data-1p-ignore`/`data-lpignore` on inputs; stabilize
  the shell Hijri-date hydration.
- Duplicate submission is prevented (shared `SubmitButton` disables on `pending`); pending/success/error
  states are stable; the raw English DOM exception is never shown — a clear Arabic recovery message is
  displayed while the technical error is logged securely. Real-browser regression tests cover
  representative buttons, dialogs, saves, uploads, cancellations, and repeated clicks (desktop + mobile
  RTL). Ruled out (with evidence): service worker/PwaManager, portals/toasts (none exist), and
  three.js/off-DOM manual mutations.

## D-030 — Meeting attendance is NOT APPLICABLE; SWOT gains a real data model (2026-07-29)

Two report-coverage questions raised in the v2.2 final gap-closure round, answered from the
schema and the source files rather than from assumption.

**Meeting attendance — NOT APPLICABLE (no report, and no button that opens one).**
There is no attendance model anywhere in the platform, and its absence is a deliberate product
decision recorded in the schema and the UI long before this round:
- `committee_members` — «تسجيل عند التشكيل فقط، لا حضور ولا غياب»
- `meeting_attachments` — «(ليست حضوراً — لا حضور ولا غياب ولا نصاب.)»
- `/committees/[id]` — «تسجل العضوية عند التشكيل فقط — لا حضور ولا غياب ولا نصاب»
- `/committees/[id]/report` — «لا حضور ولا غياب ولا نصاب»

Verified empirically against **production**: no table and no column whose name matches
`attend` / `present` / `absent` / `quorum` exists. Membership is time-scoped
(`effectiveFrom`/`effectiveTo`) and is a formation record, not a per-meeting presence record.

Therefore no attendance report is created. Fabricating one would mean either an always-empty
screen or inventing presence data the school never recorded. The meetings category continues to
report what genuinely exists: meetings, decisions and recommendations. A guard test asserts that
no report in the registry is named or labelled after attendance, so the classification cannot
drift back silently. Should the principal later ask to record attendance, that is a new data
model (an additive `meeting_attendance` table plus its UI), not a reporting change.

**SWOT — IMPLEMENTED on the authoritative source (supersedes «no SWOT data model»).**
The earlier statement that «no SWOT data model exists» was accurate about the database but
incomplete about the source of truth. The official operational-plan workbook that production
actually imported — `الخطة_التشغيلية_المتكاملة_لمجمع_الخشعة_1448_1449.xlsx`, batch «منفذة» —
contains a populated sheet «التحليل الرباعي» (named «SWOT» in the analysis-only variant of the
workbook) holding the school's real four-quadrant analysis: نوع، رمز، عنصر، الدلالة الاستراتيجية.
The platform's plan importer simply never read that sheet, so the data existed officially but not
in the database.

Resolution: the sheet is now imported into a dedicated `plan_swot_items` table (migration 0021,
additive), exactly as the risk register and the KPI sheet already are; values are stored verbatim
per the source-fidelity rule. `/plan/swot` displays them grouped by type and deep-links to the
report centre. Two reports were added under the «المخاطر والتحليل الرباعي» category:
«سجل التحليل الرباعي» and «التحليل الرباعي حسب النوع».

Import semantics: `(planYearId, code)` is unique, so re-importing the same workbook cannot create
duplicates; a conflicting row is left untouched (`onConflictDoNothing`) rather than silently
rewritten, because the text is official. A pre-existing row is **not** attributed to the later
batch, so rolling that batch back never deletes an item an earlier batch created.

**Production impact of D-030: none until the principal re-imports.** The table ships empty; the
26 already-imported programs and every other row are untouched. The section shows an explicit
Arabic empty state naming the import as the way to populate it — no broken button, no empty report
presented as a finding.

## D-031 — SWOT arrives through a controlled single-sheet import, not a full-workbook re-import (2026-07-29)

Rehearsed on a fresh production clone at migration 22 with the real official workbook.

**Finding.** Re-importing `الخطة_التشغيلية_المتكاملة_لمجمع_الخشعة_1448_1449.xlsx` in full against the
existing plan year **fails** — `programs_year_seq_unique` rejects the 26 programs, the whole commit
transaction aborts, and the batch stays in «معاينة». The clone was bit-for-bit unchanged afterwards
(programs 26 · KPIs 15 · risks 9 · deliverables 26 · budget 2 · documents 31 · issued-snapshot
fingerprint `c9383e4b…`). So the full-workbook path is **safe but unusable**: it can never deliver
the SWOT sheet to a plan year that already holds programs.

**Decision.** A dedicated import type **`plan_swot` — «استيراد التحليل الرباعي»** is the only
supported way to populate `plan_swot_items` on an existing plan year. It is constrained by
construction, not by a flag:

- `parseSwotWorkbook()` reads only «التحليل الرباعي» / «SWOT» and emits rows of type `swot` only;
  a workbook without that sheet, or with no valid rows, is rejected at preview with an Arabic message.
- `commitSwotRows()` writes only `plan_swot_items`. It never creates a plan year — importing SWOT
  before the operational plan is refused («استورد الخطة التشغيلية أولاً»).
- `(planYearId, code)` is unique and conflicts are `onConflictDoNothing`, so official text is never
  silently rewritten; a pre-existing row is not attributed to the later batch, so rolling that batch
  back cannot delete rows an earlier batch created.
- `rollbackSwotBatch()` deletes only what its own batch created.

**Rehearsal evidence.** Preview 24 rows (6 قوة / 7 ضعف / 5 فرصة / 6 تهديد) → commit → 24 stored with
every other count and the issued-snapshot fingerprint unchanged. Second import: idempotent (same row
ids, no new rows, summary «عناصر موجودة مسبقاً (لم تتغيّر)»). Third import after a manual edit: the
manual text survived. Wrong workbook (the Fares employee file): rejected at preview, nothing written.
Rollback of the first batch: removed exactly its own 24 rows and nothing else.

**Operational consequence.** The principal must use «استيراد التحليل الرباعي», **not** «استيراد الخطة
التشغيلية», to populate SWOT after deployment. Rollback of a SWOT batch removes the rows that batch
created, including any manual edits made to them afterwards — the platform-wide rollback semantic.

## D-032 — v2.3.0 upload acceptance lives on `stored_files`, decided server-side from role keys (2026-07-31)

Brief §5 (docs/BRIEF_V2_3_0.md). Phase A found **no approval state anywhere**: `evidence_items.reviewStatus`
is a non-blocking review flag (and is reset on replacement), `stored_files` has no approval column, and
13 of the 19 upload paths never create an evidence row at all. All 19 paths funnel through
`saveUploadedFile` (`src/lib/storage.ts:128`), so:

- Acceptance state (`acceptance_status`, `accepted_by`, `accepted_at`, `acceptance_mode`) is added to
  **`stored_files`** — the only true chokepoint — via an additive nullable migration.
  `NULL` = legacy file, treated as accepted (production files were all uploaded in the
  principal-operated era; nothing is rewritten).
- The decision is made **inside `saveUploadedFile`** from an actor context threaded in by callers
  (`storage.ts` is server-only with no session access). It never trusts a browser value.
- "Is principal" comes from **role keys, not permission probes**: `CurrentUser` gains
  `roleKeys: Set<string>` (`getCurrentUser` already reads `user_roles` and discards them,
  `session.ts:115-117`). Role key `principal` ⇒ auto-accept.
- Audit: `saveUploadedFile` emits the acceptance audit centrally — «قبول تلقائي بواسطة المدير» on
  principal auto-accept; the manual approval action writes «اعتماد يدوي بواسطة المدير». File-security
  validation (size/MIME/extension/magic-bytes) runs unchanged before acceptance.
- Non-principal uploads become «قيد الاعتماد» and surface in a principal approval queue. Today both
  live accounts are principal/sysadmin, so the pending path ships tested but empty.

## D-033 — Dual-calendar dates: one canonical Gregorian ISO value, conversion at the edges (2026-07-31)

Brief §2. Storage stays **canonical Gregorian ISO text** (the existing 27 business-date text columns);
no second editable date is ever stored, and the entry calendar mode is not persisted (nothing
operational reads it — revisit only if the principal asks). Implementation:

- `src/lib/dates.ts` gains the inverse direction (Hijri→ISO via Umm al-Qura `Intl` probing), Hijri
  month-grid/boundary helpers, and validation; the existing verbatim-official-Hijri rule
  (`dualDisplay(officialHijri)` never recomputes source text) is preserved and stays test-enforced.
- A new client `DateField` (هجري/ميلادي selector, month names, dual display of the chosen value)
  replaces `Field type="date"` at its single definition point, covering the 11 existing picker sites;
  the 2 budget free-text date fields are upgraded to it; the 4 raw filter inputs follow.
- `meetings.meetingDate` and `actionTasks.dueDate` (the only `timestamptz` user-picked dates) keep
  their columns — the form boundary normalizes to/from ISO date strings; no schema change.
- Report tables get the missing `case "date"` in `renderCell` (+ export parity) → all ~28
  date-tagged report columns render dual-calendar at one stroke.

## D-034 — «اعتماد وإقفال» → «اعتماد» including derived labels; history is never rewritten (2026-07-31)

Brief §3. The rename is collision-free because the three-state lifecycle (D-024/v2.2.1) owns a
distinct vocabulary (قيد التنفيذ/مكتمل/مغلق، «إقفال البرنامج نهائياً») and the year/committee/
performance «إقفال» axes are untouched. Scope of the rename:

- Button labels, success messages, tutorials, and **derived status labels**: «معتمد ومقفل» →
  «معتمد», «معتمدة ومقفلة» → «معتمدة» (changing the verb without the status label would be
  internally inconsistent). Badge keys and tests updated together.
- Seeded permission display names (`plan.approve`, `performance.approve` nameAr) are updated in
  seed data **and** by a tiny data migration UPDATEing the two `permissions.name_ar` rows —
  reference labels, not user data; recorded here as the approved reason.
- **Historical audit rows and issued documents are NOT rewritten** — old summaries keep the old
  wording; only newly written summaries use «اعتماد».
- The underlying workflow (approve freezes the program package) is unchanged — verified per
  call site, per the brief's "do not change the workflow silently" rule.

## D-035 — AI removal is code-level; `ai_*` tables stay in place, dormant (2026-07-31)

Brief §12. Phase A verified: zero AI packages in package.json, and the SWOT import
(`src/lib/imports/plan.ts`) is 100% AI-free — it is preserved intact. Removal deletes ~3,100 lines
(src/lib/ai, src/app/api/ai, assistant pages/components, AI settings page) and edits 19 files.
The four `ai_*` tables and `src/db/schema/ai.ts` **remain in the schema** so drizzle never
generates a DROP (no destructive migration; existing conversation rows are preserved as inert
data). The schema file gets a dormancy comment. Env vars, compose extra_hosts, and the
`AI_ENABLED=true` in playwright.config are removed; `/api/health` (DB-only) stays.

## D-036 — Maintenance «بلاغات الصيانة» 7-status lifecycle with a mapped, rehearsed data migration (2026-07-31)

Brief §18. New vocabulary: مسودة/معتمد/تم الإرسال/تحت المعالجة/تم الإصلاح/لم يتم الإصلاح/مغلق with a
server-enforced transition map and an append-only `maintenance_status_history` (from/to/actor/at —
same pattern as `program_closure_history`). Existing rows are migrated by a fixed documented mapping:
مفتوح → معتمد، قيد الإصلاح → تحت المعالجة، تم الإصلاح → تم الإصلاح، مغلق ومتحقق → مغلق.
The mapping is recorded in the migration itself, rehearsed on a production clone with before/after
counts per status, and is reversible (the old value is derivable from the mapping + `closedAt`/
`verifiedAt` stamps, and the migration writes one history row per converted record). Closure as
«لم يتم الإصلاح» requires closure reason + follow-up recommendation + escalation flag. New fields
(approved/sent/recipient/visit/resolution) are additive nullable columns.

## D-037 — Canonical `room_types` registry; templates match rooms through it (2026-07-31)

Brief §16–17. Today there is NO room-type concept — 4–5 divergent hardcoded lists, and the
template↔room match is exact string equality, which leaves the «مختبر»/«مختبر حاسب» system templates
permanently unmatchable (rooms use «معلم»/«معمل» vocabulary). A new `room_types` table (key, Arabic
label, sort, active) is seeded from the union of the existing lists + the brief's room-type
examples; existing `rooms.room_type` free-text values are preserved verbatim and mapped to registry
keys additively (no room row rewritten). Inspection templates reference room types through the
registry; the mismatch is fixed by mapping, not by renaming production data.

## D-038 — «قائمة المرافق المطلوبة» is renamed and scoped, not removed (2026-07-31)

Brief §15 allows either. The feature is fully self-contained (zero cross-module consumers) so
removal would be clean — but it holds principal-entered data, and the brief's primary
recommendation is the rename. Adopted: title becomes «المرافق المطلوب توفيرها أو تحسينها», the page
explains the two allowed cases (غير موجود ويلزم توفيره / موجود ويحتاج تطويراً جوهرياً), and repair
issues are redirected to «بلاغات الصيانة» with an in-page link. Removal remains available to the
principal as a one-page deletion if he still finds it duplicative after retest.

## D-039 — One report engine: template-driven issuance + PDF/Word for all registry reports (2026-07-31)

Brief §7–9, §22. Phase A found the template system governs only the preview route
(`resolveTemplateForIssue` has zero production callers), 6 of 7 PDF generators bypass the central
document identity (hard-coded fallback header, principal name nowhere), and all 54 registry reports
are CSV/XLSX-only. The engine work therefore is: (1) one shared official header
(identity-driven) used by both `officialPageHtml` and the template renderer; (2) the 7 generators
resolve their template through `resolveTemplateForIssue` after reconciling the docType vocabulary;
(3) `/api/reports/export` gains `pdf|docx` formats — every registry report becomes downloadable at
one choke point; (4) the template registries are extended in lockstep to the brief's ~23 document
types (guard tests already enforce lockstep).

## D-040 — Ministry identity assets are owner-supplied through settings, never fabricated (2026-07-31)

Brief §8. The official Ministry of Education logo and the principal's name
(«حسين بن جابر أحمد الفيفي», «مدير مجمع الخشعة للبنين») are NOT hard-coded and NOT drawn by the
agent: the document-identity store (`settings` key `document.identity`) gains `principalTitle`, an
admin UI (missing today — `saveDocumentIdentity` has no caller) lets the principal enter the name/
title and upload the official logo files; generated documents read them centrally. The header
system ships with a neutral placeholder slot; the approved emblem is loaded by the owner so no
unofficial reproduction of government branding is bundled in git. Fonts: PDF keeps the embedded
IBM Plex Sans Arabic; the two advertised-but-uninstalled template fonts are either installed
locally or removed from the allowlist; Word switches from "Arial" to the same Arabic-capable font.

## D-041 — Evaluation-form lifecycle: archive by default, hard delete only when unused (2026-08-02)

v2.4 brief §6. `perf_models` gains additive `archived_at/by/reason` (migration 0027). A form
linked to any cycle is **never hard-deleted** — archive is the only path (cycles carry a frozen
`modelSnapshot`, so historical reports keep rendering). Unused forms (zero cycles) hard-delete
after explicit confirmation with a pre-delete `record_versions` snapshot; the cycles→models FK
(no action) makes the check race-safe at the DB. Official ministry forms are additionally
excluded from hard delete (their keys feed D-014 readiness checks) — archive only. Neither
archive nor delete may hide the **last active approved form of an audience** (would silently
re-open the D-014 mismatch path). Archived forms disappear from new-cycle selection and the
D-014 matching query, stay searchable under an archive filter, and are restorable. The brief's
optional privileged cascade-delete of used forms (§6-D) is deliberately NOT implemented: it is
absent from the §24 acceptance criteria and production holds real evaluation data.

## D-042 — Weekly follow-up reports the week's snapshot, never current mutable state (2026-08-02)

v2.4 brief §7. Root cause of "all programs complete": the page rendered live
`programs.execution_status` (which `completeProgramAction` sets to «مكتمل»), the form
pre-selected that sticky value, and edited old weeks outranked the current week because the
upsert reset `created_at`. Fixes keep the domain vocabulary untouched: the page/report render
the **selected ISO week's `program_followups` snapshot** (falling back to the explicit label
«لم يتم التحديث هذا الأسبوع» — absence of an update is never displayed as completion); rows
group by a truthful axis separation (weekly execution vs documented completion vs principal
closure); `created_at` is no longer rewritten on week-row edits and ordering keys on
`week_key`; an empty progress field means "keep" (the zod coerce turned "" into 0). Historical
week snapshots are immutable from the page (only the current week is writable).

## D-043 — Monetary arithmetic in integer halalas inside finance/calc (2026-08-02)

v2.4 brief §4. All sums, remainders, and running balances inside `src/lib/finance/calc.ts`
convert to integer minor units (`toMinor`/`fromMinor`) before adding/subtracting, eliminating
IEEE-754 drift (0.1+0.2). The external API stays in SAR numbers, `numeric` columns unchanged
— no migration. The item ledger gains allocation-based `remainingBefore/After` per expense
(income does not consume allocation) plus a deterministic date→createdAt→id ordering.

## D-044 — D-013 extends to issued performance documents (2026-08-02)

v2.4 brief §16. Issued PDFs of performance doc types (`performance_report`,
`employee_performance_report`, `overall_performance_report`, `final_evaluation_report`) were
downloadable with `files.download` alone and listed with names in /documents — a pre-existing
gap that the two new v2.4 reports would have widened. Now `/api/files/[id]` refuses these PDFs
without `performance.individual.read`, and /documents hides those rows for users lacking it
(sysadmin keeps documents.read but not individual performance data). The set is defined once
(`PERFORMANCE_SENSITIVE_DOC_TYPES` in the template registry).

## D-045 — Inspection→maintenance conversion: offer on save, duplicates blocked until closure (2026-08-02)

v2.4 brief §14. Saving an inspection with failing items immediately offers conversion
(create-all / review-and-pick / later); bulk conversion skips already-linked findings and
duplicates. Duplicate rule: a new complaint for the same room+item is blocked while ANY
non-«مغلق» complaint exists for that item — deliberately stricter than `isOpenIssueStatus`
(drafts also block, they are complaints-in-waiting); only closure re-opens reporting. The
official letter now carries the inspection source, safety impact from the finding's severity,
the reporter, the principal approval, and a fixed «الإجراء المطلوب» decoupled from the
contractor's `actionTaken` (previously one field served both roles). Committee task execution
state is a nullable closed list («لم تبدأ/قيد التنفيذ/منجزة», migration 0028) — NULL renders
«—», never an assumed completion.

## D-046 — `financial_items` is the sole source of truth for budget allocation; `plan_budget_items` is plan-year reference (2026-08-03)

v2.4.1 brief §4.6. The production symptom "remaining balance is invisible" traced to
`financial_items.allocated_amount IS NULL` on both live items, while `plan_budget_items`
holds 2500/2500 — inviting the assumption that the two registries should be reconciled.
They must not be. `financial_items` are **permanent, cross-year school payment areas**
managed centrally (v2.2 §B2); `plan_budget_items` are **plan-year budget lines imported
verbatim from the official operational plan** and kept for historical reference. The
architecture already names the authority: `finance/calc.ts` is "مصدر الحقيقة الوحيد" and
attributes spend by `financialItemId` alone — the legacy text «البند» column is explicitly
excluded from calculation. Confirmed by call graph: every live surface (`/budget`, item
detail, dashboard metrics, template records, report loaders) reads `getSchoolFinance`.

Therefore v2.4.1 **does not copy, merge, or infer** allocations across the registries —
doing so would fabricate a financial figure the principal never entered. Instead the UI
explains the distinction and offers an explicit, audited allocation action.

**Root cause of the false confidence:** `src/lib/budget/service.ts::getBudgetOverview` — the
pre-v2.2 computation path that reads `plan_budget_items` and matches spend by the *text*
column — has **zero application callers** but is still exercised by
`tests/integration/budget.test.ts` with seeded allocations. It therefore passed green while
the live path returned `null` remaining in production. The module is retained (its `num`
helper is still used by `program-report.ts`) but is now non-authoritative by decision, and
v2.4.1 adds allocation-state tests against the **live** `finance/calc` path
(`tests/unit/finance-allocation.test.ts`). Retiring the dead path is deferred — it is
behaviour-neutral cleanup outside a corrective release.

## D-047 — Legacy state contradictions are detected, never auto-corrected (2026-08-03)

v2.4.1 brief §5/§6. Production holds four approved programs marked «مكتمل», three of them
at `progress = 0` with no `completed_at`, plus 31 committee task assignments with
`status = NULL`. Both are legacy-data conditions that v2.4's write-path fixes (D-042,
migration 0028) correctly stopped producing but could not retroactively repair.

The platform **detects and explains; the principal decides**. `lib/plan/consistency.ts`
implements rules A–E as a pure validator and returns findings with a review prompt — it
never proposes a value, because "did اليوم الوطني actually finish?" is an operational fact
the system does not hold. The correction form deliberately ships **no preselected
«مكتمل»** (an empty "choose the correct status…" option) so a careless save cannot
reproduce the contradiction, requires a mandatory reason, snapshots the prior row to
`record_versions`, and never touches approval or closure — those keep their own audited
actions. Correcting a closed record additionally requires `plan.override`. Bulk correction
is restricted to two homogeneous operations with preview, count, explicit confirmation and
a single audit record; there is deliberately **no "fix everything" button**. No migration
guesses any business value — per §10 the 31 NULL statuses stay NULL until someone sets them.

## D-048 — Individual performance results are gated by `performance.individual.read` on every surface, reports included (2026-08-03)

v2.4.1 Phase F, §5 (reports — "unauthorized performance report access"). D-013 keeps
individual performance detail with the principal, and the seeded `sysadmin` role is
explicitly denied `performance.individual.read` (`src/db/seed-data/permissions.ts`). v2.4
closed the same hole for issued PDFs (D-044). The reports centre was still open: the
`perf-evaluations` report carries a `sessionResult` column — the numeric evaluation result
of a **named** employee — while declaring only `permission: "performance.read"`, which
`sysadmin` holds. A sysadmin could therefore read, and CSV/Excel/PDF-export, every
employee's score through the normal reports UI.

The gap was invisible to page-level review because the surface is data-driven: the catalog
entry *is* the authorization. Fixed by raising `perf-evaluations` to
`performance.individual.read`; the reports page filters the card and
`/api/reports/export` re-checks `def.permission` server-side, so hiding is not the control.
The three remaining performance reports (`perf-planning-sessions`, `perf-incomplete`,
`perf-evidence-counts`) stay on `performance.read`: they list person, stage, status and an
evidence count — operational tracking the sysadmin needs — and carry no result.

The rule is now enforced structurally rather than by inspection:
`tests/unit/discoverability.test.ts` fails any report that pairs a named person with a
result-bearing column (`sessionResult`/`resultPercent`/`score`/`finalScore`/`rating`)
unless it declares `performance.individual.read`. A future report cannot reopen this by
copying an existing definition.

## D-049 — Never invalidate the route the action was invoked from; refresh it from the client (2026-08-03)

Found during the v2.4.1 production-clone rehearsal, on the RC image against a clone of real
production data. It had passed every gate before that.

**Symptom.** Saving an expense wrote the row and showed nothing: no
«تم حفظ المصروف — المتبقي بعد العملية: …», no refreshed table. The network trace showed the
Server-Action POST ending in `net::ERR_ABORTED`. On the committee page it was worse — after
setting ONE task status the transition never settled, so every status dropdown stayed
disabled until a manual reload. With 31 statuses to enter, that is a reload per task.

**Root cause.** A Next 16 Server-Action response is a stream: the returned value first, then
the re-render payload produced by `revalidatePath`. Calling `revalidatePath(p)` for the route
the user is *currently on* makes the client router refetch that route immediately, cancelling
the still-streaming response before the client consumes the returned value. The write has
already committed server-side, so the database is right and the screen is stale.

**Proof.** Two production images differing only by the removal of `revalidatePath("/budget")`
from `addExpenseAction`: without it the message appears, with it it never does. Confirmed
identically on the **deployed v2.4.0 image** against the same clone, so this is pre-existing,
not a v2.4.1 regression.

**Why no gate caught it.** `next dev` completes the stream before the refetch lands, so all
92 Playwright tests — which assert exactly these messages — pass there. This is the same
symptom filed as «الواجهة لا تتحدث بعد الحفظ» against the v2.2.1 corrective patch and
recorded in v2.3 as "an environment quirk where the host `next start` aborts Server-Action
streams". It is not an environment quirk.

**The rule.** Every page in this platform is `dynamic = "force-dynamic"`, so revalidating it
buys no cache freshness and only buys the race.
1. An action must not `revalidatePath` the route it was invoked from. Other affected paths
   are still invalidated normally.
2. The client refreshes that route itself, **after** the result settles —
   `useRefreshOnSuccess` (`components/form-reset.ts`).
3. Inside a `useTransition`, `router.refresh()` must run once `isPending` clears, never
   within the transition callback: refreshing inside keeps `pending` raised, which is what
   left the committee dropdowns disabled.
4. Never unmount the owner of an in-flight action — no `key={state?.success}` on a `<form>`;
   clear fields with an imperative `reset()` instead, and defer any collapse until the
   transition ends.

`lib/revalidate.ts` and `components/form-reset.ts` carry the rule and the evidence at the
places a future change would touch. Remaining actions elsewhere in the app still revalidate
their own route and can show the same staleness; sweeping them is recorded as follow-up work
rather than done inside a corrective release.

## D-050 — Permanent lifecycle deletion is a separate, privileged path from safe delete (2026-08-04)

v2.4.1 final scope §1.3. The principal asked for real deletion of an employee and of a
performance cycle — "not archive-only". The platform already had `lib/safe-delete.ts`,
which answers a different question: *is this record unused, so that deleting it destroys
nothing?* That guard is correct for incidental deletes and must not be weakened, because
weakening it would silently permit cascade damage everywhere it is used.

So permanent deletion is a **second, explicitly privileged path** (`lib/lifecycle-delete.ts`)
rather than a flag on the first. It answers: *destroy this record and everything it owns,
deliberately, and prove the institution survived.*

**Owned vs shared was derived from the database, not assumed.** The FK graph was read from
`information_schema` before any code was written; six columns reference `people` and each
was classified individually:

| Relation | Decision | Why |
| --- | --- | --- |
| `perf_cycles` → sessions → ratings / signed versions / improvement plans | delete | the employee's own evaluation lifecycle |
| `person_stages` | delete | assignment of the employee, meaningless without them |
| `documents` (perf_cycle / perf_session / person) | delete | issued *about* this employee |
| `evidence_links` for those records | delete | the link, not the evidence |
| `evidence_items` with zero links remaining | delete | employee-exclusive by definition |
| `committee_members` | delete the membership row | the committee is institutional and survives |
| `programs` / `program_activities` / `action_tasks` / `maintenance_issues` / `inspection_findings` / `budget_expenses` | null the reference | institutional records; ownership is an attribute, not existence |
| `users` | deactivate + unlink + drop sessions, **never delete** | `audit_log.actor_id` and a dozen other `NO ACTION` keys point at it; deleting it either fails or forces destroying the audit trail |
| `audit_log`, `import_rows`, `record_versions` of shared entities | retain | append-only history |

`committee_task_assignments.assigned_member_id` is `ON DELETE SET NULL`, so removing a
membership leaves the committee's task in place, unassigned — which is the correct
institutional outcome and required no extra code.

**Stored files.** A file is deleted only when no reference remains anywhere — checked
against all twelve FK columns plus the two `jsonb` photo arrays that hold file ids without a
constraint. Physical removal happens **after** the transaction commits, never inside it,
because unlinking a file cannot be rolled back.

**Authorization is `people.delete` + `performance.individual.read`** (cycle deletion adds
`performance.write` + `performance.approve`). The second permission is not decoration: the
operation destroys individual evaluation content, and D-013 denies `sysadmin` the right to
*read* it. Whoever may not read it may not destroy it — so the principal is the only holder.

**The tombstone** (`deletion_tombstones`, migration 0029) is what remains: actor, safe
identifying reference, timestamp, reason and per-type counts. It deliberately stores **no
evaluation content** — a test serialises the row and asserts the seeded sensitive strings
are absent. Permanent deletion is irreversible except by restoring a full backup; that
sentence is in the deletion runbook and on the confirmation panel.

Three deletions remain distinct actions with distinct previews and permissions, and must
not be conflated: deleting an **evaluation form** (unused only, else archive — D-041),
deleting **one performance cycle** (employee and other cycles survive), and deleting an
**employee** (all their cycles go with them).

## D-051 — Program lifecycle state warns, it never blocks editing (2026-08-04)

v2.4.1 final scope §1.6. Editing a program's data was blocked once it was approved (only a
change-request workflow remained), and blocked entirely once completed or closed. The
observed consequence is worse than the risk it guarded: to fix a typo in a closed program
the principal had to **reopen it**, and reopening writes a real lifecycle transition. The
guard was producing the record corruption it existed to prevent.

State now produces a **warning, never a refusal**. What replaces the block:

- **Reason is mandatory** past draft (approved, completed, closed, or inside a closed year).
- **Field-level history** (`program_edit_history`, migration 0029): actor, timestamp,
  approval status *and* lifecycle at the moment of the edit, old value, new value, reason.
  The «تم تعديل البرنامج بعد الاعتماد» marker is derived from that history — no extra status
  column exists that could disagree with the record.
- **No implicit state change**: `status`, `approvedAt`, `completedAt`, `closedAt` and
  `archivedAt` are never written by the edit path. A forged `field_status` is ignored because
  the action reads only a whitelist (`EDITABLE_PROGRAM_FIELDS`), and a test asserts it.
- **Concurrency**: the update carries the row's `updated_at` and is applied only if it still
  matches, so of two concurrent saves exactly one wins.

Two guards were removed as dead: `plan.override` was required to correct closed programs but
**was never granted to any role** (`src/db/seed-data/permissions.ts` excludes it from both
principal and sysadmin), so it was an absolute block wearing the costume of an exception.
Bulk correction still excludes closed programs deliberately — a one-click mass edit of
records the principal closed contradicts "reviewed correction", and single-program editing
is now available as the explicit alternative.

Archived programs remain excluded from editing: archiving is a deliberate, one-click
reversible hiding, so the correct first step is to restore.

**Concurrency footnote worth keeping.** The first implementation compared the submitted
token to `programs.updated_at` with a plain equality on a JS `Date`. `timestamptz` stores
microseconds and `Date` holds milliseconds, so the comparison never matched and *every* edit
was rejected as stale. The state-matrix integration test caught it before the RC; the fix
truncates both sides to milliseconds in SQL.

## D-052 — Inspection belongs to maintenance, and one finding is one report (2026-08-04)

v2.4.1 final scope §1.2. The inspection→maintenance conversion existed since v2.4, but the
only way to *run* an inspection was from a room page under «الفحص والجاهزية» — so from the
principal's seat the feature was not where the work is. `/building/maintenance/inspect` now
hosts the flow inside the maintenance area («المبنى المدرسي ← الصيانة ← إجراء فحص»); the
room page keeps its entry point as a second, field-facing path, not a replacement.

Saving states the outcome in plain Arabic («تم تسجيل 3 ملاحظات تحتاج إلى صيانة», with
correct singular/dual/plural), lists the findings with duplicate detection already resolved,
and offers four explicit paths — create selected, create one separate report per finding,
review first, skip. **Grouping is never offered**: three actionable findings produce three
independent reports, each linked to its finding, its inspection, its location and its note.
Duplicate prevention runs per finding, so a re-inspection of the same failing item links to
the existing open report instead of creating a second one.

The formal report gained the fields the principal listed — category (closed list), safety
impact, operational impact, requested action — all **optional** per the platform-wide rule,
plus an always-printed approval and signature block. A report created from a finding fills
safety impact and requested action by restating the finding's own recorded severity; the
category stays empty until a human picks it, because the type of fault is not something the
system knows.

## D-053 — No `revalidatePath` in the application layer at all (2026-08-05)

Supersedes the narrower rule in D-049.

**What D-049 established.** A Server Action must not `revalidatePath` the route the user is
currently on: the client router refetches that route immediately and cancels the
still-streaming action response, so the write commits and the screen shows nothing.

**Why the exception could not hold.** Two facts, both found on real builds:

1. Invalidating an *ancestor* path invalidates the open route's tree just the same. That is
   how the defect returned for inspections in v2.4.1 after the page moved under
   `/building/maintenance` — `revalidatePath("/building/maintenance")` killed
   `/building/maintenance/inspect`.
2. One action is reachable from several routes (`submitInspectionAction` from the room page
   and from the maintenance page; `updateProgramAction` from the programme page and from the
   approval queue). The call site cannot know which route is open, so "everything except the
   current one" is not expressible there.

**Why removing it costs nothing.** Every page in this platform is `dynamic = "force-dynamic"`
and `experimental.staleTimes` is not configured, so the client router keeps no payload for a
dynamic route. Navigating to another page always re-renders it from the database.
Revalidation was buying no freshness at all — only the race.

**The rule.**
1. No `revalidatePath` anywhere under `src/app`. `lib/revalidate.ts` throws if called.
2. Forms owning a `useActionState` result call `useRefreshOnSuccess(state)`.
3. Buttons calling an action inside `useTransition` call `useRefreshAfterTransition(pending)`
   — which fires once `pending` clears, never inside the transition (D-049 rule 3; refreshing
   inside is what left the committee task dropdowns disabled).
4. Actions ending in `redirect()` need no refresh.

`tests/unit/no-revalidate-in-actions.test.ts` pins all four; every allowlist entry states why
that file is exempt.

**Scope of the v2.5.0 sweep.** 202 call sites removed across 29 files, plus three
`router.refresh()` calls that sat *inside* a transition. This is the most likely cause of the
three defects reported against v2.4.1 in production — programme editing "not visible", the
individual performance report "does not appear", deletions that "do not complete" — all of
which write correctly and then show nothing.

## D-054 — The weekly follow-up records observation, not progress (2026-08-05)

v2.5.0 §6.2 and §6.4.

**What was wrong.** The weekly follow-up form asked for a completion percentage and wrote it
over `programs.progress`, and its status field was written over `programs.execution_status`.
So a programme had two competing progress values — the one the principal reads in reports and
the one whoever filled the week's note typed — and a weekly observation silently changed the
programme's operational state.

**The decision.** The weekly follow-up is an *observation of a week*. It records what was
done, what blocked it, what action is required, what comes next, whether the principal's
intervention is needed, and a weekly state. It does not carry progress, and it does not
change the programme's own state. `lastReviewAt` is the only field it updates on the
programme — "a follow-up was recorded", which is what drives follow-up-due, not progress.

Authoritative progress stays on `programs.progress`, edited from the programme page with a
recorded reason and a field-level entry in `program_edit_history`.

**What happens to the old column.** `program_followups.progress_snapshot` stays in the
schema, holding its historical values, unwritten and unread. No production row is rewritten
(§18). It appears in no report column and no export.

**Vocabulary.** The weekly states adopt the five the brief lists. The two legacy spellings
already in production rows («في المسار», «متوقف مؤقتاً») are normalised **on read** by
`normalizeWeeklyStatus`, so the principal sees one vocabulary without any row being updated.

**One source.** `lib/plan/followup-service.ts` is read by both `/plan/followup` and the
`plan-followups` report. They previously ran different queries and disagreed — the report
always read *today's* week and ignored the selected one.
`tests/integration/followup-parity.test.ts` compares the two outputs row by row.

## D-055 — A report instance is a third artifact class: numbered, immutable, lifecycled (2026-08-08)

v2.6 §A/§B. The platform already distinguishes a *saved template* (a recipe,
`report_templates`), an *issued document* (a frozen HTML snapshot, `documents`) and a
*built-in report definition* (`lib/reports/catalog`). v2.6 adds the fourth thing the owner
actually asked for: **a report the school keeps** — built in the builder, saved as a draft,
finalized into an immutable numbered snapshot, archived, and searchable years later.

**The model.** New tables (all additive, migration 0034; guards in 0035):

- `report_instances` — title, catalog `report_key` or composite type, Arabic lifecycle
  status «مسودة | نهائي | مؤرشف», recipe columns while draft (filters/columns/options),
  a `snapshot` jsonb written **exactly once** inside the finalization transaction,
  `report_number` unique and NULL until finalized, `version_of_id` self-reference for
  "new version", `signed_copy_file_id`, finalized/archived/created/updated audit columns.
- `report_outputs` — one row per (instance, format) pointing at `stored_files`; the
  preserved PDF/DOCX/XLSX (+ ZIP) of the finalized report.
- `report_jobs` — DB-backed generation jobs (D-059).
- `report_counters` — per-year counter row locked with `SELECT … FOR UPDATE` at
  finalization. `documents.ts`'s count-based numbering has a documented race; report
  numbers must never collide or skip, so they take the locked-counter path. Number format:
  `<prefix><year>-<seq>` with prefix from setting `reports.number_prefix`
  (default «KHS-RPT-»).

**Lifecycle rules (§A):** only drafts may be edited or deleted; finalization is
transactional and idempotent (a second submit returns the same number); a "new version"
creates a new draft carrying `version_of_id`; archiving flips status only. The archive
search reads titles/numbers/types/periods — never inside snapshots.

**Immutability is enforced in the database, not just the service.** Migration 0035
installs triggers: `report_instances` rows that are not «مسودة» reject UPDATEs to
anything except the archive transition, the signed-copy reference and updater metadata,
and reject DELETE outright; `report_outputs` of a finalized instance reject
UPDATE/DELETE (ZIP excepted — D-060 explains why). Application code, background jobs,
cascades and future migrations all hit the same wall. Regression tests prove it from both
sides (service refusal and raw-SQL refusal).

**Permissions:** no new keys. Draft authoring = `reports.builder`; export =
`reports.generate`; finalization and signed-copy upload = `documents.issue` (finalizing
*is* issuing an official numbered artifact). Sensitive instances (any section marked
`sensitive` in the catalog) additionally require `performance.individual.read` on every
read/export path — the report archive must not reopen what D-013 closed.

## D-056 — Composite report types are presets over the one catalog, not a second engine (2026-08-08)

v2.6 §A/§C. The builder gains multi-section reports (التقرير الدوري، التقرير الختامي،
الملخص التنفيذي…) without a second report engine: a composite type is an ordered list of
**sections, each bound to a catalog report key**, sharing the instance's period/scope
filters with optional per-section additions. Everything the catalog already guarantees —
permission per report, whitelisted columns/sort/group, filter isolation, sensitivity —
applies per section by construction. Sections can be reordered and hidden; empty sections
are omitted automatically with an explicit «إظهار الأقسام الفارغة» override. A
single-source instance is the degenerate case: one section.

The registry lives in `src/lib/reports/instances/types.ts` (pure module, unit-testable,
same style as `catalog.ts`). No report is fabricated from data the platform does not
hold; a section whose data model lacks a concept states that rather than inventing it
(the v2.5.0 attendance precedent).

## D-057 — «إدارة التعليم» is the addressee; «مكتب التعليم» leaves the identity (2026-08-08)

v2.6 §E. The office line is removed from: `DocumentIdentity` rendering (`resolveHeader`
no longer emits it), the identity settings screen, the document-template identity block
and its placeholder (`education_office`), the hard-coded fallback org lines in
`lib/pdf.ts`, and every generated filename/label. The stored `document.identity` settings
row keeps any old `educationOffice` value (settings are jsonb; ignoring a key is free) —
nothing rewrites user data.

**Boundary:** official source data is untouched. The committee-duty texts in
`src/db/seed-data/committee-templates.ts` mention «مكتب التعليم» because the ministry's
own wording does; the language policy forbids paraphrasing it. The pinning test therefore
scopes to identity, templates, reports, letters and labels — not to verbatim source data.

## D-058 — Five protected base templates in code; customized copies in the database (2026-08-08)

v2.6 §E. The five base templates (رسمي إلى إدارة التعليم، إداري داخلي، تنفيذي موجز،
تحليلي مفصّل، طباعة أولية بلا هوية) are a **pure registry**
(`src/lib/reports/instances/base-templates.ts`): they cannot be deleted or destructively
modified because they are not rows. A customized copy is a `report_style_templates` row
referencing its base key with a whitelisted config diff (colors, header/footer text,
cover/TOC defaults, identity toggles) — the same closed-config philosophy as
`template_versions`, and explicitly **not** a general-purpose template designer. Default
template per report type lives in the settings store (`reports.default_templates`);
per-instance overrides live in the instance options and are frozen into the snapshot at
finalization. The existing dark document-template engine (`template_definitions`) is left
untouched: entangling a live release with dark code buys nothing.

## D-059 — Background generation: DB-backed jobs executed with `after()`, at-least-once, idempotent (2026-08-08)

v2.6 §I. There is no worker infrastructure and this release does not invent a daemon.
A generation request inserts a `report_jobs` row and schedules the work with Next's
`after()` — it runs on the server after the action's response has streamed, so it can
never abort the response (the D-049/D-053 failure class is structurally impossible).
The UI polls job status with the existing client-refresh idiom.

Reliability rules: one **active** job per instance (partial unique index on the two
Arabic active statuses); job execution re-checks state before writing; outputs are
upserted per (instance, format) so a retry after a crash cannot duplicate files or rows;
a job stuck in «قيد التنفيذ» past its heartbeat window is retryable — «إعادة المحاولة»
re-enqueues, it never edits the stuck row's history. Failures preserve the draft and
store an Arabic failure reason on the job row. This is the house `client_op_id` idempotency
pattern applied server-side.

## D-060 — One snapshot document renders everywhere; ZIP is assembled from preserved parts (2026-08-08)

v2.6 §B/§F/§G. Finalization freezes a single self-contained `SnapshotDoc` (schema
versioned, `version: 1`): title, type, period, resolved filter description, sections with
their columns and rows, the resolved identity (org lines, principal, logos by file id),
the resolved template config, and generation metadata. Every consumer — app preview,
paginated print preview, PDF, DOCX, XLSX — renders from this one structure, which is what
makes "the PDF matches the approved preview" testable rather than aspirational.

The preserved outputs are PDF/DOCX/XLSX files in `stored_files` (scope `reports`).
The ZIP is **assembled deterministically from preserved parts** (outputs + signed copy +
referenced attachments) and re-assembled when the signed copy arrives after finalization —
which is why the immutability trigger (D-055) exempts exactly the ZIP row and nothing
else. Path safety: entry names are sanitized flat names, never caller paths; integrity is
verified by reading the archive back before it is stored or served.

## D-061 — Finalization holds an optimistic lock on the draft's `updated_at` (2026-08-08)

v2.6 §A, raised by the independent RC review.

**The race.** `finalizeInstance` builds the snapshot *before* opening its transaction —
deliberately, because building runs every section's query and holding a row lock across
that would serialise the whole archive. But that leaves a window: a draft edit landing
between the build and the lock meant the frozen snapshot could be built from **older**
settings than the ones stored, and nothing would ever reveal it — the report would simply
be wrong forever, which §B makes unfixable by design.

**The rule.** `updated_at` is read before the build and compared under `FOR UPDATE`. If it
moved, the built snapshot is discarded and the whole attempt repeats (bounded at three).
A finalized report is therefore always built from the last committed state of its draft.
Idempotency is unchanged: a row already final returns its existing number.

**Why not lock for the whole build.** It would serialise finalization against every other
reader of those tables for the duration of a full report build — seconds on large reports —
to prevent a window measured in milliseconds. The compare-and-retry costs one extra read.

`tests/integration/v260-review-blockers.test.ts` proves it by **lock ordering, not timing**:
the test holds the row lock, lets finalize build and block, edits the title, commits, and
asserts the frozen snapshot carries the newer title.

## D-062 — The package is never downloadable in a stale state (2026-08-08)

v2.6 §B/§G, raised by the independent RC review.

D-060 allowed the ZIP row to be replaced when a signed copy arrives. The first
implementation replaced it *after* rebuilding, so between the signed copy landing and the
rebuild finishing, the previous package — the one missing that signed copy — was still
downloadable and looked complete.

**The rule.** Attaching a signed copy **deletes** the existing ZIP row in the same
transaction as the reference update. From that instant the only truthful state is "not
assembled yet", and the rebuild runs as a recorded `report_jobs` entry like any other
generation: its failure is stored with an Arabic reason and surfaced with Retry, never
swallowed by a fire-and-forget catch. `rebuildZip` reloads the instance row at assembly
time, so a signed copy replaced between scheduling and execution still wins.

Migration 0036 narrows the trigger accordingly: a ZIP row may replace only
`file_id`/`checksum`/`size`/`created_at` — never its `format`, `instance_id` or `id`.

## D-063 — Integrity is verified against the bytes on disk, not against a second row (2026-08-08)

v2.6 §B/§H, raised by the independent RC review.

`report_outputs.checksum` and `stored_files.sha256` are both recorded at write time, so
comparing them proves only that two database rows agree — they drift together the moment
the file itself is altered or truncated underneath. Reads now recompute SHA-256 from the
bytes actually returned by storage and compare that to the recorded digest, returning an
explicit `{ corrupt: true }` that the download route turns into an audited refusal.

The cost is one hash per download of an already-in-memory buffer. The alternative —
serving a silently corrupted official report — is not an acceptable trade at any price.

## D-064 — The report builder is the only authoring surface (2026-08-08)

v2.6 §A, raised by the independent RC review.

The archive shipped with its own reduced editing form, which meant column selection,
ordering, grouping and display mode were reachable in `/reports/builder` but not when
editing a saved report — two authoring surfaces with different capabilities over the same
model.

**The rule.** `/reports/builder` authors both: it gains a "save as report" step, and
opening it with `instance=<id>` makes it that report's editor. The archive's own form keeps
only what the builder cannot express — period, output template, output formats, section
order and visibility, identity overrides. Saved report *settings* (`report_templates`)
open in the builder as starting points, closing the loop between the two.

Two defects this surfaced, both silent: stored filters were read back without the report's
whitelist so saved column/sort/group selections vanished on read; and the snapshot ordered
columns by catalogue definition instead of by the user's selection order, discarding an
explicitly approved builder capability.
