# DELIVERY v2.5.0 — reporting, filtering, workflow and data-entry scope

> Work record for the v2.5.0 scope on branch `scope-v2.5-reporting-workflows`, continuing
> from the deployed baseline v2.4.1 (`docs/DEPLOYMENT_V2_4_1.md`). Decisions **D-053** and
> **D-054** in `docs/DECISIONS.md`.

## 1) Executive verdict

**NOT READY FOR DEPLOYMENT — partial scope delivered.**

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
| 12 | Mandatory-field reduction | **Not started** (much of it already holds from v2.1 §H, but not reviewed field by field) |
| 13 | Form UX for optional fields | **Partly** — applied to the new weekly follow-up form only |
| 14 | Reports page reorganised by domain, descriptions | **Done** |
| 15 | Selection → filters → count → representative rows → generate, with warnings | **Done** |
| 16 | Permissions review | **Mostly** — one real leak found and fixed (see below); three new permissions designed, granted by migration, and pinned by tests. A full RBAC sweep of every surface is not done |
| 17 | Audit review | **Mostly** — deletion audit extended; template create/update/duplicate/delete audited; report export was already audited. Low-performer export is not separately audited |
| 18 | Database design | **Done for this scope** — migrations 0031 (additive columns), 0032 (report_templates), 0033 (permissions data migration, idempotent, verified) |
| 19 | Unit / integration / E2E | **Partly** — 949 unit+integration green, 27 new; **none of the 26 mandatory browser scenarios written** |
| 20 | RTL / visual validation at four widths | **Not done** |
| 21 | PDF / CSV / Excel / DOCX validation | **Not done** |
| 22 | Security review | **Not done** as a review; the framework was built allowlist-first and one leak was caught by an existing test |
| 23 | Performance review | **Not done** |
| 24 | Production-clone rehearsal | **Not done** |
| 25 | Documentation | **Partly** — this file, D-053, D-054; `PROGRESS.md`/`RUNBOOK.md` updated |
| 26 | RC image | **Not built** |

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
| `npm run build` | **not run** |

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
