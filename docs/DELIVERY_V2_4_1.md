# DELIVERY v2.4.1 — data-correction release (post-v2.4.0)

> Decisions: D-046…D-052 (`docs/DECISIONS.md`) · Branch `scope-v2.4.1-data-correction`
> (base `c5d13f8` = deployed v2.4.0) · **NOT deployed — production is still on v2.4.0.**
>
> **§17 onward covers the final consolidated corrective scope** added after this document
> was first written (permanent lifecycle deletion, program editing in every state,
> maintenance-first inspection, report content). Sections 1–16 describe the data-correction
> release as delivered earlier; where the two differ, §17 onward is authoritative.

## 1) Executive verdict

**READY FOR DEPLOYMENT** — pending explicit owner authorization.

Every §11 condition is met with evidence: the discoverability audit passes through the real
navigation shell, 15 principal-role browser scenarios pass, RTL/visual passes at four
widths, every required PDF/export passes, no unresolved High/Critical security finding
remains, performance is measured on the production image against cloned production data,
every automated gate is green, the RC image is built and verified end to end, the
production-clone rehearsal passes 42/42, rollback needs no database action, and production
was never touched.

The rehearsal found and fixed a defect that **every earlier gate had missed and that the
currently-deployed v2.4.0 still carries** (D-049 — see §6).

## 2) What this release is for

v2.4.0 deployed correctly but the principal reported that nothing had changed. The v2.4
investigation established that the release identity was clean and that the real causes were
three **data** preconditions in production, which the code could not fix retroactively.
Measured on production at the start of this work (read-only):

| Precondition | Production value |
| --- | --- |
| `financial_items.allocated_amount IS NULL` | **2 of 4** items — المستلزمات، النشاط |
| Programs with contradictory execution state | **4** live records (متابعة الأداء المبنية على البيانات · التطوير المهني بالأثر · رياضيات الإتقان · اليوم الوطني) |
| `committee_task_assignments.status IS NULL` | **31 of 31** |
| Committees with zero tasks | **2** — اللجنة الإدارية للمدرسة، لجنة التوجيه والإرشاد |

v2.4.1 gives the principal a visible, audited workflow for each, and **fabricates nothing**.

## 3) Implemented changes

**Phases A–E** (`d790ab0`) — architecture decision D-046, budget allocation states, program
consistency review (D-047), committee task messaging, release identity marker.

**Phase F** (`33a98a0`) — discoverability, browser validation, security hardening:
- Sidebar entry renamed to «مراجعة حالات برامج الخطة» with a rendered description.
- `/budget` item table no longer prints a bare «—»: «غير محدد» +
  «لا يمكن احتسابه قبل تحديد المخصص» + a «تحديد المخصص» action on the row + a named summary
  line listing every unallocated item.
- «طباعة بطاقة البرنامج» — the exact requested label — on the program page and the /plan row.
- Homepage approval queue keeps its section when empty and states
  «لا توجد برامج بانتظار الاعتماد حاليا».
- «سجل اللجان العام» vs «سجل المجالس واللجان التفصيلي» disambiguated, the detailed one
  recommended in its description.
- «تقرير تفصيلي للموظف» / «تقرير تفصيلي للمدرسة» renamed to the requested labels and
  announced from the /performance root.
- `/performance/models` states where «حذف النموذج» / «أرشفة النموذج» live and why.

**Phase G** (`8216264`, `08b65b5`, `bdbd02a`) — D-049, found only on the clone: see §6.

## 4) Discoverability audit (§1)

| Requirement | Result |
| --- | --- |
| Budget: تحديد المخصص · allocated · spent · remaining · explanation · post-save remaining | **PASS** (card, table row and item page) |
| Sidebar «مراجعة حالات برامج الخطة» + description | **PASS** |
| Weekly follow-up «حالة البرنامج تحتاج مراجعة» linked to the review screen | **PASS** |
| «البرامج حسب المسؤول» / «البرامج حسب المجال» with program names | **PASS** (27 named rows on the clone) |
| «طباعة بطاقة البرنامج» on details + list | **PASS** |
| Homepage «بانتظار اعتماد المدير» with an empty state | **PASS** |
| «سجل اللجان العام» vs «سجل المجالس واللجان التفصيلي» | **PASS** |
| «حذف النموذج» (unused) / «أرشفة النموذج» (used), not hidden in a menu | **PASS** |
| «تقرير تفصيلي للموظف» / «تقرير تفصيلي للمدرسة» | **PASS** |
| «الإصدار 2.4.1» in the shell | **PASS** |

