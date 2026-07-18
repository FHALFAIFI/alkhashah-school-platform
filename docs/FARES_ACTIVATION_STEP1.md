# Fares Activation — Step 1 (Commit the real employee batch)

**Prepared 2026-07-18. STAGED TO «تأكيد التنفيذ» — NOT EXECUTED.** This document records the
pre-commit verification for the principal's first operational-activation action. The commit itself
(«تأكيد التنفيذ») is the **principal's manual action only** — the agent stops one click before it.

Report language is English per repo policy; the Arabic UI strings are quoted verbatim.

---

## 0. Batch under review

- **Batch id**: `12673bed-c6ae-4f28-af9d-c311fb2e7a3d`
- **Source file**: `بيانات الموظفين في فارس.xlsx` (git-ignored, under `reference_files/`)
- **Import type**: `people`
- **Current status**: **«معاينة» (preview)** — never committed by the agent.
- **UI path**: `/imports/12673bed-c6ae-4f28-af9d-c311fb2e7a3d`

## 1. Fresh encrypted backup — created and restore-verified

Taken immediately before staging this step:

- **DB dump**: `backups/daily/db-20260718-203755.dump.enc` (pg_dump custom format, AES-256-CBC/PBKDF2).
- **Full snapshot**: `backups/weekly/full-20260718-203756.tar.gz.enc`.
- **Restore rehearsal** (`npm run restore:rehearsal`, into an isolated DB): **✓ passed** —
  65 tables restored, 2 users, 180 file records / 183 files actually recovered.
  Arabic result: «✓ نجحت بروفة الاستعادة — النسخ الاحتياطي قابل للاسترجاع فعلياً».

Rollback is therefore backed by a verified, recoverable backup **in addition to** the in-app
transactional rollback (§6).

## 2. Final confirmation summary (as the principal sees it before «تأكيد التنفيذ»)

Revealed live at `/imports/…` by clicking **«موافقة صريحة وتنفيذ الاستيراد»** — this button only
opens the confirmation panel (client state `confirming=true`); **it performs no database write.**
The panel title is «تأكيد استيراد بيانات الموظفين — راجع ملخص الدفعة قبل الموافقة النهائية».

| Panel line (Arabic) | Value | Meaning |
|---|---|---|
| عدد الصفوف الجاهزة (سجلات منسوبين ستُنشأ) | **52** | Ready rows = exact `people` records to materialize |
| عدد المعلمين | **42** | Classified as «معلم» (teacher) |
| عدد الموظفين | **10** | Classified as «موظف» (support staff) |
| تصنيفات روجعت يدوياً (معلم/موظف) | **10** | Rows flagged «التصنيف غير مؤكد» then confirmed by the principal |
| أرقام وظيفية مكررة | **0** | Duplicate employee-ID (job number) check — none |
| صفوف بحقول إلزامية ناقصة | **0** | Missing mandatory field (name / job number / category) check — none |
| عدد المستبعدين | **0** | Excluded rows |

Row-status totals (batch header): **جاهز 52 · يحتاج مراجعة 0 · مؤجل 0 · مستبعد 0 · منفذ 0** —
i.e. **52 ready / 0 needing review / 0 deferred**, matching the request.

Screenshots: `scratchpad/fares-confirm-desktop.png`, `scratchpad/fares-confirm-mobile.png`
(mobile 390×844, **0 px horizontal overflow**).

> The three safety-check lines (reviewed classifications / duplicate IDs / missing fields) were added
> to `buildConfirmSummary` for this activation so the principal sees the checks **on the confirmation
> screen itself**, not only in a report. They are a pure, read-only computation over the ready rows.

### 2a. The 10 manually-reviewed classifications

All 10 are the support-staff rows whose Fares **cadre** (الكادر) does not map cleanly to a teacher
model, so the importer flagged «التصنيف (معلم/موظف) غير مؤكد — يحتاج تأكيد المدير»; each was reviewed
and confirmed as **«موظف»**, status «جاهز». Breakdown by cadre / job title:

| Cadre (الكادر) | Job title (المسمى) | Count |
|---|---|---|
| المستخدمين | حارس أمن ممارس | 2 |
| الرسميين | مساعد إداري | 2 |
| بند الأجور | عامل | 2 |
| الرسميين | مدخل بيانات ممارس | 1 |
| المستخدمين | عامل | 1 |
| المستخدمين | مراسل | 1 |
| الرسميين | مساعد إداري ممارس | 1 |
| **Total** | | **10** |

The remaining 42 rows (cadre «المعلمين») auto-classified as «معلم» with no warning.

### 2b. Duplicate / missing checks (independently re-verified in the DB)

