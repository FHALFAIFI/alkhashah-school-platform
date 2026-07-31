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

## 4) Playwright e2e — (recorded when the run completes)

## 5) Remaining before verdict

- [ ] Full Playwright suite green (fix drift from renames/UI moves if any).
- [ ] Fresh encrypted pre-deploy backup inside the prod network + checksum + restore verification.
- [ ] Build & verify `madrasa-app:0.1.0-v2_3-rc` image; tag rollback image.
- [ ] Controlled Mac mini deployment (migrate-only init; db container never restarted).
- [ ] §27 delivery evidence + principal retest checklist (`/pilot` update).
- [ ] STOP before: release tag, gold backup, host-PC migration (await principal acceptance).
