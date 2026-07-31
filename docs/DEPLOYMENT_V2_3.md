# v2.3.0 — Verification & Controlled Deployment Report

> Brief: `docs/BRIEF_V2_3_0.md` · Impact/inventory: `docs/SCOPE_IMPACT_V2_3.md` ·
> Decisions D-032…D-040. Branch `scope-v2.3-principal-acceptance`.
> Production baseline: migration ledger **23** (file `0022_steep_joystick.sql`), image
> `madrasa-app:0.1.0-v2_2_1-rc` (`ab259dd8…`), deployed 2026-07-30.

## 1) Pending migrations (production 23 → 27)

| # | File | Content | Class |
|---|------|---------|-------|
| 24 | `0023_numerous_goblin_queen.sql` | `stored_files` + acceptance_status/mode/accepted_by/accepted_at (all nullable) + FK | additive |
| 25 | `0024_smooth_guardian.sql` | `budget_income.payment_reference`, `updated_by` on income+expenses (nullable) + FKs | additive |
| 26 | `0025_clammy_blackheart.sql` | NEW `room_types` (+24 seeded system rows, D-037), NEW `inspection_findings`, NEW `maintenance_status_history`, maintenance lifecycle columns (nullable), **documented D-036 data statements**: status default→`مسودة`; legacy mapping `مفتوح→معتمد`, `قيد الإصلاح→تحت المعالجة`, `مغلق ومتحقق→مغلق` (+`resolution='تم الإصلاح'` for already-repaired) with one history row per converted record | additive + documented mapping |
| 27 | `0026_d034_approve_permission_labels.sql` | UPDATE 2 rows `permissions.name_ar` («اعتماد وإقفال…»→«اعتماد…») — reference labels only (D-034) | documented label update |

No DROP/TRUNCATE/DELETE anywhere. `seed.ts` untouched and unreachable (migrate-only init).

## 2) Production-clone rehearsal — **PASS** (2026-07-31)

Method: read-only `pg_dump -Fc` from `madrasa-prod-db-1` → restored into isolated
`madrasa_v23_rehearsal` on the dev container (`madrasa-db`) → migrate → verify → **clone dropped,
dump deleted**.

Pre-migration clone state (== production):
- Ledger **23**, tables **83**.
- Counts `people/programs/milestones/activities/swot/documents/evidence/stored_files/income/expenses/items`
  = **54/30/129/129/0/34/30/83/5/5/4**.
- Maintenance by status: `مفتوح:3`, `مغلق ومتحقق:2`.
- **D-022 fingerprint `4572c57060e20c4b0de4db52545a8e3f` — MATCHES the recorded baseline.**
- Issued-docs fingerprint (34 docs): `f34e3f0f2dffa7a71108e594d9281ff0` (pre-migration reference;
  grew from the 33-doc value by normal live issuance since v2.2.1).
- Old permission labels present; perf 7 cycles / 11 sessions / 128 ratings.

Post-migration results:
- Ledger **27** (exactly 4 applied), tables **86** (the 3 new tables only).
- **Every count above byte-identical: 54/30/129/129/0/34/30/83/5/5/4.**
- **D-022 fingerprint UNCHANGED**: `4572c57060e20c4b0de4db52545a8e3f`.
- **Issued-docs fingerprint UNCHANGED**: `f34e3f0f2dffa7a71108e594d9281ff0` — no historical
  document rewritten.
- D-036 mapping exact: `معتمد:3`, `مغلق:2`; `resolution`: `تم الإصلاح:2`, NULL:3;
  `maintenance_status_history`: `معتمد:3`, `مغلق:2` (one row per converted record).
- D-037: `room_types` = 24 system rows.
- D-034: both `name_ar` values updated (`اعتماد البرامج`, `اعتماد سجلات الأداء`).
- New columns 100% NULL: stored_files acceptance 0, income payment_reference/updated_by 0,
  expenses updated_by 0. `inspection_findings` empty.
- **Idempotent**: second migrate run applied nothing (ledger stayed 27).
- **App boots on the migrated clone**: `next start` → `/api/health` `{"status":"ok","db":"up"}`,
  `/login` 200. (The app's fail-closed test guard correctly refused the clone until it carried a
  `_test` name — guard verified working.)
- Cleanup: `DROP DATABASE`, dump deleted from scratchpad.

## 3) Automated gates