Pinned against regression by `tests/unit/discoverability.test.ts` (15 assertions) and proved
visible in the browser by `tests/e2e/zz-v241.spec.ts`.

## 5) Phase F — browser validation (§2-§4)

- **E2E:** `tests/e2e/zz-v241.spec.ts` — 15 scenarios + a route warm-up, all passing.
  Driven through the sidebar as the principal, with Postgres, Arabic RTL and the production
  PDF engine. It seeds the six contradictory program shapes the application refuses to
  create by design, and runs last in the suite (`zz-` prefix) so no other spec sees them.
- **RTL/visual:** `scripts/v241-visual-audit.mjs` — 1366×768, 1440×900, 1024×768, 360×740 ×
  12 surfaces = **52/52 PASS**. Zero page-level horizontal overflow, zero clipped text, zero
  overlapping controls, `dir=rtl` everywhere, first sidebar link focusable at every width.
  Destructive «حذف النموذج» measured at red-700 on white (L\*≈40 → ≈5.9:1, AA) with a
  38px target; «أرشفة النموذج» is deliberately neutral because archiving is reversible.
  48 screenshots under `storage-e2e/visual-audit/`.
- **PDF/export:** `scripts/v241-pdf-audit.ts` — **15/15 PASS** through the real issuance
  pipeline: program card, program report, detailed committee registry (5 pages, includes the
  labelled empty-tasks section), committee report, individual employee performance, school
  performance, maintenance letter, five CSVs and a DOCX. Each PDF verified for `%PDF-`, page
  count, a non-blank last page, extractable Arabic density and a printed document number.
  Arabic *content* is asserted against the stored `html_snapshot` because `pdftotext`
  returns Arabic in visual order and decomposes lam-alef ligatures (CLAUDE.md).
  Samples under `storage-e2e/pdf-audit/` (git-ignored — they contain school data).

## 6) D-049 — the defect the clone rehearsal found

Everything above passed on `next dev`. On the **RC image against cloned production data**,
saving an expense wrote the row and displayed nothing, and setting one committee task status
left every dropdown on the page disabled until a manual reload.

Root cause: `revalidatePath()` for the route the user is currently on makes the client
router refetch it, cancelling the still-streaming Server-Action response before the returned
value is consumed. Proven by an A/B of two production images differing only in that one
line — and **reproduced identically on the deployed v2.4.0 image**, so it is pre-existing.

This is the «الواجهة لا تتحدث بعد الحفظ» complaint from v2.2.1 and what v2.3 filed as an
environment quirk. Full analysis and the rule in D-049.

Fixed by: actions no longer revalidate their own route; the client refreshes after the
result settles (`useRefreshOnSuccess`); `router.refresh()` runs after `isPending` clears, not
inside the transition; and no form is unmounted while its action is in flight
(`useResetOnSuccess` replaced nine `key={state?.success}` forms).

Measured after the fix, on the clone: «تم حفظ المصروف — المتبقي بعد العملية: ٧٩٩٫٧٥ ريال»
appears in place, and three consecutive committee status changes need no reload, the list
re-enabling 1s after each.

## 7) Security review (§5)

