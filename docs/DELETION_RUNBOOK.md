# Deletion runbook — v2.4.1 final scope

Operator-facing. Covers the three deletions the platform now offers, what each destroys,
what survives, and how to recover when someone deletes the wrong thing.

Arabic UI strings are quoted verbatim; the platform's user-facing surfaces stay Arabic.

---

## 1) The three deletions are not interchangeable

They have different subjects, different permissions and different impact previews. Confusing
them is the most likely way to lose data, so the distinction is deliberate and enforced.

| # | Action (as the principal sees it) | Subject | Permission | What survives |
| --- | --- | --- | --- | --- |
| 1 | «حذف النموذج» / «أرشفة النموذج» | An **evaluation form** (template) | `performance.models.manage` | Every cycle already built on it — the form snapshot is frozen inside `perf_cycles.model_snapshot`, so historical evaluations and their reports are unaffected |
| 2 | «حذف دورة الأداء» | **One performance cycle** of one employee | `performance.write` + `performance.approve` + `performance.individual.read` | The employee, all their other cycles, and every institutional record |
| 3 | «حذف الموظف نهائياً» | **The employee and all their cycles** | `people.delete` + `performance.individual.read` | Every institutional record: committees, programs, activities, tasks, maintenance reports, expenses |

**Form deletion is still conditional** (D-041): a form that has never been used may be
deleted permanently; a form in use is archived instead. That rule is unchanged. Actions 2
and 3 are the new unconditional ones — they destroy records that *are* in use, by design.

`people.delete` alone is not enough for action 3, and `performance.write` alone is not
enough for action 2. Both require `performance.individual.read`, which D-013 denies to
`sysadmin`. Whoever may not read individual evaluation content may not destroy it, so in
practice the principal is the only account that can run either.

---

## 2) What action 3 does, table by table

Derived from the actual foreign-key graph, not from assumption. `src/lib/lifecycle-delete.ts`
carries the same table as a comment next to the code that implements it.

**Deleted (owned by the employee):**

- `perf_cycles` → `perf_sessions` → `perf_ratings`, `perf_signed_report_versions`
- `improvement_plans` (deleted before sessions — its `session_id` key is `NO ACTION`)
- `person_stages`
- `documents` whose `entity_type` is `perf_cycle` / `perf_session` / `person` for this employee
- `record_versions` for those cycles and sessions
- `evidence_links` pointing at those records
- `evidence_items` **only** when no link remains anywhere after the unlink
- `stored_files` **only** when no reference remains across all 12 FK columns and the two
  `jsonb` photo arrays; the file is removed from disk after the transaction commits
- `people` — the employee row itself

**Preserved, with the reference cleared:**

- `committees` — the membership row goes, the committee stays.
  `committee_task_assignments.assigned_member_id` becomes `NULL` automatically, so the
  committee's task remains, unassigned.
- `programs.owner_person_id`, `program_activities.owner_person_id`,
  `action_tasks.owner_person_id`, `maintenance_issues.owner_person_id`,
  `inspection_findings.responsible_person_id`, `budget_expenses.responsible_person_id`

**Deactivated, never deleted:**

- `users` — the linked login account is set `active = false`, `person_id = NULL`, its
  sessions and notifications are removed. It is not deleted because `audit_log.actor_id`
  and a dozen other `NO ACTION` keys reference it; deleting it would either fail or force
  destroying the audit trail.

**Untouched:**

- `audit_log` (append-only), `import_rows` (import provenance), `record_versions` of shared
  entities such as programs and committees.

Everything above runs in **one transaction**. If any step fails, nothing is deleted, no
tombstone is written, and no file is removed from disk.

---

## 3) Safeguards that will stop you

All enforced server-side; the UI only explains them.

- **Impact preview** — exact counts per record type, split into "deleted permanently" and
  "shared institutional records, link removed only". Shown before the button is usable.
- **Typed confirmation** — the employee's full name (or the cycle's year) typed literally.
  Surrounding whitespace is tolerated; anything else is rejected.
- **Mandatory reason** — minimum 5 characters, stored in the tombstone.
- **Explicit acknowledgement** checkbox.
- **You cannot delete the person linked to your own account.** Sign in as another
  authorised account.
- **You cannot deactivate the last active account holding `admin.users`.** Grant that
  permission to another account first, or the platform would be left with no owner.

---

## 4) The tombstone

`deletion_tombstones` is append-only and is the only trace left once the records are gone:

| Column | Content |
| --- | --- |
| `entity_type` | `person` or `perf_cycle` |
| `entity_id` | the deleted record's id |
| `display_ref` | a safe identifying reference — name, job number, category |
| `reason` | what the operator typed |
| `counts` | number of deleted rows per type, and per type of unlinked reference |
| `actor_id`, `created_at` | who and when |

It stores **no evaluation content** — no ratings, notes, strengths, weaknesses,
recommendations or session text. An integration test serialises the row and asserts the
seeded sensitive strings are absent, so a future change cannot quietly start leaking
evaluation detail into it.

Read it with:

```sql
SELECT created_at, entity_type, display_ref, reason, counts
FROM deletion_tombstones
ORDER BY created_at DESC;
```

The matching `audit_log` rows are `person.permanently_deleted` and
`perf_cycle.permanently_deleted`.

---

## 5) Recovery — there is exactly one route

**Permanent deletion cannot be undone from inside the platform.** There is no restore
button, no trash, no soft-delete flag to flip. The only recovery is a **full backup
restore**, which returns the whole database to the moment of the backup — every change made
after it is lost, not just the deletion.

So the order of operations matters:

1. Find the tombstone and confirm what was deleted and when (`created_at`).
2. Pick the most recent backup taken **before** that timestamp:
   `ls -1 backups/daily backups/gold backups/predeploy`.
3. Decide whether losing everything after that timestamp is acceptable. Usually it is not,
   and the honest answer to the principal is that the record is gone.
4. If restoring: follow `docs/BACKUP_RESTORE_AR.md`. **Restore into an isolated container
   first**, extract the specific records if that is what is wanted, and only then decide
   whether to touch production.

Before running a permanent deletion on production, take a fresh backup:

```bash
npm run backup:daily
```

That single command is the difference between "recoverable with effort" and "gone".

---

## 6) Principal-facing summary (Arabic)

> **حذف نموذج التقييم** — يحذف قالب التقييم غير المستخدم فقط؛ النموذج المستخدم يُؤرشف
> ولا يُحذف، وتبقى كل الدورات والتقارير المبنية عليه سليمة.
>
> **حذف دورة الأداء** — يمحو دورة واحدة بكامل جلساتها وتقديراتها وخطط تحسينها ووثائقها.
> الموظف ودوراته الأخرى تبقى كما هي.
>
> **حذف الموظف نهائياً** — يمحو سجل الموظف وكل دورات أدائه. اللجان والبرامج والاجتماعات
> والمهام وبلاغات الصيانة والمصروفات **تبقى كلها**، ويُزال اسمه منها فقط.
>
> **الحذف النهائي لا يمكن التراجع عنه** إلا باستعادة نسخة احتياطية كاملة للمنصة — وهي
> تُعيد كل شيء إلى لحظة النسخة وتُفقد كل ما سُجّل بعدها. خذ نسخة احتياطية قبل أي حذف نهائي.