| Gate | Result |
|------|--------|
| `tsc --noEmit` | 0 errors |
| `eslint` | 0 errors / 0 warnings |
| vitest (unit + integration) | **682 passed** (incl. +45 new v2.3 tests: dates round-trip, file acceptance, finance edit/ledger, findings/idempotency/alias-matching, D-036 residue check, analytics, report engine, document cards) |
| production build | ✓ (zero AI references; only the dormant `ai_*` schema per D-035 and one historical task label) |
| Playwright e2e | see §4 |

## 4) Playwright e2e — **GREEN** (2026-07-31)

**72 passed / 1 skipped / 0 failed (3.8 min)** — full suite (18 spec files), standard runner
(`npm run test:e2e`: Playwright-managed `next dev` on :3081 against isolated `madrasa_test` at
ledger 27, truncate+reseed per run). The 1 skip is C5 real-HTTPS camera (D-018 environmental
deferral, `test.skip(!https)`) — same as every release since v2.1.

Drift fixed (spec-side only; no app change was needed):
- **Dual-calendar DateField (B1/D-033)** renders its input as `#<name>-input` — updated 4 stale
  selectors in `workflows.spec.ts` (`#meetingDate`, `#dueDate`, 2× `#sessionDate`).
- **Maintenance lifecycle (B5/D-036)** — س5 rewritten from the removed inline per-row status
  select to the real workflow: list shows «مسودة» → open `/building/maintenance/[id]` →
  «اعتماد البلاغ» → «تسجيل الإرسال» (required الجهة المستلمة) → «بدء المعالجة» →
  «تسجيل الإصلاح» (الإجراء المتخذ + ملاحظة) → «إغلاق البلاغ» → terminal: «مغلق» badge, zero
  transition buttons. ج8 asserts «مغلق» + resolution «تم الإصلاح» (was «مغلق ومتحقق»).
- **Nav rename (E)**: «الصيانة» → «بلاغات الصيانة» in س5's sidebar navigation.
- **س6 (AI assistant) deleted** per D-035 — it exercised the removed assistant and could only
  ever skip; the workflows file header no longer lists the assistant module.

### Environmental note — external `next start` on the macOS host (NOT a product defect)

