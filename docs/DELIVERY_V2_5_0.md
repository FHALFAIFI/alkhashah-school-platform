# DELIVERY v2.5.0 — reporting, filtering, workflow and data-entry scope

> Work record for the v2.5.0 scope on branch `scope-v2.5-reporting-workflows`, continuing
> from the deployed baseline v2.4.1 (`docs/DEPLOYMENT_V2_4_1.md`). Decisions **D-053** and
> **D-054** in `docs/DECISIONS.md`.

## 1) Executive verdict

**NOT READY FOR DEPLOYMENT — one blocking defect, confirmed on the RC image.**

The feature scope is substantially complete and the production-clone rehearsal ran at
**45 / 48**. It found a real, reproducible, user-visible defect that must be fixed first:
after a successful permanent deletion the browser stays on the deleted record's page, because
the Server-Action response is still being aborted for actions that end in `redirect()`
(§9.2 below). Data is correct in every case; navigation is not.

Most of the feature scope is implemented, tested and green on the automated gates.
The remaining half is **not started or not finished**, and none of the release-gating
activities have been performed: no RC image, no production-clone rehearsal, no rollback
rehearsal, no browser-level validation, no security or performance review. Section 4 below
lists exactly what is and is not done.

**Production is untouched.** No production container was restarted, no production database
was read or written by this work, and no image tag was moved. All development ran against the
local development database (`madrasa-db`, port 5544) and the isolated test database
(`madrasa_test`). The production stack (`madrasa-prod`, host port 3080) was left running as it
was.

## 2) Branch and commits

Branch `scope-v2.5-reporting-workflows`, from `v2.4.1` (`6d7dacf`).

| Commit | Subject |
|---|---|
| `99047cd` | D-053 — actions no longer invalidate any route; clients refresh themselves |
| `c2ebeeb` | §3 §6 D-054 — unified filter framework; weekly follow-up one source, no manual percentage |
| `0b89744` | §5 §14 §15 — visible programme editing, domain-organised reports page, preview warnings, filter-consistent exports |
| `3339661` | §7 §8 — performance reporting on one result source; evaluation-form deletion controls |
| `a3c2112` | §9 — three distinct council/committee reports, one row per member and per task |
| `9464e57` | docs — partial-scope delivery record, D-053, D-054, PROGRESS, RUNBOOK |
| `2241fa0` | §4 — report builder and saved templates over the existing engine |
| `9636757` | §10 §11 — maintenance and budget filtering, allocation reports |

## 3) The systemic finding — D-053

The most consequential change in this scope is not a feature. Auditing why three v2.4.1
features were reported as "not visible", "does not appear" and "does not complete" led to
**202 `revalidatePath` call sites across 29 files**, every one of which can abort the Server
Action response that the client is still reading.

D-049 (v2.4.1) had already proven the mechanism and fixed two call sites. It could not hold as
a narrow rule because invalidating an *ancestor* path kills the open route's tree too, and
because a single action is reachable from several routes so the call site cannot know which
route is open. Since every page here is `force-dynamic` with no `staleTimes` configured,
revalidation was buying no freshness at all — only the race.

All 202 are removed. Refreshing is now the client's job after the result settles
(`useRefreshOnSuccess`, `useRefreshAfterTransition`), and
`tests/unit/no-revalidate-in-actions.test.ts` pins the rule so it cannot return file by file.

This is very likely the actual cause of the three reported defects. **It has not yet been
confirmed in a browser against a production image** — that confirmation is part of the
clone rehearsal, which has not been run (see §4).

## 4) Scope status, section by section