| # | Finding | Severity | Disposition |
| --- | --- | --- | --- |
| D-048 | `perf-evaluations` exposed a named employee's `sessionResult` under `performance.read`, which `sysadmin` holds while D-013 denies them `performance.individual.read` | **High** | **Fixed** — raised to `performance.individual.read`; a unit test now fails any report pairing a named person with a result column unless it declares that permission |
| — | New money paths used raw float subtraction, bypassing D-043 (100.10 − 0.20 read as 99.90000000000001) | Medium | **Fixed** — `moneySubtract` in the allocation audit/message, the expense result and the client preview |
| — | Unbounded `numeric` accepted 1e30, corrupting every total and printed report | Medium | **Fixed** — `MAX_MONEY_AMOUNT` = 10¹² on every money input (chosen so ×100 stays an exact integer in `Number`) |
| — | The general item-edit form bypassed the allocation-below-spend confirmation and logged no spent-at-change | Medium | **Fixed** — same guard and audit detail on both paths |
| — | Bulk correction accepted forged / archived program ids the review screen never offered | Medium | **Fixed** — UUID-filtered, de-duplicated, archived excluded, 200-record cap, mismatch reported instead of partially applied |
| — | Actions taking an id from the client returned a Postgres syntax error for a forged id | Low | **Fixed** — `isUuid` guards on budget item, committee task and program correction actions |
| — | `completedAt` correction accepted any parseable date (year 9999) | Low | **Fixed** — `YYYY-MM-DD` within 2000–2100 |
| — | A `budget.write` holder can send `confirmBelowSpent=1` directly and skip the warning | Low | **Accepted** — the confirmation is a safety prompt, not an authorization boundary; the outcome is audited with `confirmedBelowSpent: true` |
| — | Committee task status can be recorded on a closed committee | Low | **Accepted by design** — recording a true historical status on a closed committee is exactly the correction workflow this release exists for, and it is audited |

Also verified: reports export re-checks the report's own permission server-side, whitelists
columns and sort keys, runs every cell through `sanitizeCell`, uses `safeFileName`, sets
`no-store`, audits every export, and never returns a database error to the browser. Every
report generator escapes interpolations (`esc`). `/api/health` returns version, commit and
environment only — asserted to contain no connection string, secret, token or filesystem
path.

## 8) Performance review (§6)

Measured on the RC image against cloned production data (median of 3, after warm-up):

| Route | TTFB | Load |
| --- | --- | --- |
| `/dashboard` (incl. approval queue) | 14 ms | 107 ms |
| `/budget` | 10 ms | 33 ms |
| `/plan/consistency` | 16 ms | 36 ms |
| `/plan/followup` | 18 ms | 45 ms |
| `/committees` | 18 ms | 37 ms |
| `/performance/analytics` | 19 ms | 48 ms |
| `/reports?report=programs-by-owner` | 13 ms | 51 ms |
| `/reports?report=committee-members` | 14 ms | 32 ms |
| `/budget/items/[id]` | 16 ms | 35 ms |

Query shapes: `/plan/consistency` = 3 batched queries (programs, owner names, grouped
evidence counts) with the consistency check a pure O(1) function per row — no N+1.
`/budget` = 3 parallel queries + 2 invoice-flag batches + 2 id-batched lookups.
`/plan/followup` reads only the selected and previous week. The committee registry generator
loops committees with bounded queries (4 in production) — unchanged from v2.4 and acceptable
at school scale. **No index and no migration are justified by this evidence; the ledger
stays at 29.**

## 9) Automated gates (§7)

| Gate | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 errors |
| `npm test` (vitest) | **806 / 806** (771 at Phase E → +35) |
| `npm run test:e2e` (Playwright) | **92 passed / 1 skipped / 0 failed** (4.7 min) |
| `npm run build` | ✓ |
| `npx drizzle-kit check` | clean, no drift |
| Report/route coverage guard | `report-coverage.test.ts` green |
| PDF runtime probe | `PDF-OK %PDF-` inside the RC image |

The single skip is the standing C5 real-HTTPS camera gate (D-018), deferred by the product
owner since v1.

**A note on the Playwright run.** A first full run against a cold `next dev` produced 14
failures; 13 were cold-compile timeouts that pass on a warm server (the same specs complete
24× faster), and one was real drift: `workflows.spec.ts` still asserted the pre-v2.4.1
expense message «أُضيف المصروف». It was updated to the v2.4.1 result-bearing message.

## 10) Migrations

**None.** No schema change in this release. Ledger stays at **29**, tables at **86** — the
v2.4.0 production baseline, confirmed unchanged on the clone before and after the rehearsal.
Per §10 of the brief, no migration guesses a business value: the 31 NULL committee statuses
and the 2 NULL allocations stay as they are until the principal sets them.

## 11) Production-clone rehearsal (§8) — PASS 42/42

- Read-only `pg_dump` of `madrasa-prod-db-1`; production containers never touched
  (RestartCount 0 throughout, uptime unbroken, `audit_log` still 540 and the D-022 program
  fingerprint `ff753b94d10cc9ab16d35b56641c5fbc` unchanged at the end).
