# Scope v2.2 — Controlled Mac mini Deployment Report

**School:** مجمع الخشعة التعليمي للبنين · **Date:** 2026-07-29
**Host:** Mac mini · LAN `192.168.0.48` (en1) · Tailscale `100.99.204.63`
**Production URL:** `http://192.168.0.48:3080`

---

# A. Deployment verdict

# DEPLOYED — CONDITIONALLY READY

v2.2 is live on the Mac mini. Migration 18 → 22 applied, the approved image is running, and every
data-preservation check passed: all historical counts identical, the legacy 129/129 fingerprint, the
issued-document fingerprint and the per-snapshot digest all **unchanged**, and finance totals back at
their exact baseline after cleanup.

It is **CONDITIONALLY** rather than fully ready for one reason: **the performance-module smoke tests
(F4c–F4e) could not be executed by me.** The available account is `admin` (sysadmin), and under the
standing decision **D-013** the sysadmin role is deliberately excluded from individual performance
data. `/performance/cycles/[id]` and the session page correctly return 403 for that account. Those
three checks require the `principal` account, whose password the principal changed on 2026-07-26 and
which I do not hold — and which I will not reset. They are handed to the principal's checklist (§K).

Nothing about that is a fault in the release: it is authorization working as designed.

---

# B. Exact release evidence

| Item | Value |
|---|---|
| Branch | `scope-v2.1-corrections` |
| RC commit (HEAD) | `548a3c9f9b1b5266b434df9a545dbd90cf6c4059` |
| Frozen code commit | `80a1b9c9381628d1ba0e7c4f82d89d9df2a549c9` |
| Worktree at deploy | **clean** (0 modified/untracked) |
| Diff `80a1b9c..548a3c9` | `PROGRESS.md`, `docs/DECISIONS.md`, `docs/DEPLOYMENT_PLAN_V2_2.md` — **docs only**, none copied into the image |
| Image deployed | `madrasa-app:0.1.0-v2_2-rc` |
| **Digest** | **`sha256:b13382d15423168a171e2a78087a25eb94537b0d37db5a4e0ccef1f27d43da7e`** — matches the approved prefix `sha256:b13382d15423` |
| Running container image id | `sha256:b13382d15423…` (verified after start) |
| Rollback image | `madrasa-app:0.1.0-prev-v2_2-20260729` = `sha256:fc8654e2bdf8…` (the previously running build) |
| Compose project | `madrasa-prod` · file `compose.production.yml` · services `db`, `init`, `app` |
| **Migration ledger** | **before 18 → after 22** (0019, 0020, 0021, 0022 recorded) |
| Public tables | before 78 → after 83 |

**One deliberate substitution from the written plan, stated plainly.** The plan's step 4 was
`compose build app`. The approval says *deploy `madrasa-app:0.1.0-v2_2-rc` with digest
`sha256:b13382d15423`* and *do not rebuild from an uncommitted worktree*. Rebuilding would have
produced a **different** digest, so no build was run: the already-approved image was retagged to the
tag the compose file references (`madrasa-app:0.1.0`) **after** the rollback tag was taken. Same image
id, verified before and after start. The `init` service uses the same tag, so migrations ran from the
new image — which they had to, since 0019–0022 exist only there.

---

# C. Backup evidence

Fresh, taken immediately before deployment — the older 2026-07-27 artifacts were **not** relied upon.

| Artifact | Path | SHA-256 |
|---|---|---|
| Database (custom dump, encrypted) | `backups/predeploy/db-20260729-135708.dump.enc` | `259d9cff686fb7786e82b512527cc42b0f58f5aa7855e70333e940ab5faacba0` |
| Uploaded/private files (tar.gz, encrypted) | `backups/predeploy/storage-20260729-135708.tar.gz.enc` | `840a090c14a2f04b11e93000fda08d5078f7dfa51e19405d949ccda67a302d68` |
| Checksums | `backups/predeploy/SHA256SUMS-20260729-135708.txt` | — |
| Recovery manifest | `backups/predeploy/RECOVERY-MANIFEST-20260729-135708.txt` | — |

Copies also live inside the `madrasa-prod_backups` volume at `/data/backups/predeploy/`.
Encryption: `aes-256-cbc`, PBKDF2, 200 000 iterations; passphrase is `BACKUP_PASSPHRASE`, **not**
stored in any artifact or in this report.