| § | Item | Status |
|---|---|---|
| 3 | Global filter framework | **Done** — `lib/reports/filters.ts` + `components/report-filters.tsx` |
| 3.2 | URL + session persistence, chips, result count, مسح الفلاتر | **Done** |
| 3.3 | One / several / all everywhere | **Done** for the filters wired so far |
| 3.4 | Export uses the same filters, header lists them | **Done** |
| 4 | Report builder | **Done** — `/reports/builder`, authoring surface over the same catalogue and loaders |
| 4.5 | Saved report templates (+ migration, permissions, audit) | **Done** — `/reports/templates`, migrations 0032/0033, three new permissions, full CRUD audit |
| 5.1 | Programme editing visible before approval | **Done** — header, list rows, approval queue |
| 5.2–5.4 | Edit in every state, warnings, no forced state change, edit history | **Already delivered in v2.4.1**, verified unchanged |
| 5.5–5.6 | Programmes by responsible person / domain, one/several/all, names not counts | **Done** |
| 5.7 | Programme card printing on details, list, registry | **Done** (pre-existing, verified) |
| 6.1 | Weekly follow-up: one source for screen and report | **Done** + parity test |
| 6.2 | Manual percentage removed everywhere | **Done** (D-054) |
| 6.3 | Weekly narrative fields | **Done** (migration 0031) |
| 6.4 | Progress from the programme record only | **Done** |
| 6.5–6.6 | Missing-update marker, weekly filters | **Done** |
| 7.1–7.2 | Performance sections, teacher/administrative filtering | **Done** |
| 7.3 | Individual report workflow with explicit missing-data reasons | **Done** — `/reports/individual` |
| 7.4 | All-employees detailed + statistical | **Partly** — the four-section school-wide report from v2.4.1 stands; new detailed/statistical reports added; the two are not yet merged into one document |
| 7.5 | Low-performance threshold, default 70%, editable, names | **Done** |
| 7.6 | Strengths and weaknesses reporting | **Done** |
| 8 | Deletion workflows | **Partly** — evaluation-form deletion rebuilt on the full delete surface; person/cycle deletion logic was already correct and its UI race is addressed by D-053; **browser verification (§8.4) not performed** |
| 9 | Councils/committees: three reports, no merged cells, meeting registry | **Done** (attendance is not in the data model — stated, not fabricated) |
| 9.5 | Committee card | **Already delivered in v2.4.1** («بطاقة مجلس أو لجنة») |
| 10 | Maintenance/inspection filters and builder domains | **Done** for maintenance (status, category, priority, location, owner, date, approved/issued/open/safety flags). Inspection-level filtering as its own report is **not** added |
| 11 | Budget filters, reports, filter-aware summary cards | **Mostly** — item multi-select, amount range, supplier/invoice search, missing-allocation and overspent flags, plus استغلال المخصصات and بنود بلا مخصص. Summary cards now **declare their scope** but are still not filter-responsive (§11.3) |
| 12 | Mandatory-field reduction | **Mostly** — the policy was already in force from v2.1 §H; audited, and the remaining `required` markers are exactly the safety controls §12.9/§12.10 require. §12.4's "form optional on a cycle" is **not** done: `perf_cycles.model_id` is NOT NULL and a cycle without a form cannot be evaluated at all |
| 13 | Form UX for optional fields | **Mostly** — completeness indicator on the programme and person pages, collapsible optional detail on the weekly form. Not applied to every form |
| 14 | Reports page reorganised by domain, descriptions | **Done** |
| 15 | Selection → filters → count → representative rows → generate, with warnings | **Done** |
| 16 | Permissions review | **Mostly** — one real leak found and fixed (see below); three new permissions designed, granted by migration, and pinned by tests. A full RBAC sweep of every surface is not done |
| 17 | Audit review | **Mostly** — deletion audit extended; template create/update/duplicate/delete audited; report export was already audited. Low-performer export is not separately audited |
| 18 | Database design | **Done for this scope** — migrations 0031 (additive columns), 0032 (report_templates), 0033 (permissions data migration, idempotent, verified) |
| 19 | Unit / integration / E2E | **Mostly** — 949 unit+integration green; the 26 browser scenarios are written (`tests/e2e/zzzz-v250.spec.ts`) but the suite has **not been executed end to end**; the clone rehearsal covers the same ground on the real image |
| 20 | RTL / visual validation at four widths | **Not done** |
| 21 | PDF / CSV / Excel / DOCX validation | **Not done** |
| 22 | Security review | **Not done** as a review; the framework was built allowlist-first and one leak was caught by an existing test |
| 23 | Performance review | **Not done** |
| 24 | Production-clone rehearsal | **Run — 45/48**, one blocking defect (§9) |
| 25 | Documentation | **Partly** — this file, D-053, D-054; `PROGRESS.md`/`RUNBOOK.md` updated |
| 26 | RC image | **Built** — `madrasa-app:0.1.0-v2_5_0-rc` = `sha256:0410fdb3ce9f…`, linux/arm64, commit `f4920a7` |