- **Duplicate job numbers among the 52 ready rows**: `GROUP BY jobNumber HAVING count > 1` → **0 rows**.
- **Missing mandatory fields**: rows with empty `fullName` / `jobNumber` / `category` → **0 / 0 / 0**.

## 3. Exact records that will be materialized

Committing runs `commitPeopleRows` inside a single `db.transaction`:

- Inserts **52 rows into the `people` table only** — fields: `fullName, category, jobTitle, cadre,
  employmentStatus, orgUnit, jobNumber, suggestedModelKey, importBatchId, createdBy`.
- Updates each source `import_rows` row to `status = «منفذ»`, `createdEntityType = "person"`,
  `createdEntityId = <new person id>`.
- Sets the batch to `status = «منفذة»`, `committedAt`, `committedBy`.
- **No other domain table is written.**

## 4. No login/user accounts are created

`commitPeopleRows` inserts into **`people` only**. It does **not** touch the `users` table, does not
create credentials, and does not enrol 2FA. Committing the batch produces **employee records, not
login accounts** — staff logins remain a separate, later administrative action.

## 5. Committees & Performance become available after commit

Both modules gate on `committedEmployeeCount()` — active, **non-synthetic** people.

- **Today**: all 80 existing `people` rows come from «…تجريبي…» (synthetic) import batches and are
  excluded by the central synthetic filter → `committedEmployeeCount() = 0`. Committees and
  performance show the Arabic prerequisite banner linking to the Fares preview.
- **After commit**: the 52 Fares people (source file `بيانات الموظفين في فارس.xlsx`, not synthetic)
  become the real pool → `committedEmployeeCount() = 52`, unblocking committee formation and
  performance cycles.

## 6. Transactional rollback remains available — and is dependency-guarded

`rollbackBatchAction` → `rollbackBatch` requires `status = «منفذة»`, then inside a `db.transaction`:
sets the batch to «متراجع عنها» and `rollbackPeopleBatch` **deletes the people created by this batch**
and resets the rows to «جاهز». The UI button is **«تراجع كامل عن الدفعة»** (confirm dialog: «هل أنت
متأكد من التراجع الكامل عن هذه الدفعة؟ ستحذف السجلات المنشأة منها»).

**Hardened dependency guard (`src/lib/imports/people-dependencies.ts`).** Full rollback is allowed
**only when none of the imported people has any dependent business record**. Before deleting, the
guard (inside the transaction — the final authority) counts every place a person id can be referenced:

| Source table.column | Kind | Arabic label |
|---|---|---|
| `committee_members.person_id` | FK | عضويات لجان |
| `perf_cycles.person_id` | FK | دورات تقييم أداء |
| `person_stages.person_id` | FK (cascade) | مراحل تدريس مسندة |
| `action_tasks.owner_person_id` | soft | مهام وإجراءات مسندة |
| `maintenance_issues.owner_person_id` | soft | بلاغات صيانة مسندة |
| `programs.owner_person_id` | soft | برامج خطة يملكها الشخص |
| `users.person_id` | soft | حسابات دخول مرتبطة |

(Meetings carry no direct person id — no attendance — so their link is covered transitively via
committee memberships.) If **any** count is > 0, rollback is **blocked server-side** and **nothing is
cascade-deleted or altered**; the Arabic error lists the dependency types and counts and directs the
principal to **correct/deactivate the individual employee** from «سجل المعلمين والموظفين» instead.

**UI signal on the executed-batch page**: a preflight badge shows **«متاح»** while no dependency
exists, and **«غير متاح لوجود سجلات مرتبطة»** (with the dependency list and the individual-correction
guidance) once any dependency exists; in the blocked state the button is disabled.

Right after commit — before any committee, task, or cycle is built on the new staff — the batch has
zero dependencies, so full rollback is available. Tests: `tests/integration/people-rollback.test.ts`
(commit synthetic batch → rollback succeeds with no dependencies; then link a committee + task +
performance cycle → rollback rejected and all people and business records remain intact).

## 7. Confirmation reliability — root cause of the failed attempt and the fix

**Proven state of the failed attempt.** The batch remained `«معاينة»` with `committed_at = null`, 0
people materialized, all 52 rows still `«جاهز»`, and — critically — the audit log contained **no
commit event of any kind** for this batch (only `import.batch_created` from 2026-07-16). The only
activity on the attempt day was `login.success` / `ai.prompt`. The happy-path UI commit is proven to
work by the existing e2e (`importPeopleBatch`), so this was **not** a happy-path logic defect.