- Isolated Docker network, isolated Postgres container, isolated volume, isolated copy of
  the uploads volume (89 files, digest `8b73a584954fbe1349d0beed8d040775` — byte-identical),
  a known principal-equivalent test account, port 127.0.0.1:3085 (no production conflict).
- **Baseline parity:** 26 anchors including 5 content fingerprints compared clone vs
  production — **identical** (the only difference being the added test account).
- **Workflows:** all fifteen exercised on real production data — allocation set on
  المستلزمات, expense added with an exact halala remainder, below-spend guard rejected
  server-side, «اليوم الوطني» corrected (approval and closure byte-identical before/after,
  snapshot + audit written), consistency queue 4 → 3, weekly follow-up truthful, three
  committee statuses set with no reload (31 → 29 NULL), a task added to a no-task committee,
  an unused evaluation form deleted, a used one archived and restored, all required reports
  issued (documents 36 → 38), the homepage queue visible, every write audited, release
  identity correct, and **ledger 29 / tables 86 unchanged**.
- Clone, volumes, network, plaintext dump and temporary credentials all destroyed after
  evidence capture.

## 12) RC image

**`madrasa-app:0.1.0-v2_4_1-rc` = `sha256:b2f9b613fd07cd55dd7d4db05d0462ada26a6faec095009fead15be40698f1ce`**
(linux/arm64, `Dockerfile.production`, `RELEASE_COMMIT=a8e1cf3`). Commits after `a8e1cf3` on this branch
are documentation only — `git diff a8e1cf3..HEAD --stat` touches no source file, so the
image is the tree that ships.

Verified: `/api/health` → `{"status":"ok","db":"up","version":"2.4.1","commit":"a8e1cf3","environment":"production"}`;
in-container Chromium probe → `PDF-OK`; Playwright browser build **chromium-1228**
matching the locked 1.61.1 (the v2.3 PDF-500 invariant holds); **29** migration files;
`src/lib/ai` absent (D-035); boots against the clone with no migration and no AI dependency.

`Dockerfile.production` gained `ARG/ENV RELEASE_COMMIT` so the image identifies itself in
`/api/health` without depending on a deploy-time variable someone might forget.

## 13) Rollback rehearsal — PASS, no database action

The v2.4.0 image (`madrasa-app:v2.4.0` = `2f69c724c625…`) was started against the **same
clone after v2.4.1 had written to it**: health ok, login ok, all records visible (including
the programs, allocations, committee tasks and documents v2.4.1 created), reports render,
a stored upload serves (HTTP 200, 62 KB PDF). The version marker is absent, as expected —
it is a v2.4.1 feature. The only database change from running it was `audit_log` +1 (the
login event). **Rollback is app-only; no migration to reverse, no data to restore.** The RC
was then restored and re-verified on the same clone.

## 14) Known limitations

- **D-049 sweep is partial.** The rule is applied to the actions this release touches
  (budget, budget items, plan consistency, committee tasks). Other actions elsewhere still
  revalidate their own route and can show the same staleness after a save. Sweeping the rest
  of the app is follow-up work, deliberately not done inside a corrective release.
- **D-014** remains an open, documented ministry-source conflict (3 weight cells) for the
  principal to reconcile against نظام فارس at the first real evaluation cycle.
- Permanent deletion of *used* evaluation forms remains intentionally unimplemented (D-041).
- Committee «results/impact» remains a read-only historical table (v2.1 §G3).
- `plan_budget_items` stays plan-year reference only and is never merged into
  `financial_items` (D-046).
- Tailscale Serve (HTTPS) is still not enabled — a tailnet-wide admin action outside the
  agent's reach; LAN access remains temporary plain HTTP.
- Report samples and screenshots live under git-ignored `storage-e2e/` because they contain
  school data.

## 15) Values that still require the principal (the system must not invent them)

| What | Where | Current production state |
| --- | --- | --- |
| Allocation for **المستلزمات** and **النشاط** | `/budget` → «تحديد المخصص» | both `NULL` |
| Correct operational state for **اليوم الوطني**, **متابعة الأداء المبنية على البيانات**, **التطوير المهني بالأثر** (and **رياضيات الإتقان**) | `/plan/consistency` | «مكتمل» with progress 0% and/or no completion date |
| Actual status of the **31 committee tasks** | committee page → «حالة تنفيذ المهمة» | all `NULL` |
| Missing tasks for **اللجنة الإدارية للمدرسة** and **لجنة التوجيه والإرشاد** | committee page → «إضافة مهمة» | zero tasks each |

