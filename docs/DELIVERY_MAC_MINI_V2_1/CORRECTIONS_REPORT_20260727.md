# Scope v2.1 — Principal Final-Demo Corrections — Engineering Report (2026-07-27)

Corrective batch on top of the deployed v2.1 build (`8fb59c1`, prod migration `0016`, image
`madrasa-app:0.1.0` = `a492d908…`). Corrective commit **`1bbf797`** on branch
`scope-v2.1-corrections`. **Not deployed; no release tag — production cutover is paused pending
explicit authorization.**

## A. Executive verdict

**Ready for principal retest — pending the (paused) production cutover.** The corrected build is
implemented and fully verified (typecheck/lint/build clean; vitest 281; Playwright 60/1-skip;
migration `0017` rehearsed on a production clone with the legacy fingerprint unchanged; encrypted
pre-deploy backup taken and verified). The production deploy itself was intentionally **not**
performed — it awaits an explicit go-ahead (operator instruction).

## B. Changed files (99 files; +11,461 / −790, incl. the generated 0017 snapshot)

Grouped by requirement (representative files; full set in commit `1bbf797`):

- **A — programs/classifications:** `plan/actions.ts` (archive/unarchive + classification
  rename/delete-by-reassign), `plan/[id]/program-ui.tsx`, `plan/[id]/page.tsx`, `plan/page.tsx`,
  **new** `plan/classifications/{page,classifications-ui,actions}.tsx`, `lib/worklist.ts`,
  `lib/reports/executive-report.ts`, `lib/ai/tools.ts`, `api/export/plan-xlsx/route.ts`.
- **B — budget:** `budget/{budget-ui,actions,page}.tsx`, `lib/budget/{calc,service}.ts`,
  `lib/reports/program-report.ts`, `db/schema/budget.ts` (amounts nullable).
- **C — back nav:** **new** `components/back-button.tsx`; placed in perf session/cycle + plan pages.
- **D — performance:** `performance/actions.ts` (gate removal), `…/session-ui.tsx`, `…/sessions/[sid]/page.tsx`,
  `cycles/[id]/{page,cycle-ui}.tsx`, perf docx/xlsx exports, `lib/reports/session-report.ts`.
- **E — upload perf:** `lib/synthetic.ts` (React `cache()`), `lib/storage.ts` (async mkdir),
  `components/evidence-panel.tsx`, `evidence/{actions,page}.tsx`.
- **F — committee doc:** `lib/reports/assignment-form.ts` (two-list rebuild), `committees/[id]/page.tsx`,
  `committees/actions.ts`, `committees/[id]/task-distribution-ui.tsx`.
- **G — minutes/impact:** `lib/reports/minutes-report.ts` (drop الصفة, add التوقيع), `committees/[id]/{page,committee-ui}.tsx`,
  `committees/actions.ts`, `committee-report.ts`, committee docx/xlsx exports.
- **H — optional fields:** all module `actions.ts` (zod relaxations) + `*-ui`/form call sites
  (removed `required`) across plan/budget/performance/committees/evidence/people/tasks/building/feedback,
  **new** `lib/format.ts` null-safe helpers, plus report/export null-safety.
- **Shared/pilot/tests:** `pilot/{page,retest-checklist}.tsx`; regression updates in
  `tests/integration/{committee-prerequisites,committee-assignment,committee-tasks,feedback,performance}.test.ts`,
  `tests/e2e/workflows.spec.ts`, **new** `tests/unit/budget-calc.test.ts`.

## C. Database impact

- **One new migration `0017_married_blue_blade.sql`** (forward-only, additive-safe):
  `ALTER TABLE budget_expenses ALTER COLUMN amount DROP NOT NULL;` and the same for `budget_income`.
- No column drops, no destructive change, no rename of prior migrations.
- **`seed.ts` did NOT run.** Migrations `0000–0016` were **not** rerun.
- Rehearsed on an isolated production clone: 17→18 migrations, budget amounts nullable, counts
  unchanged (26/129/129), **milestone baseline fingerprint `8d5375…a382cf` UNCHANGED**. Idempotent
  (2nd apply = no-op).
- Rollback: additive/nullable relaxation is inert to older code (Drizzle emits explicit column lists).
  To revert the column change: `ALTER … SET NOT NULL` only after confirming no null amounts exist.

## D. Requirement matrix

