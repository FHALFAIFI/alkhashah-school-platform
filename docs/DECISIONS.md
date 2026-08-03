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