The release provides the workflow, the explanation and the audit trail for each. It supplies
no value on the principal's behalf.

## 16) Deliverables

- Commits on `scope-v2.4.1-data-correction` (base `c5d13f8`): `d790ab0` (A–E),
  `33a98a0` (F), `8216264` + `08b65b5` + `bdbd02a` (G / D-049), plus this document.
- Proposed annotated tag **`v2.4.1`** — *not created*: this project's convention is to tag at
  deployment, after the principal's acceptance (v2.2/v2.3 followed the same rule).
- Production image tag `madrasa-app:0.1.0` was **not** moved. Production remains v2.4.0.

---

# 17) Final consolidated corrective scope (2026-08-04)

Added on top of everything above, from the principal's confirmed requirements. Decisions
**D-050 · D-051 · D-052**. Base commit for this phase: `c33a347` (the previously READY tree).

## 17.1 Executive verdict

**READY FOR DEPLOYMENT** — pending explicit owner authorization. Production was never
touched at any point in this phase.

Two defects were found by the new gates and fixed before the RC. Both would have shipped:

1. **Every program edit would have been rejected as stale.** The concurrency guard compared
   a JavaScript `Date` (millisecond precision) with a Postgres `timestamptz` (microsecond
   precision); the equality never matched. Caught by the state-matrix integration test, not
   by typecheck, lint, or review. Fixed by truncating both sides to milliseconds in SQL.
2. **A rejected save silently erased everything the principal had typed.** React 19 resets
   an uncontrolled form after its `action` completes — *including when the action returns an
   error*. With a mandatory reason after approval, the first save without a reason wiped all
   25 fields back to their stored values, and the second save then reported
   «لا تغييرات لحفظها». Only visible in a real browser. Fixed by making the edit form
   controlled; the browser scenario now asserts the typed value survives the rejection.

A third issue was closed during the security review: `actionableFindings` was exported from
a `"use server"` module, which makes it a **public endpoint** callable with any inspection
id and no permission check. It is now module-private.

## 17.2 What was built

| § | Requirement | Where |
| --- | --- | --- |
| 1.1 | Remaining across the live financial workflow; top cards show allocated / spent / remaining / **spending percentage**; missing allocation explained, never `—` | `lib/finance/calc.ts`, `lib/finance/allocation.ts`, `/budget`, expense reports |
| 1.2 | «إجراء فحص» inside maintenance; one **separate** report per actionable finding; duplicate prevention; approve → print → PDF | `/building/maintenance/inspect`, `lib/building/maintenance-report.ts`, migration 0030 |
| 1.3 | «حذف الموظف نهائياً» and «حذف دورة الأداء» with full safeguards and audit tombstone | `lib/lifecycle-delete.ts`, `components/permanent-delete.tsx`, migration 0029 |
| 1.4 | «تقرير تفصيلي للمعلم» and «تقرير تفصيلي وإحصائي للجميع» with the required content and four-section structure | `lib/reports/performance-reports.ts`, `lib/performance/report-labels.ts` |
| 1.5 | «سجل المجالس واللجان التفصيلي» and «بطاقة مجلس أو لجنة»; member-per-row layout | `lib/reports/committee-report.ts`, `lib/committees/report-labels.ts` |
| 1.6 | Program editing in **every** lifecycle state, warnings without blocking, mandatory reason, full change history | `lib/plan/program-edit.ts`, `updateProgramAction`, migration 0029 |

## 17.3 Budget (§1.1)

Top summary now carries four money/percentage cards. When **no item has an allocation**,
`hasAnyAllocation` is false and the cards say «غير محدد» with
«لا يمكن احتساب المتبقي قبل تحديد المخصص لأي بند» instead of a zero that reads as
"nothing left". `spentPercent` is `null` rather than `0` when there is no denominator.

The expense-entry screen shows «الرصيد قبل العملية» and «الرصيد بعد العملية» live, or the
two required Arabic explanations plus the corrective action when the item has no allocation.
`expense-register` and `all-operations` gained a **balance-before** column; the item
allocations report no longer labels an unallocated item «ضمن المخصص».

`REMAINING_UNAVAILABLE` was changed to the principal's exact wording,
«لا يمكن احتساب المتبقي قبل تحديد المخصص».

