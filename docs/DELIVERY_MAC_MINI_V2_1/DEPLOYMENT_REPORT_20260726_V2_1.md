# Scope v2.1 — Production Deployment Report (Mac mini)

**Status:** `TECHNICAL PRODUCTION READY ON MAC MINI — PRINCIPAL ACCEPTANCE PENDING — HOST-PC MIGRATION NOT STARTED`

**Date:** 2026-07-26 · **Compose project:** `madrasa-prod` · **Branch:** `scope-v2.1-corrections`
**Approved commit:** `8fb59c17d1d82e2bd7c4825013bb8e5dbf5050f5`

---

## 1. Actual starting state discovered

Inspection of the live repository, containers, and database — **not** a blind re-run:

| Fact | Finding |
|---|---|
| Git HEAD | `8fb59c1` (approved commit), branch `scope-v2.1-corrections`, working tree clean except the approved `compose.production.yml` LAN diff |
| Running app (before) | `madrasa-prod-app-1`, image `madrasa-app:0.1.0` **built 2026-07-23** = the **Scope v2** build |
| Approved commit date | `8fb59c1` committed **2026-07-26** → the running app was **not** the approved v2.1 build |
| Production migration level | **0015** (16 drizzle rows) — matches expected pre-deploy state |
| Pending migration | **`0016` only** (file hash `83a4babb…` absent from the applied journal; 0015 `35aa21ff…` was the last applied) |

**Conclusion:** production was on 0015 running the older Scope v2 image → a full v2.1 deployment (migrate `0016` + rebuild from `8fb59c1` + cutover) **was required**. This matches the authorization's "if production is still on 0015, execute the controlled 0016 deployment."

---

## 2. Deployment required vs. already completed

**Deployment was required and was executed.** Migration `0016` applied; application rebuilt from the exact approved commit and cut over. Migrations `0010–0015` were **not** re-applied.

---

## 3. Timing & downtime

| Event | Time (Asia/Riyadh) |
|---|---|
| Image build start | 11:26:56 |
| Image build end | 11:29:33 (~2m37s, **no downtime** — old app kept serving) |
| **Downtime start** (app stopped, writes frozen) | **11:30:57** |
| Migration `0016` applied | ~11:31 |
| App cutover healthy | 11:32:25 |
| **Downtime end** | **11:32:25** |
| **Total downtime** | **≈ 88 seconds** |

---

## 4. Deployed artifact

| Item | Value |
|---|---|
| Commit | `8fb59c17d1d82e2bd7c4825013bb8e5dbf5050f5` |
| Image | `madrasa-app:0.1.0` |
| Image ID / digest | `sha256:a492d908bcfb8e97d578eea5b71f186e42e09b14c85f0fa2cb194d1b9a5e529a` |
| Config digest | `sha256:e218e7685d6132d69fe80e93dadcee233cf4a14d963246916fdeb4df4ae9816f` |
| Rollback image (prev v2) | `madrasa-app:0.1.0-prev-v2-20260723` = `sha256:d6df008b…3e4a4a` (preserved) |
| Build provenance | Built from HEAD `8fb59c1`; the only uncommitted file (`compose.production.yml`) is **not** copied into the runner image (Dockerfile.production runner COPY list excludes it), so the image is pure approved source |

---

## 5. Migration journal — before and after

| | Rows | Last migration |
|---|---|---|
| **Before** | 16 | `0015_yielding_cammi` (`35aa21ff…`) |
| **After** | 17 | `0016_high_mentor` (`83a4babb…`) |

Only `0016` was applied. `seed.ts` did **not** run (see §7). (drizzle stores each row's `created_at` as the migration's *generation* time, not apply time — the row-count change 16→17 is the apply evidence.)

`0016` is strictly additive: `committee_task_templates` (table), `committee_task_assignments` (table, 2 FKs → committees / committee_members, 2 indexes), `meeting_types.requires_signature` (column, default `false`). No DROP, no data migration, no extension operation.

---

## 6. Table counts — pre (0015) vs post (0016)

| Table | Pre | Post | | Table | Pre | Post |
|---|---|---|---|---|---|---|
| users | 2 | 2 | | committees | 3 | 3 |
| people | 54 | 54 | | committee_members | 10 | 10 |
| programs | 26 | 26 | | committee_templates | 6 | 6 |
| program_milestones | 129 | 129 | | committee_task_templates | — | 0 (new) |
| program_activities | 129 | 129 | | committee_task_assignments | — | 0 (new) |
| feedback | 1 | 1 | | budget_income | 2 | 2 |
| stored_files | 18 | 18 | | budget_expenses | 1 | 1 |
| evidence_items | 3 | 3 | | perf_cycles | 6 | 6 |
| documents | 10 | 10 | | perf_sessions | 2 | 2 |
| audit_log | 146 | 146 | | perf_ratings | 38 | 38 |
| roles | 2 | 2 | | meeting_types | 5 | 5 (all `requires_signature=false`) |
| permissions | 59 | 59 | | public tables | 76 | 78 |