**Verification — all performed, all passed:**

| Check | Result |
|---|---|
| `shasum -a 256 -c` | **OK** for both artifacts |
| Decryption | **OK** — db 6 396 999 bytes, storage 31 749 111 bytes |
| Dump validity | **OK** — `pg_restore --list` returns 502 objects, header `dbname: madrasa` |
| Archive readability | **OK** — `tar -tzf` lists 73 files (matches production exactly) |
| Test restore into an isolated database | **OK** — 78 tables, ledger 18, people 54, programs 26, activities 129, milestones 129, KPIs 15, risks 9, documents 31, stored_files 72, audit 339 |
| Legacy fingerprint in the backup | `4572c57060e20c4b0de4db52545a8e3f` — **matches production** |
| Issued-document fingerprint in the backup | `c9383e4b0fea0f460560effedeaff7bd` — **matches production** |

The decrypted copies (real school data) were deleted and the verification database dropped
immediately after the check.

The recovery manifest additionally records: git refs, the pre-deployment image id, the target image
digest, the compose project/services/init command, the required env-var **names** (no values), the
migration ledger, both fingerprints, the per-snapshot digest and the storage content digest.

---

# D. Seed-prevention evidence

`seed.ts` did not run. Six independent proofs:

1. **Resolved compose config contains none of it.** A token scan of
   `docker compose -p madrasa-prod config` returned **0** occurrences of each of
   `seed.ts`, `bootstrap`, `reset`, `truncate`, `TRUNCATE`, `drop`, `DROP`, `reseed`,
   `--force-reset`, `db:push`.
2. **The seed service is not in the deployment config at all.** Services resolved: `app`, `db`,
   `init` — `seed` appears **only** when `--profile bootstrap` is passed, which no command used.
3. **The init command is literally migrate-only:** `command: [sh, -c, npx tsx src/db/migrate.ts]`.
4. **Migration output was one line** — `Migrations applied.` No seed, insert, truncate, drop or reset
   text appears anywhere in the run log.
5. **No seed data appeared.** Reference tables that `seed.ts` populates are unchanged:
   roles 2 · permissions 59 · role_permissions 115 · school 1 · calendars 1 · calendar_events 16 ·
   meeting_types 5 · committee_templates 6 · perf_models 10.
6. **All five new tables came out empty and all new columns 100 % NULL:**
   `program_closure_history` 0 · `financial_items` 0 · `template_definitions` 0 ·
   `template_versions` 0 · `plan_swot_items` 0; `programs.closed_at` / `.created_by` / `.reopened_at`,
   `documents.template_version_id`, `budget_income.financial_item_id`,
   `budget_expenses.financial_item_id` — **0 non-null rows each**.

No container named `*seed*` was created; the only project containers are `app`, `db` and the
transient migrate run.

---

# E. Data-preservation evidence

## E.1 Before / after

| Table | Before (§1.7) | After migration | After smoke + cleanup |
|---|---|---|---|
| migration ledger | 18 | **22** | 22 |
| public tables | 78 | **83** | 83 |
| people | 54 | 54 | 54 |
| **program_activities** | **129** | **129** | **129** |
| **program_milestones** | **129** | **129** | **129** |
| programs (active) | 26 | 26 | **26** |
| program_kpis | 15 | 15 | 15 |
| program_risks | 9 | 9 | 9 |
| program_deliverables | 26 | 26 | 26 |
| program_roadmap_cells | 312 | 312 | 312 |
| plan_budget_items | 2 | 2 | 2 |
| budget_income (active) | 2 | 2 | **2** |
| budget_expenses (active) | 2 | 2 | **2** |
| committees / members | 4 / 13 | 4 / 13 | 4 / 13 |
| meetings / outcomes | 5 / 9 | 5 / 9 | 5 / 9 |
| perf_cycles / sessions / ratings | 7 / 11 / 128 | 7 / 11 / 128 | 7 / 11 / 128 |
| documents | 31 | 31 | 31 |
| evidence_items (active) | 25 | 25 | **25** |
| action_tasks / calendar_events | 6 / 16 | 6 / 16 | 6 / 16 |
| rooms / assets | 7 / 2 | 7 / 2 | 7 / 2 |
| users | 2 | 2 | 2 |
| plan_swot_items | — | **0** | **0** |

