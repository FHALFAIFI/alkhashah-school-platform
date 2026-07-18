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

## 6. Transactional rollback remains available

`rollbackBatchAction` → `rollbackBatch` requires `status = «منفذة»`, then inside a `db.transaction`:
sets the batch to «متراجع عنها» and `rollbackPeopleBatch` **deletes the people created by this
batch** and resets the rows to «جاهز». The UI button is **«تراجع كامل عن الدفعة»** (confirm dialog:
«هل أنت متأكد من التراجع الكامل عن هذه الدفعة؟ ستحذف السجلات المنشأة منها»). Rollback is refused only
if a performance cycle is already linked to an imported person (then deactivate instead) — i.e.
rollback is fully available immediately after commit, before any cycle is created.

## 7. Stop point

The agent stopped at the **«تأكيد التنفيذ»** button (the red execute button) **without clicking it**.
Post-check confirms nothing was committed:

- Batch status: **«معاينة»** (unchanged).
- People from this batch: **0**. Total `people`: **80** (unchanged; all synthetic).
- Source rows: **52 «جاهز»**, 0 «منفذ».
- Git tags: **none** (no release tag created).

**The principal executes «تأكيد التنفيذ» manually to complete activation step 1.**