`financial_items` remains the authoritative live registry; nothing is copied from
`plan_budget_items`, and `NULL` is never treated as zero (D-046 unchanged).

## 17.4 Inspection → maintenance (§1.2)

The conversion existed since v2.4; what was missing was that running an inspection lived
outside maintenance. `/building/maintenance/inspect` now hosts the whole flow, reachable by
clicking «إجراء فحص» from the maintenance page — the room page keeps its entry point as a
second, field-facing path.

- Result message states the count with correct Arabic number agreement
  («تم تسجيل 3 ملاحظات تحتاج إلى صيانة», «ملاحظة واحدة», «ملاحظتين»).
- Four explicit paths after saving: «إنشاء البلاغات المحددة» · «إنشاء بلاغ منفصل لكل ملاحظة»
  · «مراجعة قبل الإنشاء» · «تخطي الآن».
- **One finding = one report.** Verified in integration (three findings → three issues with
  distinct codes, each linked bidirectionally to its own finding) and in the browser.
- Duplicate prevention is per finding and shown inline with a link to the existing open
  report; a closed report allows re-reporting the same item.
- Report content: official header, number, date, location, category, priority, source
  finding, description, safety impact, operational impact, requested action, attachments,
  approval and an always-printed signature block. The four new fields (migration 0030) are
  optional; a report created from a finding fills safety impact and requested action by
  restating the finding's recorded severity, and leaves category empty for a human.

## 17.5 Permanent deletion (§1.3) — design and evidence

Design and the full owned/shared table: **D-050** and `docs/DELETION_RUNBOOK.md`.

Evidence (`tests/integration/lifecycle-delete.test.ts`, 11 tests, all passing) against a
seeded employee with two cycles, sessions, ratings, an improvement plan, an issued document,
one exclusive and one shared evidence item, plus committee membership, program and activity
ownership, a task, a maintenance issue and an expense:

| Assertion | Result |
| --- | --- |
| Impact preview counts exact per type | PASS |
| Owned lifecycle fully erased | PASS |
| Committee preserved, membership removed, its task kept but unassigned | PASS |
| Program / activity / task / maintenance / expense preserved with the reference nulled | PASS |
| Linked login account deactivated + unlinked, not deleted | PASS |
| Shared evidence kept with its other link; exclusive evidence removed | PASS |
| Another employee and their cycle untouched | PASS |
| No orphan rows in any of the 10 columns referencing `people` | PASS |
| Forced failure mid-transaction → full rollback, no tombstone | PASS |
| Tombstone written; serialised row contains no seeded evaluation text | PASS |
| Wrong typed name / short reason / self-delete / last privileged account → refused | PASS |
| Orphan file deleted from disk; file still referenced by a meeting attachment kept | PASS |

Cycle deletion (§5.4) is verified separately: the selected cycle and its dependents go, the
employee and the other cycle remain byte-identical, institutional links are untouched, and
the tombstone records the cycle.

## 17.6 Program editing in every state (§1.6)

`tests/integration/program-edit-states.test.ts` runs the full matrix — draft, awaiting
approval, approved, in progress, completed, closed — 23 tests, all passing:

- Edit accepted in **all six** states.
- Reason mandatory in the four post-draft states; optional in the two draft states.
- Old and new values stored per field with actor, timestamp, approval status and lifecycle
  at edit time, and the reason.
- `status`, `approvedAt`, `completedAt`, `closedAt`, `archivedAt` unchanged after every edit.
- The «تم تعديل البرنامج بعد الاعتماد» marker derives from the history, so it cannot disagree
  with it.
- A forged `field_status` / `field_approvedAt` / `field_closedAt` is ignored.
- Non-numeric or negative budget refused; invalid/unknown program id returns Arabic text.
- Stale-token concurrency: of two saves from the same opened form, exactly one applies.

Closed programs also accept execution-progress correction with a mandatory reason, recorded
in the same history — the closure is never lifted implicitly. Two legacy tests that asserted
the old blocking behaviour were rewritten to the new contract, with the reason recorded in
the test itself.

## 17.7 Performance and committee reporting (§1.4, §1.5)