## E.2 Fingerprints — every one unchanged

```
legacy 129 activities + 129 milestones (D-022)
  before 4572c57060e20c4b0de4db52545a8e3f
  after  4572c57060e20c4b0de4db52545a8e3f      MATCH

issued documents (31 snapshots, concatenated)
  before c9383e4b0fea0f460560effedeaff7bd
  after  c9383e4b0fea0f460560effedeaff7bd      MATCH

per-snapshot digest (each document hashed individually)
  before 31|3c5c339204c4eca630894eaec850365a
  after  31|3c5c339204c4eca630894eaec850365a   MATCH

performance results (id + result + status of all 11 sessions)
  before 2a23344f21effe96820150692dd23d8a
  after  2a23344f21effe96820150692dd23d8a      MATCH

uploaded-file content digest (sha256 of all file hashes, order-independent)
  before 6a2492535806cae9ff8ae5415931a300471106a081fe46fbe5361cab9d3be4a8
  after  6a2492535806cae9ff8ae5415931a300471106a081fe46fbe5361cab9d3be4a8   MATCH (post-migration)
```

**No existing issued snapshot changed. No existing production business record was rewritten.**
Live finance totals are back at the exact baseline: **received income 5 000 · expenses 2 700 ·
balance 2 300**.

## E.3 Deltas, each accounted for