**No material count changed. No unexplained decrease. No unexpected records.** These fresh values are the authoritative baseline.

---

## 7. D-022 fingerprint & reconciliation

- **D-022 milestone fingerprint** = `8d5375e0f610ee06cd80702b4f1427a3967cbf19884ef091820d2f5a77a382cf` (count 129) — **identical pre-migration, post-migration, and in the backup-restore rehearsal** → the 129 milestones are byte-for-byte unchanged; matches recorded F0.
- **Reconciliation** = 129 activities all carry `migrated_from_milestone_id`, 129 distinct, 129 milestones matched, **0 orphans** → 1:1 confirmed pre and post.

**Confirmation `seed.ts` did NOT run:** reference data unchanged (roles 2, permissions 59, people 54, audit_log 146); the two new committee-task tables are empty (seed would have populated templates). The migration command used an explicit `sh -c "npx tsx src/db/migrate.ts"` override (no `&& seed.ts`), and the cutover used `up -d --no-deps app` (skips the init/seed dependency).

---

## 8. Backup, checksum & restore rehearsal

| Item | Value |
|---|---|
| Backup file | `backups/weekly/full-20260726-rc-v2_1.tar.gz.enc` |
| Size | 21,106,304 bytes |
| SHA-256 | `11eafe7929ce49d7727840f174d8902b3965aa50a51ae3bd64e42a31cf558642` |
| Encryption | AES-256-CBC, PBKDF2 200k iters, salted (`BACKUP_PASSPHRASE`) |
| Contents | `db.dump` (pg_dump custom, 1,929,739 B) · `package.json` · `env.example` · `storage/` (19 files) |
| **Restore rehearsal** | **PASS** — restored into a disposable DB on the dev container: 76 tables, all counts identical to production, reconciliation 129/129/0, **fingerprint == F0**, 19 files readable. Disposable DB dropped. |

The backup was taken while the app was still serving; counts were verified identical before, and again after the write-freeze, so the snapshot is consistent.

---

## 9. Docker health & restart

- `madrasa-prod-app-1`: **healthy**, `restart=unless-stopped`, running the new image `a492d908…`.
- `madrasa-prod-db-1`: **healthy**, `restart=unless-stopped`.
- **Restart & persistence:** demonstrated by the cutover itself (app stopped → container recreated → healthy with **identical data** from the persistent named volumes `pgdata`/`storage`/`backups`).

---

## 10. Working URLs & network exposure

| URL | Result |
|---|---|
| `http://192.168.0.48:3080/api/health` | `{"status":"ok","db":"up","version":"0.1.0"}` |
| `http://192.168.0.48:3080/` | 307 → `/dashboard` (auth gate) |
| `http://192.168.0.48:3080/pilot` | 307 → `/login` (auth gate); deployed source carries the corrected v2.1 `/pilot` tasks |
| Tailscale | host `faheds-mac-mini` = `100.99.204.63` on the tailnet, MagicDNS resolves; **`tailscale serve status` = "No serve config"** → HTTPS-via-Serve path is **dormant** (was already off during the LAN-retest phase; **not** changed by this deployment) |

**Network-exposure comparison (before → after): IDENTICAL.**

| Surface | Before | After |
|---|---|---|
| App | `192.168.0.48:3080` (approved temporary LAN binding) | same |
| PostgreSQL | `5432/tcp` internal only, **not** host-published | same |
| Ollama | `127.0.0.1:11434` loopback only | same |
| Tailscale Serve | not configured | not configured |

No port, firewall, reverse-proxy, or Tailscale exposure was broadened. The `*:5432` host listener seen on the machine belongs to an **unrelated** project (`ais-v5-postgres`), not `madrasa-prod`.

---

## 11. Scope v2.1 production smoke results (non-destructive)

Method: deployed-app SSR checks + inspection of the **running container's** source + production data-layer checks. Authenticated live-UI confirmation is reserved for the principal's acceptance session (also the D-029 acceptance gate). No synthetic production records were created.