| Req | Status | Evidence |
|---|---|---|
| A1 program delete | Implemented (as archive) | `archiveProgramAction` (idempotent, Arabic confirm naming the program, linked-data warning) + `unarchiveProgramAction`; hidden from lists/selects/reports/exports; e2e budget-selector excludes archived. Hard-delete intentionally not offered (all real programs have activities via RESTRICT FK). |
| A2 classification delete | Implemented | `/plan/classifications`: rename/merge + delete-by-reassign (or clear → «بدون تصنيف»); **no program deleted**. |
| B1 رقم الفاتورة | Implemented | Label renamed + value now shown (table column + program report); DB col `payment_reference` kept. e2e asserts «رقم الفاتورة» present, «مرجع الدفع» absent. |
| B2 invoice attachment | Implemented | Optional file input on expense create → secure `saveUploadedFile` (MIME/ext/size/UUID/sha256) + evidence link; openable/replaceable via panel; Arabic errors. |
| B3 «البند» options | Implemented | Optional select المستلزمات/النشاط stored in existing `items` col (no competing concept). |
| B4 spent/remaining | Implemented (corrected — per-item) | **Per budget item** (المستلزمات/النشاط) each carries its OWN allocation (`plan_budget_items`), spent (Σ expenses with that «البند»), and remaining — deducted independently; over-budget flagged; neutral state when unallocated; live sum so edit/delete recomputes only the affected item. Clone-verified (see Addendum). Corrected from the initial per-program (`programs.budget`) reading in commit `02a5a19`. |
| C back nav | Implemented | `BackButton` (real history else safe fallback, RTL) on perf session/cycle + plan pages; works after save/cancel + direct URL; mobile RTL e2e green. |
| D1 التوصيات | Implemented | 5 perf-context occurrences renamed; 20+ unrelated «الإجراءات» untouched. |
| D2 finalize w/o evidence | Implemented | Evidence + signed-report + all-rated gates removed; issue-report + D-014 kept; existing completed sessions unchanged; no placeholder evidence. |
| E upload perf | Implemented + measured | Classifier memoized (N→1/req); guarded single refresh; async mkdir; SQL count. See §F. |
| F committee doc | Implemented | Two independent lists (أعضاء اللجنة + مهام اللجنة); members shown without tasks; no throw on empty; issued snapshots stay frozen. |
| G1/G2 minutes | Implemented | «الصفة» removed from minutes attendee table only; optional «التوقيع» column added next to «العمل في اللجنة»; kept in membership/exports. |
| G3 النتائج/الأثر | Implemented | Removed from committee workflow/report/exports/close-gate; table + rows preserved (prod had 0 rows). |
| H optional fields | Implemented | zod presence + `required`/markers relaxed for business fields across all major modules; format checks + audit/security/identity kept; null-safe display; `0017` for numeric amounts. |

## E. Test results

- **Unit/integration (vitest): 281 passed / 0 failed** (53 files) — baseline was 280 (+1 new
  `budget-calc` case). 6 existing tests rewritten to assert the corrected behavior (not weakened).
- **E2E (Playwright): 60 passed / 1 skipped / 0 failed** — matches baseline (skip = C5 HTTPS-camera,
  D-018). Scenario suite (`workflows.spec.ts`) 16/16 incl. mobile RTL; budget/committee/perf specs
  updated to new UI.
- **New/updated regression coverage:** budget calc neutral state; committee assignment two-list +
  member-without-task shown; committee closure without impact; empty-title feedback accepted;
  finalize with zero evidence; meeting saves without a type; budget e2e for رقم الفاتورة/البند/الفاتورة.
- **typecheck 0 · lint 0/0 · production build ✓.**
- **Clone test:** migration `0017` applied cleanly to a restored production clone; fingerprint + counts
  unchanged; workflows validated on the isolated test DB.
- Mobile + desktop RTL: covered by the mobile.spec (390px, no horizontal overflow) + scenario replays.
- Upload security: `saveUploadedFile` validation unchanged (MIME/ext/size/UUID filenames/sha256);
  not weakened for performance.
- Authorization: unchanged permission gates; archived/classification actions require `plan.approve`/`plan.write`.
- Restart/persistence: prod uses named volumes; clone idempotency verified.

## F. Performance results (evidence upload / save)