### Permission leak found and fixed

While adding نتائج الأداء التفصيلية it first declared `performance.read`. The existing
D-048 guard test caught it: a report that shows an employee's **name beside their score** must
declare `performance.individual.read`, or the report centre re-opens what D-013 closed on the
pages. Fixed before commit; the guard test is what makes this class of mistake cheap to catch.

## 5) Migrations

| # | File | Change |
|---|---|---|
| 0031 | `0031_unknown_master_chief.sql` | `program_followups`: `completed_work`, `obstacles`, `required_action`, `next_step`, `evidence_update` (nullable text) + `intervention_needed` (boolean, default false) |
| 0032 | `0032_jittery_mister_sinister.sql` | new table `report_templates` (17 columns, 2 indexes, 3 FKs to `users`) |
| 0033 | `0033_v250_report_builder_permissions.sql` | data migration: inserts `reports.builder`, `reports.templates.share`, `reports.templates.global` and grants them to `principal` and `sysadmin`. Hand-written because the seed service is profile-gated and never runs in production, so a permission added only to `permissionsSeed` would never reach the principal. Idempotent — verified by running it twice against a database holding the roles: 3 permissions, 6 grants, unchanged on the second run |

0031 and 0032 are purely additive: no column dropped, renamed or retyped; no existing row written, deleted or rewritten. 0033 writes only to `permissions` and `role_permissions`, inserting rows that did not exist and never updating or deleting one.
`progress_snapshot` is retained with its historical values and is no longer written or read
(D-054). Ledger would move **31 → 34**, tables **88 → 89**.

Rollback remains image-only for this migration: the older image simply does not use the six
new columns.

## 6) Automated gates

