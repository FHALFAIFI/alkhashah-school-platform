# DELIVERY v2.4.0 — post-acceptance corrective release (round 6)

> Brief: `docs/BRIEF_V2_4_0.md` · Change map + root causes: `docs/SCOPE_IMPACT_V2_4.md` ·
> Decisions: D-041…D-045 (`docs/DECISIONS.md`) · Branch `scope-v2.4-post-acceptance`
> (base `b47558c` = deployed v2.3.0). **Production untouched** — rehearsal on an isolated
> clone only; deployment awaits explicit owner authorization.

## 1) Executive verdict

**READY** — for controlled deployment after explicit owner authorization. All 22 §24
acceptance criteria demonstrated with evidence: every automated gate green (typecheck 0,
lint 0, **vitest 738/738**, production build, **Playwright 76 passed / 1 standing skip
(C5, D-018) / 0 failed**), production-clone rehearsal byte-exact, RC image verified
end-to-end (including the Chromium/PDF invariant from the v2.3 incident), rollback
requiring no DB action, and no unresolved High/Critical security findings (one
pre-existing Medium closed — D-044). Deployment itself, the release tag, the gold backup,
and the host-PC migration remain STOPPED pending authorization and principal acceptance.

## 2) Implemented changes (summary)

**P0 — correctness**
- Budget (§4): decimal-safe money math (integer halalas inside `finance/calc`, D-043);
  allocation-based «المتبقي قبل/بعد» per expense in the item ledger with deterministic
  ordering; «المتبقي بعد الحفظ» live in the expense form; remaining columns added to
  سجل المصروفات + كل العمليات المالية; near-exhaustion + missing-amount summary cards on
  /budget; hard deletes now snapshot to `record_versions` with before-detail audit.
- Weekly follow-up (§7, D-042): week-aware page (week selector, saved snapshot of the
  selected week, «لم يتم التحديث هذا الأسبوع», Δ vs previous week) with truthful grouping
  separating weekly execution / documented completion / principal closure; `created_at` no
  longer reset on week-row edits (ordering by `week_key`); empty progress no longer zeroes;
  `plan-followups` report reworked to week-state over all approved programs (history kept
  as `plan-followup-log`).
- Sidebar (§5): root cause was `lg:static` inside a `min-h-dvh` flex row — now
  `lg:sticky lg:top-0 lg:h-dvh` with its own scroll; sessionStorage scroll retention
  (D-029-safe ref pattern); collapsible `<details>` sections (default open, user collapse
  persisted, active section force-open); `aria-current` + minimal nearest scrollIntoView.
  No migration (browser storage only).
- Evaluation forms (§6, D-041): migration **0027** additive archive columns; archive
  (default for used forms, restorable, history via frozen `modelSnapshot`) / hard delete
  (unused forms only, official forms refused, last-active-per-audience guard); archived
  forms excluded from new cycles + D-014 matching; archive filter in the models list;
  linked-record counts incl. the indirect ratings path; full audit + snapshots.

**P1 — operational outputs**
- Homepage queue «بانتظار اعتماد المدير» (§11): three real-state tabs (new drafts /
  documented-complete awaiting closure / pending change requests) with inline audited
  approve for drafts; no bulk approval by design.
- Program reports (§8-9): by-owner and by-domain now list program names with approval
  state, lifecycle, execution status, progress, Hijri dates, evidence, delay flag;
  aggregates kept as `*-summary` reports.
- Program card (§10): visible access from the program header and the /plan row actions;
  report enriched with seq identifier, principal approval + date, lifecycle row, notes.
- Committees (§12, migration **0028**): per-task execution status («لم تبدأ/قيد التنفيذ/
  منجزة», NULL = «—»); «سجل المجالس واللجان التفصيلي» document (one section per committee,
  each member a separate row with role + tasks + statuses); committee report/card rebuilt
  with task execution, dates, duties, minutes numbers, historical results/impact; tabular
  registry reports un-merged (one row per member / per membership).
- Performance reports (§13): individual page gains cycle selector, weighted scores,
  per-criterion notes + evidence, sessions log with approvals, acknowledgement card, and a
  numbered PDF (`employee_performance_report`); school-wide issuable document
  (`overall_performance_report`) with named appendix; both require reports.generate +
  performance.individual.read.