Root cause (measured): `getExcludedIdSets()` → `classifySynthetic()` ran **uncached, ~20 full-table
scans, once per caller**, on every dynamic render and again on every post-upload `router.refresh()`.

Benchmark on production-shaped clone data (steady-state):

| calls / request | wall time |
|---|---|
| 1× (after fix — deduped per request) | ~4.5–5.1 ms |
| 4× | ~16.7–17.8 ms |
| 8× (before — typical dashboard/detail fan-out) | ~29.8–30.5 ms |
| per-call | ~3.8 ms |

Fix: React `cache()` collapses all per-request callers to **one** classifier run; the evidence panel
does a **single guarded** refresh (was re-rendering the whole host page on every action);
`mkdir` is async; the evidence list count is a SQL `GROUP BY` (was a full-table load). Honest caveat:
at the current small pilot data size the absolute saving is tens of ms per request; the structural
value is that cost no longer scales with caller-count and no longer re-runs on every evidence refresh.
This is a structural fix, not a spinner.

## G. Production deployment evidence

- **Previous (deployed) commit:** `8fb59c1` (docs-only `04a986b` on top). **New corrective commit:** `1bbf797`.
- **Deployed image:** `madrasa-app:0.1.0` = `a492d908bcfb…` (previous retained as `…-prev-v2-20260723` = `d6df008b`).
- **Prod migration level:** `0016` (17 rows) — `0017` NOT yet applied to production (paused).
- **Container health:** `{"status":"ok","db":"up","version":"0.1.0"}`.
- **Data counts (2026-07-27, pre-change):** programs 26 · milestones 129 · activities 129 · people 54 ·
  users 2 · budget_expenses 2 · committee_impacts 0 · stored_files 57.
- **Pre-deploy backup (encrypted, verified):**
  - `backups/predeploy/db-20260727-114825.dump.enc` — SHA-256 `7b95d0288b4ff637ffb055610e0e3398d4ca7738deafd87fa3ed0d0a76f27740` (502 restorable objects).
  - `backups/predeploy/storage-20260727-114825.tar.gz.enc` — SHA-256 `07d97cb6b73d665e401c557cbe3ef46ae11368e8cd6ee560833534b9eedebbdb` (58 files).
  - `backups/predeploy/SHA256SUMS-20260727-114825.txt`.
- **Exposure unchanged:** prod PostgreSQL `5432/tcp` (unpublished) · app `0.0.0.0:3080` (existing LAN-retest
  binding, not broadened) · Ollama `127.0.0.1:11434` (loopback). No firewall/router/Docker-port change.
- **LAN compose diff:** `compose.production.yml` left **uncommitted** (temporary `APP_BIND`/`ALLOW_INSECURE_LAN_HTTP`).

### Controlled deploy commands (operator-run, after approval; apply ONLY 0017, never seed)

```bash
cd "<repo>"; git checkout scope-v2.1-corrections   # commit 1bbf797
# 1) apply ONLY migration 0017 (migrate-only override drops the && seed):
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm --build --no-deps init sh -c "npx tsx src/db/migrate.ts"
#    verify: 18 migration rows; budget amounts nullable; milestone fingerprint 8d5375… unchanged.
# 2) cutover app WITHOUT re-running init/seed:
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --build --no-deps app
#    NEVER run `up` without `--no-deps app` (that re-runs init → seed.ts).
```

## H. Known limitations (not minimized)

1. **Production deploy not performed** — paused for explicit authorization (operator choice). `0017`
   is applied only to the clone so far.
2. **DHCP IP drift:** the live Mac-mini LAN IP is **`192.168.0.171`** (not the `.48` in the brief);
   the running container already trusts `.171`. Any redeploy must keep `TRUSTED_ORIGINS`/`APP_BIND`
   matched to the current IP or LAN access breaks. Durable fix = a router DHCP reservation.
3. **`insertBefore` = PROBABLE (D-029):** class-level fix retained; conclusive proof is still the
   principal's real-browser retest. Optional fields add only plain-string fallbacks (no new bare
   conditional JSX siblings) so no new risk introduced.
4. **File reconciliation:** current state is **58 physical / 57 DB** rows; the single unmatched file
   is `storage/private/initial-credentials.txt` (seed-generated temp credentials, intentionally not a
   `stored_files` row) — **preserved, not deleted**. Housekeeping: the go-live step "store then delete
   initial-credentials.txt" is still outstanding (contains temp passwords).