| Delta | Cause |
|---|---|
| ledger 18 → 22, tables 78 → 83 | the four approved migrations |
| programs total 26 → 28 | 2 temporary acceptance-test programs, **both archived** (active still 26) |
| financial_items 0 → 3 | 2 standard items (المستلزمات، النشاط — created per §6C, active) + 1 test item (archived) |
| budget rows +3 | test income ×2 + test expense ×1, **all archived**, excluded from every total |
| evidence_items 25 → 28 total | 3 test receipts, **all archived**; active back to 25 |
| stored_files 72 → 76 | 3 test receipt images + 1 uploaded SWOT workbook (the preview batch's source) |
| template_definitions 0 → 1 | 1 test template, **archived** |
| import_batches +1 | the SWOT **preview** batch, left in «معاينة» for the principal |
| audit_log grew | normal operational records for the above |

---

# F. Infrastructure evidence

| Item | Result |
|---|---|
| App published port | `0.0.0.0:3080->3080/tcp` — **unchanged** |
| **PostgreSQL** | `5432/tcp`, **no host binding**; `docker port` returns nothing; 0 host listeners on 5432 — **remains unpublished** |
| **Ollama** | `TCP 127.0.0.1:11434 (LISTEN)`; `launchctl OLLAMA_HOST = 127.0.0.1:11434`; LAN `192.168.0.48:11434` **refused** — **remains loopback-only** |
| Open WebUI | untouched, still HTTP 200 on its own port |
| Firewall / router / Tailscale | **not touched** |
| App container | `madrasa-prod-app-1` — healthy, image `b13382d15423`, **RestartCount 0**, started 2026-07-29T11:00:45Z |
| DB container | `madrasa-prod-db-1` — healthy, **RestartCount 0**, started 2026-07-26T09:36:52Z — **identical to the pre-deployment value; never restarted** |
| App log | 8 lines: `next start`, `Next.js 16.2.12`, `✓ Ready in 89ms`. **No migration, seed, SQL, upload or template error.** The only entries are 6 expected `403 لا تملك الصلاحية` from my sysadmin probe of the performance pages (D-013) |
| DB log since deploy | clean. (Three `ERROR` lines earlier today at 05:40/05:41/06:41 UTC are my own read-only exploratory queries with mistyped column names — they predate the deployment.) |
| Disk | 35 GiB free on `/` |

---

# G. Authenticated smoke matrix

Account used: **`admin` (sysadmin)** — a real production account, authenticated normally through
`/login`. No backdoor, no bypass, no created account, no password reset. The `principal` account was
**not** used: its password was changed on 2026-07-26 and I do not hold it.

| # | Workflow | Result |
|---|---|---|
| **A. Authentication and navigation** | | |
| A1 | login | **PASS** |
| A2 | dashboard renders («مركز عمل مدير المدرسة») | **PASS** |
| A3 | direct subpage navigation by URL (`/plan/swot`) | **PASS** |
| A4 | «العودة» present on subpages | **PASS** |
| A5 | «العودة» target correctness | **PASS** — fallback `href="/plan"` (logical parent). *Note: with browser history present the button correctly prefers history; my first assertion wrongly treated that as a failure* |
| A6 | «العودة» on deep pages (committee, meeting, room, cycle, session) | **PASS** |
| A7 | logout | **PASS** |
| A8 | login again | **PASS** |
| **B. Programs** | | |
| B1 | «إضافة برنامج» visible | **PASS** |
| B2 | temporary test program created and listed | **PASS** |
| B3 | «إقفال البرنامج» offered with no evidence | **PASS** |
| B4 | closed with zero evidence | **PASS** |
| B5 | leaves the active list | **PASS** |
| B6 | remains in the «البرامج المغلقة» history section | **PASS** |
| B7 | appears in the historical report | **PASS** |
| B8 | «إعادة فتح البرنامج» offered | **PASS** |
| B9 | reopened | **PASS** |
| B10 | closure history retained after reopen | **PASS** |
| B11 | archived via the supported flow | **PASS** |
| **C. School finance** | | |
| C1 | standard items المستلزمات + النشاط created (controlled flow) | **PASS** |
| C2 | «مصروف/متبقي المستلزمات» and «مصروف/متبقي النشاط» cards present | **PASS** |
| C3 | temporary financial item created with an allocation | **PASS** |
| C4a | income form has **no** program/classification control | **PASS** |
| C4b | income saved school-level, with an attachment made during creation | **PASS** |
| C5a | expense form has **no** program/activity/classification/domain control | **PASS** — *«التصنيف» is an optional free-text descriptor retained from before v2.2, not a program link* |
| C5b | over-allocation warning shown with the amount | **PASS** |
| C5c | **no** «إقرار التجاوز» checkbox | **PASS** |
| C5d | overrun expense **saves** (warning does not block) | **PASS** |
| C6a | per-item allocated / income / spent / remaining correct | **PASS** — `١٠ | ١٠٠ | ٩٩٩ | ؜-٩٨٩ | 9990٪ | 2 | تجاوز` |
| C6b | school balance card | **PASS** |
| C6c | over-allocation counter reflects the overrun | **PASS** |
| C7 | receipt attached to an **already-saved** record (H5 regression) | **PASS** |
| C8 | temporary income/expense archived | **PASS** |
| C9 | temporary item archived; **totals returned to baseline** (5 000 / 2 700 / 2 300) | **PASS** |
| **D. Reports** | | |
| D1 | «تقارير القسم» from budget · plan · committees · building · swot · people · evidence · documents — 8/8 open the right category, no error | **PASS** |
| D2 | reports run: income-register · programs-active · committee-register · rooms-register · **swot-register** | **PASS** |
| D3 | search filter applies | **PASS** |
| D4 | print view — no horizontal overflow | **PASS** |
| D5 | CSV export (`سجل الإيرادات.csv`) | **PASS** |
| D6 | Excel export (`سجل الإيرادات.xlsx`) | **PASS** |
| D7 | exports expose no internal path or sensitive field | **PASS** — column set comes from the registry; a standing test forbids password/session/token/sha256/storagePath/htmlSnapshot |
| **E. Template editor** | | |
| E1 | template created | **PASS** |
| E2 | template duplicated (work done on the copy) | **PASS** |
| E3a | Arabic text edited and rendered in the preview | **PASS** |
| E3b | allowlisted colour applied (`#7a1f1f` in the generated CSS) | **PASS** |
| E3c | font changed (`Amiri`) | **PASS** |
| E4a | section heading renamed and rendered | **PASS** |
| E4b | section reordered | **PASS** |
| E4c | section hidden / shown | **PASS** |
| E5a–b | column hidden — header disappears from the preview table | **PASS** |
| E5c | column renamed | **PASS** |
| E5d | column width applied (`width:35%`) | **PASS** |
| E5e | column reordered | **PASS** |
| E6 | sample-data preview, clearly labelled | **PASS** |
| E7 | draft saved | **PASS** |
| E8 | version published | **PASS** |
| E9a | actual-record preview offers 27 eligible real records | **PASS** |
| E9b | actual-record preview renders with the amber «معاينة فقط» banner | **PASS** |
| E9c | heading switches to «المعاينة (سجل حقيقي)» | **PASS** |
| E9d | real record values rendered | **PASS** |
| E10a | comparison offers both versions | **PASS** |
| E10b | differences listed and grouped | **PASS** |
| E10c | comparison is **read-only** (zero controls inside the diff) | **PASS** |
| E11 | published version still «منشورة» after further edits | **PASS** |
| E12a | **PDF** preview — `application/pdf`, 83 724 bytes, `%PDF` header | **PASS** |
| E12b | **Word** preview — `wordprocessingml`, 9 224 bytes, `PK` container | **PASS** |
| E13 | previously issued documents unchanged after template edit + publish | **PASS** — fingerprint `c9383e4b…` and per-snapshot digest unchanged |
| E14 | test templates archived afterwards; **no production default template altered** (none existed, none set) | **PASS** |
| **F. Committees / building / performance** | | |
| F1a | «العودة» on the committee page | **PASS** |
| F1b | members and tasks shown as **two independent lists** (D-027) | **PASS** |
| F1c | attendance/quorum explicitly excluded («لا حضور ولا غياب ولا نصاب») | **PASS** |
| F2a | «العودة» on the meeting page | **PASS** |
| F2b | minutes carry «التوقيع» | **PASS** |
| F2c | «الصفة» removed from the minutes (round-4) | **PASS** |
| F2d | decisions/recommendations present | **PASS** |
| F3 | «العودة» on building subpage and room page | **PASS** |
| F4a | performance list renders | **PASS** |
| F4b–e | **performance cycle page, session page, final closure without evidence, «التوصيات» wording** | **NOT TESTABLE by me — 403 by design (D-013).** The sysadmin role lacks `performance.individual.read`; both pages correctly return `لا تملك الصلاحية اللازمة لهذا الإجراء`. Handed to the principal (§K) |
| F5 | existing completed performance results unchanged | **PASS** — sessions 11, ratings 128, results fingerprint `2a23344f…` unchanged |

**Correction to my own intermediate output:** three checks (F4c, F4d, F4e) were first reported as
PASS. They were false passes — the page being inspected was the generic 403 error page, which simply
contains none of the strings I was testing for. They are reported above as **not testable**, not as
passes.

---

# H. Temporary test-data disposition

| Created | Identifier | Disposition |
|---|---|---|
| Program (1st run) | `اختبار قبول v2.2 — 1404 (للحذف)` seq 27 | closed, then **archived** |
| Program (2nd run) | `اختبار قبول v2.2 1406 — للحذف` seq 28 | closed, reopened, then **archived** |
| Financial item | `بند اختبار قبول 1410 — للحذف` (allocation 10) | **archived** |
| Income | `إيراد اختبار قبول 1410 — للحذف` (100) | **archived** |
| Income | `إيراد اختبار لاحق 1410 — للحذف` (1) | **archived** |
| Expense | `مصروف اختبار قبول 1410 — للحذف` (999, `INV-TEST-1410`) | **archived** |
| Evidence ×3 | test receipts | **archived** |
| Template | `قالب اختبار قبول 1418 — للحذف` (+ 1 duplicate) | **archived** |
| Uploaded files ×4 | 3× `receipt-test.png` (1×1 px), 1× the official workbook for the SWOT preview | retained in storage; the receipts belong to archived evidence |
| Import batch | SWOT preview `0fa04c75-…` | **left in «معاينة»** deliberately — see §I |

**Kept on purpose:** the two standard financial items **المستلزمات** and **النشاط**. §6C required
creating a financial item where the normal workflow needs one, and the required
«مصروف/متبقي المستلزمات/النشاط» cards only exist once they do. They are the platform's standard
items, created through the controlled idempotent flow, and are configuration the school needs — not
test data. Archive them from `/budget` if you would rather start clean.

**One mistake I made and corrected.** While archiving the three test receipts I also archived one
**pre-existing** evidence item (`e2862d41…`, «فاتورة مصروف», created 2026-07-27) because I selected
by recency rather than by name. I noticed it immediately — active evidence read 24 instead of the
baseline 25 — identified it by creation date and **restored it through the supported
«استعادة الشاهد» flow**. Active evidence is back to **25**, the item is `archived=NO`, and archiving
is a non-destructive soft delete that never touches links, so **no data was lost at any point**.
Reported here rather than left for you to find.

---

# I. SWOT status

## **Preview verified — awaiting your approval to commit.**

Uploaded through the new controlled action **«استيراد التحليل الرباعي»** (`/imports/new?type=plan_swot`).
The full operational-plan import was **not** used and must never be used against the existing data.

| Check | Result |
|---|---|
| Batch | `0fa04c75-53aa-49ea-a7b2-e2dcbd13e198` |
| Type / status | `plan_swot` / **«معاينة»** — not executed |
| Source | `الخطة_التشغيلية_المتكاملة_لمجمع_الخشعة_1448_1449.xlsx` |
| Total rows | **24** — all «جاهز», 0 needing review, 0 excluded |
| Row types present | **`swot` only** |
| قوة | **6** |
| ضعف | **7** |
| فرصة | **5** |
| تهديد | **6** |
| Page states it touches nothing else | **yes** — «مسار مضبوط — التحليل الرباعي فقط … لا يُنشأ ولا يُعدَّل أي برنامج أو مؤشر أو خطر» |
| Committed? | **NO** — `plan_swot_items` = **0**; programs, KPIs (15) and risks (9) untouched |

**To commit** (your decision): open
`http://192.168.0.48:3080/imports/0fa04c75-53aa-49ea-a7b2-e2dcbd13e198`
→ «موافقة صريحة وتنفيذ الاستيراد». Expected after commit: 24 SWOT rows, programs 26, KPIs 15,
risks 9, all fingerprints unchanged. **To discard:** «إلغاء الدفعة (لن تُنفذ)» — nothing is written.

---

# J. Outstanding limitations

1. **Performance-module smoke tests not executed by me** (F4b–F4e) — sysadmin is excluded from
   individual performance data by design (D-013). Requires the principal's account. §K covers it.
2. **A 403 renders as the generic error page** («تعذّر إتمام العملية — حدث خطأ غير متوقع») rather
   than a clear «لا تملك الصلاحية» message. Pre-existing, cosmetic, not introduced by v2.2. Worth a
   future fix so a permission boundary does not look like a crash.
3. **`TRUSTED_ORIGINS` still names `192.168.0.171`; the host is `192.168.0.48`.** Dead configuration,
   **not a fault** — login and Server Actions work (verified again today). The address has now drifted
   .48 → .171 → .48; a router DHCP reservation is the durable answer.
4. **Ollama's loopback binding is session-scoped.** `launchctl setenv` does not survive a reboot; after
   a reboot Ollama defaults to loopback anyway, so the safe state is the default — but a LaunchAgent
   would make it a guarantee.
5. **Open WebUI listens on `*:8080`** — LAN-reachable. Outside the school platform and outside the
   authorised change; flagged for a separate decision.
6. **`BACKUP_PASSPHRASE` appeared in this session's terminal output** when a resolved compose config
   was printed. It is your own value from `.env.production`; consider rotating it if the session
   transcript is shared. I avoided that command form afterwards.
7. **Dev dependencies remain in the production image** (`npm ci` without `--omit=dev`; `tsx` is needed
   by `init`). Documented previously; hardening deferred to its own change.
8. **`brace-expansion` high advisory** — transitive, runtime tree, unreachable (no glob pattern
   anywhere), previously accepted with evidence.

---

# K. Principal acceptance instructions (Arabic)

**افتح:** `http://192.168.0.48:3080/pilot` — وسجّل الدخول بحسابك **principal**.

> النظام مُحدَّث ويعمل. بياناتك كما هي تماماً: ٢٦ برنامجاً · ٥٤ منسوباً · ٣١ وثيقة صادرة ·
> الإيرادات ٥٬٠٠٠ والمصروفات ٢٬٧٠٠ والرصيد ٢٬٣٠٠ — بلا أي تغيير.

**المطلوب منك اختباره (ما لم أستطع اختباره بحسابي):**
- [ ] افتح **دورة أداء** ثم **جلسة أداء** — يجب أن تفتح الصفحتان طبيعياً بحسابك
- [ ] تأكد أن **إنهاء/إقفال جلسة الأداء لا يشترط شواهد**
- [ ] تأكد أن كلمة **«التوصيات»** ظاهرة (بدل «الإجراءات» القديمة)
- [ ] تأكد أن **نتائج الجلسات المكتملة سابقاً لم تتغيّر**

**تحقّق سريع من بقية الجديد (اختُبر آلياً وكله ناجح — للتأكيد فقط):**
- [ ] «إضافة برنامج» · الإقفال بلا شواهد · إعادة الفتح
- [ ] المالية: إيراد ومصروف بلا برنامج · بطاقات المستلزمات والنشاط · تحذير التجاوز **لا يمنع الحفظ** ·
      إرفاق إيصال لسجل **محفوظ مسبقاً**
- [ ] «تقارير القسم» في كل قسم · تصدير CSV وExcel
- [ ] **القوالب:** إخفاء/ترتيب/تسمية الأقسام والأعمدة · ضبط عرض العمود · المعاينة بسجل حقيقي (شريط
      «معاينة فقط» البرتقالي) · مقارنة نسختين (عرض فقط) · معاينة PDF وWord
- [ ] **الأهم:** افتح وثيقة صدرت قبل التحديث — يجب أن تكون **كما هي حرفياً**

**قرار ينتظرك — التحليل الرباعي (٢٤ عنصراً):**
- [ ] افتح `http://192.168.0.48:3080/imports/0fa04c75-53aa-49ea-a7b2-e2dcbd13e198`
- [ ] المعاينة تُظهر **٢٤ عنصراً**: ٦ قوة · ٧ ضعف · ٥ فرص · ٦ تهديدات — ولا تمسّ أي برنامج أو مؤشر أو خطر
- [ ] إن وافقت: «موافقة صريحة وتنفيذ الاستيراد» ← ثم افتح `/plan/swot` للتأكد من ظهور ٢٤ عنصراً
- [ ] إن لم توافق: «إلغاء الدفعة (لن تُنفذ)» — لا يُكتب شيء

**ملاحظات (لا تتطلب إجراءً عاجلاً):** Ollama صار مقصوراً على 127.0.0.1 كما طُلب · عنوان الجهاز
الحالي `192.168.0.48` (الحجز الثابت في الموجّه هو الحل الدائم) · بنداً «المستلزمات» و«النشاط»
أُنشئا ضمن الاختبار ويمكن أرشفتهما إن لم ترغب بهما.

---

# L. Rollback readiness

| Item | Status |
|---|---|
| Previous application image | **retained** — `madrasa-app:0.1.0-prev-v2_2-20260729` = `sha256:fc8654e2bdf8…` (also `-prev-v2_1-20260727` and `-prev-v2-20260723`). **None deleted.** |
| Verified pre-deployment backup | `backups/predeploy/db-20260729-135708.dump.enc` + `storage-20260729-135708.tar.gz.enc` — checksums OK, decrypts, dump valid, archive readable, **test-restored** with matching fingerprints |
| Recovery manifest | `backups/predeploy/RECOVERY-MANIFEST-20260729-135708.txt` |
| Application-only rollback | `docker tag madrasa-app:0.1.0-prev-v2_2-20260729 madrasa-app:0.1.0` then `docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod up -d --no-deps app`. Instant, **no data change** — every migration in this release is additive, so the previous image runs unchanged against schema 22 |
| SWOT-only rollback | if you commit the SWOT import and change your mind: open the batch → «التراجع الكامل». Removes only the 24 rows it created. Rehearsed on a clone |
| Full data rollback (last resort) | `BACKUP_PASSPHRASE=… bash scripts/restore.sh backups/predeploy/db-20260729-135708.dump.enc` — destructive, discards anything entered since |
| Ollama rollback | `launchctl setenv OLLAMA_HOST 0.0.0.0:11434`; `pkill -f 'ollama serve'`; restart with that value |

---

## Stopped here, as instructed

Not done: no release tag · no rollback image deleted · no post-acceptance gold backup · no migration
to the principal's PC · project **not** marked finally accepted · **SWOT import not committed**.
Awaiting the principal's acceptance result.