The school-wide report is restructured into the four required sections: executive statistical
summary (total employees, completed/incomplete, school average, distribution, per-category
and per-model averages), strength/weakness analysis (per-criterion averages, strongest and
weakest, **recurring strengths** alongside recurring weaknesses), training and development
recommendations derived from the weak criteria themselves, and a named detailed appendix.

The individual report gained a final band and a signature block. The band comes from the
platform's own distribution buckets — no invented verbal grade; a test asserts that
«ممتاز/جيد/ضعيف» never appear.

Labels adopt the principal's wording. The individual label follows employee type
(«تقرير تفصيلي للمعلم» / «تقرير تفصيلي للموظف»), because the register holds administrative
staff too (D-019) and calling one a «معلم» would be false.

The committee registry already produced a section per committee with one row per member;
this scope adopts the requested header («العضو | الصفة | المهمة | حالة التنفيذ»), renames the
single-committee document to «بطاقة مجلس أو لجنة», and states explicitly that a task due date
is not held by the data model rather than printing an empty column.

## 17.8 Discoverability (Phase B)

All fourteen required labels exist and are reachable by clicking through the normal shell.
`tests/unit/discoverability.test.ts` pins each one to the specific page that must carry it,
so a later refactor cannot rename an entry point back into obscurity, and the browser
scenarios reach each surface by navigation, never by typing a URL.

## 17.9 Gates

| Gate | Result |
| --- | --- |
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm test` | **909 / 909** across 94 files (was 806 / 88) |
| `npm run test:e2e` | see §17.11 |
| `npm run build` | success |
| `npx drizzle-kit check` | clean |

New automated coverage: `program-edit.test.ts`, `maintenance-report.test.ts`,
`performance-report-labels.test.ts`, finance-summary cases, `lifecycle-delete.test.ts` (11),
`program-edit-states.test.ts` (23), `maintenance-inspection.test.ts` (10),
`v241-final-security.test.ts` (10), and browser spec `zzz-v241-final.spec.ts` (9).

## 17.10 Security review (§6)

| Area | Finding | Status |
| --- | --- | --- |
| Public server-action surface | `actionableFindings` exported from a `"use server"` module = unauthenticated endpoint | **Fixed** — made module-private |
| Privilege bypass | Deletion requires `performance.individual.read`, which `sysadmin` lacks (D-013) | Enforced + tested |
| Mass assignment | Program edit reads a field whitelist; maintenance report edit reads four named fields; category validated against a closed list | Enforced + tested |
| IDOR / forged ids | `isUuid` guards, and selected findings must belong to the named inspection | Enforced + tested |
| Unsafe cascade / orphans | Explicit per-table handling; orphan sweep test over 10 columns | Enforced + tested |
| Self-deletion / last admin | Blocked with Arabic explanation | Enforced + tested |
| Typed confirmation / reason bypass | Compared server-side; whitespace tolerated, difference refused | Enforced + tested |
| Partial deletion | Single transaction; forced-failure rollback test | Enforced + tested |
| Audit tampering / sensitive tombstone | Append-only; serialised tombstone asserted free of evaluation content | Enforced + tested |
| File remnants / report cleanup | Deleted only when unreferenced across 12 FK columns + 2 jsonb arrays; disk removal after commit | Enforced + tested |
| Path traversal | File deletion goes through the existing `safeResolve` guard | Unchanged |
| Stored XSS | Malicious strings in the new report fields are escaped and preserved, not executed | Tested |
| CSRF | Server Actions (framework-level) and `requireCsrf` on route handlers | Unchanged |
| Replayed destructive request | Second attempt returns «المنسوب غير موجود»; exactly one tombstone | Tested |
| Concurrent program edits | Atomic `updated_at` predicate; one winner | Tested |

**No unresolved High or Critical finding.**

## 17.11 Migrations

Two, both purely additive; ledger **29 → 31**.

| # | File | Change |
| --- | --- | --- |
| 0029 | `0029_condemned_sugar_man.sql` | `deletion_tombstones`, `program_edit_history` (new tables, 3 indexes, 3 FKs) |
| 0030 | `0030_bent_leo.sql` | `maintenance_issues.category / safety_impact / operational_impact / requested_action` (4 nullable columns) |

No column is dropped, renamed or retyped; no row is written, deleted or rewritten; no
default backfills existing data. Rollback to v2.4.0 needs **no database action** — the new
tables and columns are simply unused by the older image.