5. **Perf signed-report reminder** (`missingSignedReports()` dashboard card / `markEvaluationCompletedAction`)
   still shows informationally — it no longer blocks completion; drop it later only on explicit request.
6. **Retained legacy records** (129 activities + 129 milestones) remain inert and preserved.
7. **B2 invoice attachment** reuses the shared evidence pipeline under `budget.write` (not a separate
   `invoiceFileId` column) — deliberate, to avoid a competing budget concept and an extra migration.

## I. Principal retest checklist (Arabic) — also live in `/pilot`

1. افتح برنامجاً وحدّث «نسبة الإنجاز» و«حالة التنفيذ» مباشرةً (لا أنشطة فرعية).
2. احذف/أرشف برنامجاً تجريبياً (تأكيد عربي يذكر اسم البرنامج) ثم استرجعه — لا تُفقد السجلات.
3. افتح «إدارة التصنيفات» وأعد تسمية تصنيف أو احذفه بإعادة إسناد برامجه — لا يُحذف أي برنامج.
4. ارفع شاهداً لبرنامج ولاحظ تحديث العدّاد فوراً؛ الشواهد اختيارية بلا نسب أو نواقص.
5. سجّل إيراداً وارفع إيصاله (اختياري) أو اربط شاهداً قائماً.
6. سجّل مصروفاً: «البند» قائمة (المستلزمات/النشاط)، والحقل «رقم الفاتورة» (لا «مرجع الدفع»)، وأرفق الفاتورة اختيارياً.
7. اربط المصروف ببرنامج له ميزانية وتحقق من «الميزانية المعتمدة/المصروف/المتبقي» تلقائياً.
8. جرّب زر «العودة» من جلسة الأداء وصفحة البرنامج — يرجع للصفحة السابقة لا للرئيسية.
9. تحقق أن حقل الجلسة يسمّى «التوصيات» (لا «الإجراءات»).
10. أقفل/أنهِ تقييماً نهائياً دون أي شاهد — يتم الإقفال (الشواهد غير إلزامية).
11. دورة فيها جلسة تخطيط فقط تعرض «لم يبدأ التقييم بعد» لا 0٪.
12. ولّد نموذج تكليف لجنة: قائمتان «أعضاء اللجنة» (كل الأعضاء ولو بلا مهمة) و«مهام اللجنة».
13. محضر اجتماع: بلا «الصفة»، وبه عمود «التوقيع»، وبلا «النتائج/الأثر»، والحفظ لا يُمنع.
14. احفظ نموذجاً بكل الحقول فارغة — ينجح دون «مطلوب» ودون خطأ.
15. أصدر تقرير برنامج مركّزاً على المعلومات والتقدم والشواهد والميزانية.
16. اختبار الاستقرار: «حفظ» مرتين بسرعة + فتح/إغلاق حوار + رفع ملف — بلا خطأ إنجليزي وبلا تكرار.
17. أرسل ملاحظة تشغيل واحدة.

## Addendum (2026-07-27) — B4 corrected to per-item allocation (commit `02a5a19`)

Principal review flagged that B4 must track **each budget item separately**, not deduct both
items from one shared `programs.budget`. Corrected: budget items are `plan_budget_items` rows
(item name → allocation); an expense's «البند» (`budget_expenses.items`) selects the item; per
item `remaining = allocation − Σ(expenses of that item)`. No schema change, no new migration;
existing records preserved. A new «بنود الميزانية» card manages allocations and shows
allocated/spent/remaining per item; the expense form shows the selected item's live remaining and
per-item over-budget warning.

Clone demonstration (real `getBudgetOverview` on a restored production clone):

| step | المستلزمات | النشاط |
|---|---|---|
| allocations 5000 / 3000; expenses 1200 & 800 | allocated 5000 · spent **1200** · remaining **3800** | allocated 3000 · spent **800** · remaining **2200** |
| EDIT النشاط 800→1000 | unchanged 1200 / 3800 | spent 1000 · remaining 2000 (only النشاط) |
| DELETE المستلزمات 1200 | spent 0 · remaining 5000 (only المستلزمات) | unchanged 1000 / 2000 |

New tests: 5 `budgetItemLines` unit cases + 1 `getBudgetOverview` integration case (exact
scenario + delete recalc). Gates after correction: typecheck 0 · lint 0/0 · **vitest 287** ·
scenario e2e 16/16.