- Inspection→maintenance (§14, D-045): post-save conversion offer (all/selected/later);
  duplicate complaints blocked until closure; linked status on finding rows; inspection
  source identity on the complaint + «المصدر» column in the list; draft explains why the
  letter is unavailable + one-step «اعتماد البلاغ وإصدار التقرير»; letter completed with
  inspection source, safety impact, reporter, principal approval, decoupled requested
  action; «طباعة تقرير الصيانة» after issuance.

**P2 — presentation**
- One shared PDF header confirmed (`officialPageHtml`); page numbers now on for every
  generator; Word exports carry the central identity (legacy fallback line unreachable);
  Word font → IBM Plex Sans Arabic (D-040); /documents labels from the central registry.

**Security hardening (found in §22 review, fixed)**
- D-044: issued performance PDFs (incl. pre-existing session reports) were downloadable
  with `files.download` alone and listed by name in /documents — now gated on
  `performance.individual.read` at `/api/files/[id]` and filtered from the listing.

## 3) Root causes of confirmed defects

See `docs/SCOPE_IMPACT_V2_4.md` (weekly-follow-up propagation chain, sidebar CSS root
cause, budget gaps, missing form lifecycle) — recorded before implementation.

## 4) Migrations

| # | File | Content | Reversal |
|---|---|---|---|
| 0027 | `drizzle/0027_tiny_harpoon.sql` | 3 nullable cols + FK on `perf_models` (archive) | drop columns |
| 0028 | `drizzle/0028_blue_kulan_gath.sql` | 1 nullable col on `committee_task_assignments` | drop column |

Both additive; no seeds, no data rewrites, no new tables. Sidebar state: no migration.

## 5) Tests

- New: `perf-model-admin` (9) · `followup-weekly` unit (12) + integration (4) ·
  `finance-money` (9) · `approval-queue` (5) · `detailed-reports` (6) ·
  `inspection-maintenance-flow` (4) · `perf-doc-privacy` (2) · 3 new permission-denial
  cases in `security-existing-surfaces` · e2e `v24.spec.ts` (4 scenarios).
- **Vitest: 738/738 green** (682 at baseline → +56; the one transient failure was the
  doc-type lockstep count updated 29→30). `npm run build` ✓, typecheck 0, lint 0.
- **Playwright: 76 passed / 1 skipped (the standing C5 D-018 real-HTTPS camera skip) /
  0 failed, 4.1 min** — includes the new `v24.spec.ts` (sidebar retention incl. reload and
  collapse memory, form delete/archive/restore, homepage queue with inline approve +
  truthful weekly grouping, budget cards). E2E drift was fixed spec-side for three
  intentional UI changes (renamed report button; follow-up rows regroup after recording;
  «اعتماد البلاغ» needs exact matching next to the new combined button). Two REAL UI gaps
  the e2e caught were fixed app-side: silent success on form deletion (now redirects to
  the models list) and a duplicated restore button on archived models.
- Note: `v24.spec.ts` queue/budget cases assume the ordered full-suite run (a plan year
  exists from earlier specs) — same convention as the serial workflow scenarios.

## 6) Production-clone rehearsal (2026-08-02) — PASS

- Read-only `pg_dump` of `madrasa-prod-db-1` (prod at **ledger 27 / 86 tables**,
  containers untouched, RestartCount unchanged) restored into disposable
  `madrasa_rehearsal_v24` on the dev container.
- Pre-migration baseline (30 counts + 7 fingerprints) matched recorded production anchors:
  D-022 `4572c57060e20c4b0de4db52545a8e3f`, issued-docs `f34e3f0f2dffa7a71108e594d9281ff0`.
- Applied migrations twice: **only diff = ledger 27→29**; tables 86; all counts and all 7
  fingerprints byte-identical; `perf_models.archived_*` and
  `committee_task_assignments.status` present and **100% NULL**; second run a no-op
  (idempotent).
- App boot smoke on the migrated clone (RC image, port 3083, isolated container):
  `/api/health` → `{"status":"ok","db":"up","version":"0.1.0"}`, `/login` 200,
  auth gate `/plan` → 307. In-container Chromium PDF probe → `PDF-OK %PDF-`.