| Area | Result |
|---|---|
| **Login shell (D-029)** | `lang="ar" dir="rtl"`, `translate="no"` + `notranslate` present, **zero** raw-error markers (`insertBefore`/`Application error`/`client-side exception`), Arabic labels render |
| **Programs** | Deployed runtime imports of `activity-progress` = 0, `milestone-backfill` = 0, program closure-readiness (`@/lib/plan/readiness`) = **0** (fully inert). Program pages contain no `وزن النشاط`/`أوزان الأنشطة`/`جاهزية الإغلاق`/`نسبة الجاهزية`/`الشواهد المطلوبة`. (The only active `readiness` is the unrelated facilities `@/lib/building/readiness`.) 129 activities retained but do not drive progress/reports. |
| **Evidence** | Informational strings present in the deployed build: `لم يتم رفع أي شاهد حتى الآن`, `تم رفع شاهد واحد`; `evidence-summary.ts` contains **no** quota/target/remaining/`جاهزية` wording. Real data: 3 evidence items (multiple-count wording path). |
| **Budget** | Label `البند` present; `budget_income` (2) and `budget_expenses` (1) exist; receipt upload/link is code-present and optional. |
| **Committees** | Deployed build contains the task-distribution columns `المهمة`, `العضو المكلف`, `الصفة/الدور`, `توقيع العضو`, `ملاحظات`; task-template tables present (0 rows, seed-on-demand). `meeting_types.requires_signature` all `false` — no existing type silently made signature-required. |
| **Performance KPIs** | Real data: `perf_sessions` = 2, both `session_type='تخطيط'` (1 draft, 1 completed), coexisting with 38 ratings. Deployed build contains `جلسة التخطيط`, `لم يبدأ التقييم بعد`, `لا يُحتسب`. |
| **Reports** | Reports use the same corrected data layer; the removed activity/weight/readiness modules are not imported by the runtime. |
| **Stability** | Deployed login SSR clean; pre-deploy Playwright `form-stability` 4/4 and `mobile` 5/5 (390×844) on this exact commit. |

**`insertBefore` classification: PROBABLE.** The deployed SSR shell is clean and the pre-deploy real-browser evidence is green, but per D-029 the principal's real-browser retest remains the conclusive acceptance gate; the classification is not raised to CONFIRMED-fixed on inference alone.

---

## 12. Pre-deployment verification gates (exact commit `8fb59c1`)

Independently re-verified this session:

| Gate | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | ✅ clean |
| Lint (`eslint .`) | ✅ 0 / 0 |
| Unit + integration (`vitest run`) | ✅ **280 passed / 53 files** |
| Production build (`next build` in Docker) | ✅ image built from `8fb59c1` |
| Playwright (recorded, this commit) | ✅ 60 passed / 1 skipped (C5 / D-018 HTTPS-camera environmental skip) |

Test isolation is fail-closed (`assertTestDatabase` + `assert-non-production`): tests refuse to run against `madrasa-prod`, the production DB, `192.168.0.48:3080`, or prod storage/backup paths.

---

## 13. Warnings, deviations & disclosures

- **Disclosed net-zero deviation (earlier session, 2026-07-26 verification):** an accidental `CREATE EXTENSION pgcrypto` was immediately reversed with `DROP EXTENSION pgcrypto` (no CASCADE, no dependents) while computing a hash; the two cancel and no application table was modified. **This deployment did NOT repeat it** — pgcrypto is confirmed absent, and `0016`'s `gen_random_uuid()` needs no extension on Postgres 16 (core function). Integrity checks used the canonical `verify-milestone-baseline.ts` tool, not SQL `digest()`.
- **Tailscale Serve dormant:** remote HTTPS access via Tailscale Serve is not currently configured. Re-enabling it is a documented operator action (`tailscale serve --bg 3080`) — deliberately **not** performed here, as it would change network exposure (outside this authorization).
- No blocking warnings. No failed gate.

---

## 14. Explicit confirmations

- ✅ **No official data was imported.**
- ✅ **No destructive reset, reseed, or deletion occurred.** `seed.ts` did not run.
- ✅ **No network exposure was broadened** (before == after).
- ✅ **No final release tag was created.**
- ✅ **No destination-PC migration was started.**
- ✅ Migrations `0010–0015` were not re-applied; only `0016` was applied.
- ✅ Approved `compose.production.yml` LAN diff and all user-owned changes preserved (not reset/overwritten).

---

## 15. Release-candidate package location

`docs/DELIVERY_MAC_MINI_V2_1/` (this folder) + the encrypted backup under `backups/weekly/` (git-ignored). See `RELEASE_CANDIDATE.md` for the full index.

---

## 16. Remaining principal actions

1. Log in to `http://192.168.0.48:3080` with your own credentials and walk the Scope v2.1 acceptance checklist (`قائمة_قبول_المدير.md`), especially the real-browser stability retest (D-029 `insertBefore` gate).
2. Record acceptance (or defects) on that checklist.
3. **Only after genuine acceptance** is the final release tag created and host-PC migration planned (see `DESTINATION_PC_CHECKLIST.md`). Neither has been done.