The first full run was executed against an external production server (`next start` on :3081,
resumed from the previous session's method) and showed 10 failures, all one symptom: a Server
Action POST returns 200 in ~20 ms but the RSC response stream never completes client-side
(`net::ERR_ABORTED` mid-stream), leaving `useActionState` pending forever — save/transition
buttons stuck disabled. Isolation evidence:
- Same test, same build, `next dev` runner → passes.
- **v2.2.1 baseline `6ce990b` rebuilt in an isolated worktree under `next start` on this host →
  fails identically** ⇒ not introduced by v2.3 code.
- Production (Docker, node 24.18) demonstrably runs Server Actions fine — the v2.2.1 deployment
  smoke (2026-07-30) drove the full lifecycle through the deployed container with the same
  host Playwright/Chromium.
Conclusion: quirk of `next start` (Next 16.2.12) on the macOS host (node 24.16) only. The e2e
gate runs via the standard dev webServer, as in every prior release; production verification
remains the authenticated smoke on the deployed container at deploy time.

## 5) §27 delivery evidence (pre-deployment portion)

Deploy-time items (image digest, backup checksum, restore verification, post-deploy
screenshots, final verdict line) are appended at deployment. Available now:

- **Commits (branch `scope-v2.3-principal-acceptance`, from v2.2.1 base `6ce990b`):**
  `5337b45` A inventory/decisions · `25d2c1d` B1 dates · `1148975` B2 uploads ·
  `7632ab8` B3 finance · `61d4457` B4+B5 building · `31dba1d` C1+C3 identity/exports ·
  `9332dec` C5+C6 analytics · `ce0945c` C4+C7 templates/cards · `a3827b7` D interface ·
  `d952f07` E AI removal · `31a741c` F rehearsal · `8f4bf29` F e2e green ·
  `1df8326` F pilot checklist + §27 evidence + D-035 residue (image build commit).
- **Migrations (production 23 → 27):** §1 table — `0023` stored_files acceptance ·
  `0024` finance invoice/updated_by · `0025` room_types + inspection_findings +
  maintenance lifecycle/history + D-036 mapping · `0026` D-034 permission labels.
  Schema delta: +3 tables (83 → 86), all new columns nullable, no DROP/TRUNCATE/DELETE.
- **Removed AI dependency list (D-035):** `src/lib/ai/*` (provider, orchestrator, tools,
  assist, settings, both model-health checks), `src/app/api/ai/*` (chat, conversations,
  proposals, test), assistant pages + components (dock, chat, ask button), AI settings
  card, pilot `aiStatus()` per-render probe, `ai.use`/`ai.manage` seed permissions,
  `aiMeetingSummaryAction`, AI env vars + compose `AI_ENABLED`/`AI_PROVIDER`/
  `OLLAMA_BASE_URL` + host-gateway extra_hosts, playwright AI env, workflows س6 e2e
  scenario, and (final residue, this commit) the `ai.enabled`/`ai.provider` seed settings
  rows + the orphaned `.env.example` Ollama block. **Zero npm AI packages existed** (Ollama
  was reached over plain HTTP). `ai_*` tables remain dormant per D-035 — no destructive
  migration; production rows preserved.
- **Test totals:** vitest **682** (unit + integration) · Playwright **72 passed / 1 skipped
  (C5 D-018) / 0 failed** (§4) · typecheck 0 · eslint 0/0 · production build ✓.
- **Authorization coverage:** role-derived upload acceptance (B2, 6 integration tests);
  D-013 individual-performance exclusion intact (dashboard incomplete-evaluations card is
  permission-gated); template actual-record preview re-derives eligibility server-side
  (wrong-type/archived/non-existent → refused, IDOR tests); report/export routes behind
  per-type read permissions; unauthenticated preview → 401/403 (e2e).
- **Default-template inventory:** **29 doc types** in `src/lib/templates/schema.ts`
  (program: report/closure/card/completion; finance: summary/detailed; committees:
  assignment/minutes/report + council + generic meeting; performance: employee-detail/
  final/session/overall; registers: employees/evidence; building: report/inspection/
  room-checklist/readiness; maintenance: letter/followup/closure; risk; SWOT; external
  evaluation; executive; general official letter) — every generator docType reconciled
  against the registry (C4).
- **Report generation:** all **54** registry reports export **pdf|docx** via
  `/api/reports/export` with filters shown, page numbers, repeating table headers, §7
  filename convention (C3); samples verified in e2e (PDF magic bytes + docx ZIP + hidden
  columns honored in both).
- **Production-clone rehearsal:** §2 — PASS, byte-identical counts and fingerprints,
  exact D-036 mapping, idempotent, app boots on the migrated clone.
- **Known limitations:** unchanged pilot boundaries (no attendance/quorum model by product
  decision; mail = drafts only; employee login accounts disabled; upper floors unpublished
  drafts; D-014 pending Fares reconciliation; C5 deferred D-018; synthetic-record archiving
  deferred). v2.2.1's three pre-existing notes remain tracked: Server-Action UI refresh on
  4 lifecycle forms (v2.3 new UIs use `router.refresh()`), archived records in
  closed/reopened report modes, Ollama LAN exposure (now moot for the app — zero AI
  runtime — but the host LaunchAgent is still owner-deferred).
- **Principal retest checklist:** `/pilot` rewritten for v2.3.0 — 21 tasks covering every
  fifth-round change, each submitting through the real feedback channel; verified by
  `pilot-retest.spec.ts`.

## 6) Remaining before verdict

- [x] Full Playwright suite green — **72/1skip/0fail** (§4; drift fixed spec-side; the
      subsequent v2.3 pilot-checklist update re-verified via `pilot-retest.spec.ts`).
- [x] §27 delivery evidence (pre-deployment portion, §5) + principal retest checklist
      (`/pilot` rewritten to v2.3.0 — 21 tasks).
- [x] **RC image built & verified** (2026-07-31): `madrasa-app:0.1.0-v2_3-rc` =
      `sha256:877f2343dfb3197ff898ac244306039c37531f200dcc8bf24b17715d17268f0a`,
      linux/arm64, built from `1df8326` via `Dockerfile.production`. Verified on a
      disposable DB: image's migrate-only init applied exactly **27** migrations → **86**
      tables (== rehearsal); app boots (`/api/health` ok/db-up, `/login` 200, auth gate
      307); **sharp 0.35.3 arm64** + **postcss 8.5.24** native overrides present;
      Playwright Chromium present (Arabic PDF); `src/lib/ai` + `src/app/api/ai` absent
      (D-035). Disposable container + DB destroyed. Rollback image is tagged from the
      running production tag at deployment time (current prod = `ab259dd8…`).
- [ ] Fresh encrypted pre-deploy backup inside the prod network + checksum + restore verification.
- [ ] Controlled Mac mini deployment (migrate-only init; db container never restarted) —
      **awaits explicit authorization**.
- [ ] STOP before: release tag, gold backup, host-PC migration (await principal acceptance).