- Clone + disposable DBs dropped, dump deleted after verification. Production containers
  never touched (both healthy, uptime unbroken).

## 7) Backup & restore validation

- The rehearsal itself validated dump→restore of current production data (full baseline
  parity on the clone). The encrypted pre-deploy backup + checksum + test-restore inside
  the prod network is a **deploy-time step** (as v2.2/v2.3) and runs under the deployment
  authorization, per `docs/DEPLOYMENT_PLAN_V2_2.md` §1-2 flow.
- Latest routine encrypted backups continue on schedule; nothing was modified.

## 8) RC image

**`madrasa-app:0.1.0-v2_4-rc` = `sha256:2f69c724c625f60a39c9d8f8e109c97407ff70f23441386498a5e36872556c5b`**
(linux/arm64, `Dockerfile.production`). Verified: migrate-only init on a fresh disposable
DB applied exactly **29** migrations → **86** tables (== clone rehearsal); `src/lib/ai`
absent (D-035); 29 migration files; Playwright Chromium build **-1228** matches the locked
1.61.1 (the v2.3 PDF-500 fix holds — verified by an in-container `chromium.launch →
page.pdf` probe printing `PDF-OK %PDF-`); sharp arm64 + postcss 8.5.24 overrides present;
boots against the migrated clone with healthy `/api/health`.

## 9) Rollback procedure

App-only: retag `madrasa-app:0.1.0` to the current production image
(`0.1.0-prev-v2_4-<stamp>` tagged at deploy time from the running `7f5ff14a…` rc2) and
`up -d --no-deps app`. Migrations 0027/0028 are additive-nullable: the v2.3 image runs
unchanged on ledger 29 (columns invisible to it), so rollback needs **no DB action**;
full reversal (drop columns) documented in §4 if ever required.

## 10) Security review (§22)

Focused review of modified areas: authorization on every new action (verified by
permission-denial tests), IDOR (uuid validation on params), stored XSS in generators (all
interpolations escaped — verified by existing officialPageHtml XSS tests + escaped
builders), CSV formula injection (all new report columns flow through the central
`sanitizeCell` pipeline), approval race (approve re-checks status server-side; duplicate
finding conversion guarded by FK + re-check), budget race (recompute-on-read, no cached
balance), sensitive performance data (D-044 fix above; overall report carries a D-013
notice). **No unresolved High/Critical findings.**

## 11) Performance review (§18)

New report loaders are batched (2-4 queries + one evidence batch; no N+1); the committee
registry generator loops committees (school-scale: 4-10) with bounded queries; dashboard
queue adds 2 queries; ledger math is O(n) in-memory on per-item operation lists. Exports
remain capped by `MAX_EXPORT_ROWS`. No new infrastructure.

## 12) Known limitations / deferred

- Building map + green visual panel: deferred per brief §14F to the next building-focused
  iteration (no visual redesign shipped).
- Permanent cascading deletion of USED evaluation forms: intentionally not implemented
  (D-041); archive is the safe default.
- Committee «results/impact» remains a read-only historical table (write path removed in
  v2.1 §G3) — the registry prints existing rows only.
- Identity has no phone/email field; letter contact = school name + header note.
- `plan_budget_items` (import-only legacy) unchanged.

## 13) Deliverables & versions

- Proposed version: **v2.4.0**; release tag only after principal acceptance (same policy
  as v2.2/v2.3 — no tag, no gold backup, no host-PC migration until acceptance).
- Commits on `scope-v2.4-post-acceptance` (base `b47558c`): `02973d0` (B — P0
  correctness), `f53b8a5` (C — program workflow/reports), `6dd8fb8` (D — institutional
  reports/header), `180985d` (E — inspection→maintenance), plus the F/G hardening +
  rehearsal commit (= branch HEAD carrying this document).
- Report samples generated during verification (real issuance pipeline, disposable data):
  committee registry, employee + school performance PDFs, maintenance letter, program
  card/report — all with numbered documents, verification codes, page numbers.
- Principal retest: `/pilot` rewritten to 21 v2.4 tasks (draft key bumped to v3).