**Root cause (evidence-based, not a claimed "timeout").** The confirmation action had **no
server-side observability** and did authorization / side-effects **outside** the audited,
error-handled region:
- `requirePermission("imports.commit")` ran **before** any audit and **outside** the `try`. On an
  **expired session** `requireUser()` calls `redirect("/login")` (throws `NEXT_REDIRECT`), which the
  client `startTransition` swallows — the principal is silently bounced to `/login` with **no error
  shown and no audit trace**. The batch page is long-lived (the principal reviews the summary before
  clicking), so session expiry at click-time is the most plausible trigger.
- A thrown transaction error was caught but **only returned to the client** — **no audit** was
  written, so any server-side failure was invisible.
- `notifyAll` ran **after** the commit but **outside** the `try`, so a notification failure could
  reject an already-successful commit.

An expired session and a lost/aborted request produce the **identical fingerprint** (no change, no
trace); the missing "started/failed" audit is itself the defect — so the fix makes every
server-reaching attempt observable, and hardens execution so a retry is always safe.

**The fix (committed).**
- **Observability**: `commitBatchAction` now writes a sanitized `import.batch_commit_started` audit
  as soon as an authorized request reaches the server, and `import.batch_commit_failed` on any thrown
  error — each carrying a **correlation id**; the user-facing Arabic error includes a **reference id**
  (`… (مرجع الخطأ: XXXXXXXX)`). Success still writes `import.batch_committed` (now carrying the same
  correlation id).
- **Execution hardening** (`commitBatch`): the batch row is **locked inside the transaction**
  (`SELECT … FOR UPDATE`); ready rows are **re-read under the lock**; a second/concurrent submit finds
  `«منفذة»` and is rejected — **no duplicate people**. All-or-nothing is preserved (a failing
  committer rolls back the status flip, leaving 0 people and `«معاينة»`).
- **Side-effect isolation**: `notifyAll` is wrapped in its own `try/catch` — a notification failure
  can never fail a committed import.
- **UI** (`batch-ui.tsx`): the confirm/cancel buttons are explicit `type="button"`; the execute button
  shows **«جارٍ تنفيذ الاستيراد…»** and is disabled while pending; on any error or **uncertain
  response** the panel stays open, the batch status is **reloaded** (`router.refresh()`), and the
  principal is told to check the status (if it shows `«منفذة»`, the import succeeded — **do not
  retry**) — no automatic retry.

**Session-expiry path closed (the exact suspected failure).** A mutation invoked through
`startTransition` must not silently lose a `NEXT_REDIRECT`, so `commitBatchAction` no longer calls
`requirePermission` (which would `redirect("/login")` and be swallowed). It now authenticates
**without throwing** and returns a **typed result**:
- **`SESSION_EXPIRED`** → the spinner stops and an Arabic notice appears — «انتهت الجلسة. لم يتم تنفيذ
  الاستيراد. سجّل الدخول ثم ارجع إلى الدفعة.» — with a login link carrying a **validated `returnTo`**
  (`/login?returnTo=/imports/<id>`; `safeImportsReturnTo` accepts only the exact batch path, blocking
  open-redirects). After re-login the principal lands back on the batch. **No auto-retry.**
- **`PERMISSION_DENIED`** → a plain Arabic notice «لا تملك صلاحية تنفيذ الاستيراد. لم يتم تنفيذ الاستيراد.»
- **`ALREADY_EXECUTED`** → an already-committed submission (a prior success, another window, or a
  concurrent race caught inside the transaction) is treated as a **successful current state**, not a
  frightening generic error: the page simply reloads to show `«منفذة» / «تم الاستيراد»`.

Unauthenticated requests are **not** given a fabricated audit actor; correlation ids are preserved
only for authenticated attempts (started/committed/failed).

**Tests.** `tests/integration/import-commit-hardening.test.ts` (52 ready → exactly 52 people + one
commit event; repeat/concurrent submit → single success, no duplicates; committer failure → 0 people
+ `«معاينة»`). `tests/e2e/import-commit.spec.ts` (390×844: mobile UI confirm → 52 people + one
`commit_started` + one `import.batch_committed`; page reload shows `«منفذة»` and does not re-commit).

## 8. Stop point

The agent stopped at the **«تأكيد التنفيذ»** button (the red execute button) **without clicking it**.
Post-check confirms nothing was committed:

- Batch status: **«معاينة»** (unchanged), `committed_at` **null**.
- People from this batch: **0**. Total `people`: **80** (unchanged; all synthetic).
- Source rows: **52 «جاهز»**, 0 «منفذ».
- Git tags: **none** (no release tag created).

**The principal executes «تأكيد التنفيذ» manually to complete activation step 1.**