| Gate | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm test` | **949 / 949** across 98 files (was 915 / 95 at the v2.4.1 baseline) |
| `npx drizzle-kit generate` | migration 0031 generated cleanly |
| `npm run test:e2e` | **not run** — no new browser scenarios written |
| `npm run build` | success |

New test files:
- `tests/unit/no-revalidate-in-actions.test.ts` — 6 tests, pins D-053
- `tests/integration/followup-parity.test.ts` — 7 tests, screen/report parity for §6.1
- `tests/integration/committee-reports-v25.test.ts` — 7 tests, §9 no-merged-cells contract
- `tests/integration/report-templates.test.ts` — 11 tests, §4.5 round-trip and §16 template permissions

Rewritten to the new contracts: `followup-weekly.test.ts`, `plan-workflow.test.ts`,
`program-lifecycle.test.ts`, `perf-model-admin.test.ts`, `security-existing-surfaces.test.ts`.

## 7) What must happen before this can be deployed

In order:

1. Finish §11.3 (filter-responsive budget cards) and §12/§13 (optional-field policy).
2. Write and pass the 26 mandatory browser scenarios (§19.3).
3. Build the RC image `madrasa-app:0.1.0-v2_5_0-rc`.
4. Run the production-clone rehearsal (`scripts/v241-final-clone-setup.sh` adapted) — this is
   the only environment that reproduces the D-049/D-053 class of defect, and it is where the
   deletion, programme-edit and individual-report fixes must actually be seen working.
5. Rollback rehearsal, security review, performance review, RTL/visual audit, export audit.
6. Update `RUNBOOK.md` with the deployment sequence and tag `v2.5.0`.

## 8) Known limitations recorded, not worked around

- **Meeting attendance is not modelled.** `meetings` has no attendees/absentees/quorum
  fields — the schema says so explicitly. §9.6's attendance columns are therefore absent from
  the meeting registry rather than fabricated.
- **Decision owner / target date / execution status** come from the linked `action_tasks`
  row. A decision never converted to a task has none, and the report shows them empty.
- **Legacy weekly statuses** are normalised on read, not rewritten. A direct database query
  still sees «في المسار» on historical rows; the UI and reports show «قيد التنفيذ».
- **`progress_snapshot`** still holds historical percentages. It is deliberately unread; any
  future report wanting it must state that it is historical and not current truth.

---

# 9) Production-clone rehearsal (§24) — RUN, **45 / 48 PASS**, one blocking defect

Run on **2026-08-05** against `madrasa-app:0.1.0-v2_5_0-rc`
(`sha256:0410fdb3ce9f8d727e9e923f39a2bea6af3c2bf16fd00898a822fb0ce2796ddc`, linux/arm64,
commit `f4920a7`) on a disposable clone of the live production database
(30 programmes / 54 people / 4 committees / 6 cycles / 5 maintenance issues).

Harness: `scripts/v250-clone-setup.sh` + `scripts/v250-clone-rehearsal.mjs`.

## 9.1 What passed

- Migration on real production data: **ledger 31 → 34, tables 88 → 89**, all six new
  `program_followups` columns **empty on every existing row**, the three new permissions
  created and granted (6 role grants).
- «تعديل البرنامج» visible in the programme header; the link opens the editor directly; the
  edit saves, the success message appears, the programme's status/completion/closure are
  unchanged, and the change is recorded in `program_edit_history`.
- Weekly follow-up carries **no percentage field**; progress is labelled with its source;
  recording a follow-up shows its success message and does not touch programme progress.
- Screen and report agree exactly: **11 = 11**.
- One domain / two domains / all: **7 → 12 → 27**, with the active-filter chip shown and
  programme names (not counts) in the table.
- Committee registry carries العضو | الصفة | المهمة | حالة التنفيذ with each committee's rows
  contiguous; meeting registry carries number, agenda, decisions, recommendations.
- Teachers-only and administrative-only filters; individual-report workflow; low-performer
  threshold editable and stated.
- Report builder opens, previews, saves a template, re-runs it, and audits the creation.
- Evaluation-form deletion completes in the database and writes its tombstone.
- CSV (1 623 B) and PDF (49 270 B, valid `%PDF-` header) export with the active filter.
- **Production untouched** throughout: `RestartCount 0` and an unchanged `StartedAt` before,
  during and after; the clone was destroyed afterwards.

## 9.2 The blocking defect — D-053 is **not fully closed**

**Symptom.** After a successful permanent delete of an evaluation form, the browser stays on
the deleted record's page. The row is gone from the database and the tombstone is written, but
the user is left on a dead URL. §8.2 requires navigating to a valid destination.

**Evidence.** `net::ERR_ABORTED` on the Server-Action POST for two flows on the RC image:

```
POST /performance/models/<id>        net::ERR_ABORTED   ← delete: commits, no redirect
POST /plan/<id>?تعديل=1              net::ERR_ABORTED   ← edit: commits, message DOES appear
```

**Reading.** The abort lands *after* the client has consumed the returned value — success
messages appear and writes land — so what is lost is the **tail** of the stream. For an action
whose tail carries a `redirect()`, that redirect is destroyed. This is the same class as D-049,
with a different trigger: removing `revalidatePath` fixed the writes-without-feedback symptom
(confirmed above), but a client-side refresh still races the tail of redirect-bearing actions.

**Status.** Not diagnosed to root cause and **not fixed**. It must be resolved and re-rehearsed
before deployment. Two candidate directions, neither verified: (a) redirect-ending actions
should return state and let the client navigate, rather than redirecting server-side; (b) the
refresh hooks should not fire while a navigation is pending.

**Scope of impact.** Every action ending in `redirect()`: permanent deletion of an evaluation
form, a performance cycle and an employee; template save; import upload. The data is always
correct; the navigation is not.

## 9.3 Third failure — rehearsal bookkeeping, not data loss

The `programs` fingerprint differs by one row after the run. The cause is known and benign: the
rehearsal's own programme-edit step writes to a production-copied row and the restore does not
reset every touched column (`version` increments alongside `updated_at`). No other table drifts
and all row counts are unchanged. The correct fix is for the destructive steps to seed their own
disposable programme instead of editing a copied one — a harness change, not a product one.

## 9.4 Three harness bugs found and fixed during the run

Recorded because they nearly produced false confidence in both directions:

1. `replace(/\D/g, "")` on «عدد النتائج: ٢٧» returned an empty string — the UI renders
   Arabic-Indic digits under `ar-SA`, so every filter count read as zero and the filter steps
   "failed" while the page was correct.
2. The programme page has **five** inputs named `reason` (archive, reopen, change request,
   execution update, edit). `.first()` filled the wrong form, so the edit action correctly
   answered «السبب إلزامي» and the step looked like a product defect.
3. `page.request.get()` does not carry the browser session, so export checks returned 401.
   Exports are now downloaded by clicking the link, as a user does.
