# DELIVERY v2.4.1 — data-correction release (post-v2.4.0)

> Decisions: D-046…D-049 (`docs/DECISIONS.md`) · Branch `scope-v2.4.1-data-correction`
> (base `c5d13f8` = deployed v2.4.0) · **NOT deployed — production is still on v2.4.0.**

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

**`madrasa-app:0.1.0-v2_4_1-rc` = `sha256:a7550df8434baab39ff34dbadb70ea58cdd598018841834ab15294662a887354`**
(linux/arm64, `Dockerfile.production`, `RELEASE_COMMIT=bdbd02a`).

Verified: `/api/health` → `{"status":"ok","db":"up","version":"2.4.1","commit":"bdbd02a","environment":"production"}`;
in-container Chromium probe → `PDF-OK %PDF-`; Playwright browser build **chromium-1228**
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
