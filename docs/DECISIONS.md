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
