# Scope v2.2 — Operational Preparation (Stages 1–3)

**School:** مجمع الخشعة التعليمي للبنين
**Date:** 2026-07-29 · **Host:** Mac mini (`192.168.0.48`, Tailscale `100.99.204.63`)
**Release candidate:** `e43516c2c899ce654d0a83f7d6d6cf166b0d9b1b` (last **code** commit `80a1b9c`; `e43516c` adds this document only)

**Application NOT deployed.** Production remains at migration 18, 78 tables, all counts unchanged,
containers never restarted. The only production-host change made in this round is the Ollama binding
(Stage 1), which was explicitly authorised and touches no container, no data and no firewall rule.

---

# STAGE 1 — Ollama exposure correction ✅ COMPLETE

## 1.1 Original binding (before)

| Item | Value |
|---|---|
| Listener | `ollama` PID **53007** — `TCP *:11434 (LISTEN)` (IPv6 wildcard = all interfaces) |
| Process | `ollama serve`, started **Tue 2026-07-28 22:02:51**, parent = interactive `-zsh` on **ttys002** — a hand-started foreground server in a terminal window, not a supervised service |
| Binary | `/usr/local/bin/ollama` → `/Applications/Ollama.app/Contents/Resources/ollama` |
| **Root cause** | **`launchctl setenv OLLAMA_HOST 0.0.0.0:11434`** — a *global macOS session* variable, inherited by every process launched from the GUI session. Confirmed in the process environment: `OLLAMA_HOST=0.0.0.0:11434` |
| Not the cause | No `OLLAMA_HOST` in `~/.zshrc` / `.zprofile` / `.zshenv`; no LaunchAgent or LaunchDaemon sets it; no Homebrew service |

**Exposure proven before the change** — not assumed:

```
host,   loopback      GET http://127.0.0.1:11434/       -> "Ollama is running"
host,   LAN address   GET http://192.168.0.48:11434/    -> "Ollama is running"      ← exposed
container (separate
network namespace,
stand-in for another
LAN host)             GET http://192.168.0.48:11434/    -> "Ollama is running"      ← exposed
container             GET http://192.168.0.48:11434/api/tags
                      -> {"models":[{"name":"bge-m3:latest", … }]}                  ← unauthenticated
                                                                                       model enumeration
```

## 1.2 Changed configuration

Two parts — the persistent source **and** the running process. Changing only the process would let
the next start re-expose it.

| # | Change | Command |
|---|---|---|
| 1 | Session-global variable → loopback | `launchctl setenv OLLAMA_HOST 127.0.0.1:11434` |
| 2 | Stop the exposed server (Ollama **only**) | `kill 53007` |
| 3 | Start it again on loopback, detached from the terminal | `OLLAMA_HOST=127.0.0.1:11434 nohup /usr/local/bin/ollama serve > ~/AI-Hub/09_Logs/ollama.out.log 2>&1 & disown` |

## 1.3 Exact restart command (as executed)

```bash
launchctl setenv OLLAMA_HOST 127.0.0.1:11434
kill 53007                                    # the previously running `ollama serve`
OLLAMA_HOST=127.0.0.1:11434 nohup /usr/local/bin/ollama serve \
  > ~/AI-Hub/09_Logs/ollama.out.log 2>&1 &
disown
```

Nothing else was stopped, started, restarted, rebuilt or reconfigured.

## 1.4 Verification

| # | Required check | Result |
|---|---|---|
| — | Listener after change | `ollama` PID **7095** — `TCP 127.0.0.1:11434 (LISTEN)` (IPv4 loopback only), TTY `??` (no controlling terminal) |
| **1** | `127.0.0.1:11434` responds locally | ✅ `"Ollama is running"`; `/api/tags` lists models; **functional call** `/api/embed` with `bge-m3` returned a real embedding vector |
| **2** | LAN address not reachable from another LAN host | ✅ **from a separate network namespace (container):** `connect to 192.168.0.48 port 11434 from 172.17.0.2 failed: Connection refused` · **from the host via its own LAN IP:** refused (curl exit 7) · **from the app container via the LAN IP:** refused · **Tailscale address `100.99.204.63:11434`:** refused |
| **3** | School application still responds normally | ✅ `{"status":"ok","db":"up","version":"0.1.0"}` · `/login` 200 · `/dashboard` 307 → `/login` (auth gate intact) · LAN URL `http://192.168.0.48:3080/login` 200 |
| **4** | Ollama-dependent functionality still works where used | ✅ The school app has **`AI_ENABLED=false`** (verified in the running container's environment), so it does not call Ollama at all. And even so, **the app container can still reach it**: `docker exec madrasa-prod-app-1 curl http://host.docker.internal:11434/` → `"Ollama is running"`, model list identical. Docker Desktop proxies `host.docker.internal` from the host's own stack, so it lands on loopback. **No functional regression, now or if AI is enabled later.** The only other consumer, Open WebUI, is a **native host process** (`open-webui serve`, port 8080) and reaches loopback directly — still HTTP 200 |
| **5** | Production containers retain previous uptime | ✅ `madrasa-prod-app-1` Up **46 hours**, `StartedAt 2026-07-27T10:23:50Z`, `RestartCount 0` · `madrasa-prod-db-1` Up **2 days**, `StartedAt 2026-07-26T09:36:52Z`, `RestartCount 0` — identical before and after |
| **6** | PostgreSQL remains unpublished | ✅ `madrasa-prod-db-1  5432/tcp` — no host binding; `docker port` returns nothing |
| — | No migration, no seed, no data change | ✅ migration ledger **18**, programs 26, documents 31, **0 audit rows in the last 2 hours** |
| — | No firewall or Docker exposure broadened | ✅ published ports unchanged (`app 0.0.0.0:3080`, prod db none, dev db 5544); no `pf` rule added or removed |

## 1.5 Rollback command

```bash
# Restore the previous (exposed) binding — only if a LAN client must reach Ollama directly
launchctl setenv OLLAMA_HOST 0.0.0.0:11434
pkill -f 'ollama serve'
OLLAMA_HOST=0.0.0.0:11434 nohup /usr/local/bin/ollama serve \
  > ~/AI-Hub/09_Logs/ollama.out.log 2>&1 &
disown
lsof -nP -iTCP:11434 -sTCP:LISTEN     # expect *:11434 again
```

To clear the override entirely instead (Ollama's own default is already loopback):

```bash
launchctl unsetenv OLLAMA_HOST
pkill -f 'ollama serve'
nohup /usr/local/bin/ollama serve > ~/AI-Hub/09_Logs/ollama.out.log 2>&1 & disown
```

## 1.6 Two honest notes

1. **Durability.** `launchctl setenv` is **session-scoped — it does not survive a reboot**, and neither
   does a `nohup`'d `ollama serve` (the previous setup had the same property: it was hand-started).
   After a reboot, Ollama started with no `OLLAMA_HOST` defaults to **loopback**, i.e. the safe state.
   For a guarantee rather than a default, add a small LaunchAgent that runs
   `launchctl setenv OLLAMA_HOST 127.0.0.1:11434` at login, or set the same value in the Ollama.app
   settings. Recommended, not applied — it adds a persistent host artifact beyond the minimal
   correction that was authorised.
2. **Adjacent observation, deliberately not acted on.** Open WebUI listens on `*:8080` and is
   therefore reachable from the LAN. It is part of the user's separate AI-Hub, not the school
   platform, and was outside the authorised change. Flagged for a separate decision.

---

# STAGE 2 — SWOT import safety rehearsal ✅ COMPLETE (with a required design change)

## 2.1 The full-workbook path was tested first — and it cannot be used

| Step | Result |
|---|---|
| 1. Fresh production clone restored | migration 18 · programs 26 · KPIs 15 · risks 9 · deliverables 26 · budget items 2 · roadmap 312 · documents 31 · plan years 1 |
| 2. Pending v2.2 migrations applied, **no seed** | ledger 18 → **22**, `plan_swot_items` created **empty** |
| 3. Preview of the **real** workbook | `{"برامج":26,"مخرجات":26,"مؤشرات":15,"مخاطر":9,"عناصر التحليل الرباعي":24,"بنود ميزانية":6,"صفوف خارطة":26}` |
| 4. Commit the **full workbook** on the clone | ❌ **FAILED** — `duplicate key value violates unique constraint "programs_year_seq_unique"` |
| — | Batch stayed in **«معاينة»**; the transaction rolled back |
| — | Clone after the failed attempt: programs 26 · KPIs 15 · risks 9 · SWOT **0** · deliverables 26 · budget 2 · documents 31 · issued-snapshot fingerprint `c9383e4b…` — **completely unchanged** |

**Reading of this result.** The failure is *safe* — the platform will not duplicate or overwrite
anything, because the whole commit is one transaction and the unique constraint stops it. But it also
means **the SWOT data can never arrive through a full-workbook re-import**. Per the instruction
("If full workbook re-import could overwrite or duplicate existing data, do not proceed. Implement a
controlled SWOT-only import path"), the full-workbook route was abandoned and a controlled path was
built. Strictly, the trigger condition was *unusable*, not *unsafe* — the outcome is the same.

## 2.2 The controlled SWOT-only import path (commit `80a1b9c`)

A new import type **`plan_swot` — «استيراد التحليل الرباعي»**, reachable from
«دفعات الاستيراد» → «استيراد التحليل الرباعي» (`/imports/new?type=plan_swot`).

It is safe **by construction, not by configuration**:

| Guarantee | How |
|---|---|
| Reads one sheet only | `parseSwotWorkbook()` calls the shared `collectSwotRows()` on «التحليل الرباعي» / «SWOT» and produces rows of type `swot` **only** |
| Writes one table only | `commitSwotRows()` inserts into `plan_swot_items` and nothing else — there is no code path to programs, KPIs, risks, deliverables, budget items or roadmap cells |
| Never invents a plan year | If no plan year exists it refuses: «لا توجد سنة تخطيطية — استورد الخطة التشغيلية أولاً» |
| Never overwrites official text | `(planYearId, code)` is unique and conflicts use `onConflictDoNothing` |
| Never steals ownership | A pre-existing row is **not** attributed to the new batch, so rolling that batch back cannot delete an earlier batch's rows |
| Wrong file is caught before any write | Missing sheet → «لم يعثر على ورقة «التحليل الرباعي» في المصنف»; sheet present but no valid rows → its own Arabic message |
| The principal sees what will happen | Confirm summary: «تأكيد استيراد التحليل الرباعي — لا يُنشأ ولا يُعدَّل أي برنامج أو مؤشر أو خطر» with per-type counts |

## 2.3 Rehearsal on a fresh production clone with the real workbook

Clone restored again from a read-only production dump, migrated to 22 without seed.

| # | Check | Result |
|---|---|---|
| 3–4 | Preview identifies the SWOT rows | **24 rows** — `{"قوة":6,"ضعف":7,"فرصة":5,"تهديد":6}`; row types present = **`["swot"]` only** |
| — | Confirm summary shown to the principal | «تأكيد استيراد التحليل الرباعي — لا يُنشأ ولا يُعدَّل أي برنامج أو مؤشر أو خطر» · 24 / 6 / 7 / 5 / 6 |
| 5 | Commit on the clone | batch **«منفذة»**, created `{"عناصر التحليل الرباعي":24}` |
| 6 | 24 SWOT records exist | ✅ 24 — `{"قوة":6,"ضعف":7,"فرصة":5,"تهديد":6}`; text stored verbatim (e.g. `تهديد-01` = «عدم استقرار الإنترنت» / «قد يعطل الاختبارات والمنصات والمتابعة الرقمية») |
| 6 | Programs remain 26 | ✅ 26 |
| 6 | KPIs remain 15 | ✅ 15 |
| 6 | Risks remain 9 | ✅ 9 |
| 6 | No unrelated record duplicated | ✅ deliverables 26 · budget items 2 · roadmap cells 312 · documents 31 · plan years 1 — every count identical to baseline |
| 6 | Issued snapshots byte-identical | ✅ `c9383e4b0fea0f460560effedeaff7bd` before and after |
| 7 | Import the same workbook a second time | batch **«منفذة»**, created `{"عناصر موجودة مسبقاً (لم تتغيّر)":24}` |
| 8 | No duplicated SWOT rows | ✅ still 24, **same row ids**, same text |
| 8 | No duplicated programs / KPIs / risks | ✅ 26 / 15 / 9 — and nothing else moved |
| 8 | No overwrite of manually maintained data | ✅ a manual edit («ملاحظة يدوية من المدير» on `قوة-01`) **survived a third import** unchanged |
| 9 | Wrong workbook previewed but not committed | ✅ the Fares employee workbook was **rejected at preview**: «لم يعثر على ورقة «التحليل الرباعي» في المصنف — اختر مصنف الخطة التشغيلية المتكامل». Nothing written. A wrong *plan-shaped* batch that does reach preview stays in «معاينة» and is cancelled with «إلغاء الدفعة» — status becomes «ملغاة» and no row is written (proven earlier by the failed full-workbook attempt, which left the clone bit-for-bit unchanged) |
| 9 | Rollback of an executed batch | ✅ rolling back batch #1 removed **only its own 24 rows** (SWOT 24 → 0); programs 26 · KPIs 15 · risks 9 · documents 31 unchanged; batch status «متراجع عنها» |

**One behaviour the principal should know:** rollback undoes *what that batch created*. If a SWOT row
created by batch #1 was later edited by hand, rolling back batch #1 removes that row along with the
edit. This is the platform-wide rollback semantic, not new behaviour.

## 2.4 Regression coverage added

4 integration tests (`tests/integration/import-plan.test.ts`) — controlled path yields `swot` rows
only; rejects a workbook without the sheet; commit touches no other table, is idempotent, and each
batch's rollback removes only its own rows; commit before a plan year exists is refused. Plus 1 e2e
test (`tests/e2e/plan-import.spec.ts`) proving the button and the page are reachable and that the
page states, before any upload, that programs/KPIs/risks are not touched.

## 2.5 Gates re-run after the Stage 2 code change

| Gate | Result |
|---|---|
| `npm run typecheck` | **PASS** — 0 errors |
| `npm run lint` | **PASS** — 0 / 0 |
| `npm run build` | **PASS** |
| **Vitest** | **PASS — 610 / 610**, 66 files (was 606) |
| **Playwright** | **PASS — 73 passed · 1 skipped · 0 failed** (was 72; skip = C5, deferred under D-018) |
| Clone destroyed, dump deleted | ✅ `madrasa_swot_test` dropped; no real school data left outside production |
| Production after Stage 2 | ✅ migration **18**, 78 tables, programs 26 · KPIs 15 · risks 9 · documents 31, **0 audit rows in 2 hours**, containers still Up 46 h / 2 days |

---

# STAGE 3 — Final deployment plan (Mac mini)

**This section is a plan. Nothing in it has been executed.**

## 3.1 Release candidate

| Item | Value |
|---|---|
| Branch | `scope-v2.1-corrections` |
| **RC head (deploy this)** | **`e43516c2c899ce654d0a83f7d6d6cf166b0d9b1b`** |
| Last commit that changes code | `80a1b9c9381628d1ba0e7c4f82d89d9df2a549c9` — `e43516c` is documentation only, so the built image is byte-equivalent |
| Commits in this release | `ba72f73` (gap closure: template structure editor, version diff, record preview, SWOT model) · `673623b` (final gap-closure report) · `80a1b9c` (controlled SWOT-only import path) · `e43516c` (this plan) — on top of the accepted v2.2 base `b591be2` |
| Base already in production | `501e7e2` (v2.1 head) → running image `madrasa-app:0.1.0` (`fc8654e2`) |
| **Target image** | `madrasa-app:0.1.0` rebuilt from the RC. Pre-verified build of the identical tree: `madrasa-app:0.1.0-v2_2-rc`, manifest `sha256:b13382d15423168a171e2a78087a25eb94537b0d37db5a4e0ccef1f27d43da7e` — builds clean on linux/arm64 with the `postcss 8.5.24` / `sharp 0.35.3` overrides and their native binaries |
| Rollback image | `madrasa-app:0.1.0-prev-v2_2-<date>` (tagged in step 2 below) |
| **Current migration state** | **18** |
| **Target migration state** | **22** (adds 0018, 0019, 0020, 0021) |

## 3.2 The plan

```bash
cd ~/Developer/School/"Father's File"

# ─── 0) Confirm the starting point ────────────────────────────────────────────
git rev-parse HEAD                                            # expect e43516c2…
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from drizzle.__drizzle_migrations;"        # expect 18
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from pg_tables where schemaname='public';" # expect 78

#     BASELINE to compare against afterwards — record these four values
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select 'programs',count(*) from programs
   union all select 'program_activities',count(*) from program_activities
   union all select 'program_milestones',count(*) from program_milestones
   union all select 'people',count(*) from people
   union all select 'documents',count(*) from documents
   union all select 'program_kpis',count(*) from program_kpis
   union all select 'program_risks',count(*) from program_risks
   union all select 'audit_log',count(*) from audit_log;"
#     expect  26 / 129 / 129 / 54 / 31 / 15 / 9 / 339

#     Legacy fingerprint (D-022)
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc "
  select md5(string_agg(t,'|')) from (
    select id::text||coalesce(name,'')||coalesce(status,'')||coalesce(progress::text,'') as t
      from program_activities
    union all
    select id::text||coalesce(title,'')||coalesce(status,'')||coalesce(progress::text,'') as t
      from program_milestones
    order by 1) s;"
#     expect 4572c57060e20c4b0de4db52545a8e3f

#     Issued-document snapshot fingerprint
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select md5(string_agg(doc_number||coalesce(html_snapshot,''),'|' order by doc_number)) from documents;"
#     expect c9383e4b0fea0f460560effedeaff7bd

# ─── 1) Fresh encrypted backup — taken INSIDE the prod network ────────────────
#     (the backup guard refuses the dev DSN, so it must run through compose)
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm -e DATABASE_URL="postgresql://madrasa:$POSTGRES_PASSWORD@db:5432/madrasa" \
  init sh -c 'npm run backup:daily'

# ─── 2) Checksum verification — do not continue unless every line says OK ─────
(cd backups/predeploy && shasum -a 256 -c SHA256SUMS-*.txt | tail -5)
ls -lh backups/predeploy | tail -4

# ─── 3) Tag the current image for rollback (BEFORE rebuilding) ────────────────
docker tag madrasa-app:0.1.0 madrasa-app:0.1.0-prev-v2_2-$(date +%Y%m%d)
docker images | grep madrasa-app

# ─── 4) Build the new image ───────────────────────────────────────────────────
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod build app

# ─── 5) Apply migrations 18 → 22.  MIGRATE ONLY. ──────────────────────────────
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  run --rm init

# ─── 6) Recreate the APP CONTAINER ONLY — the database is never touched ───────
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --no-deps app
```

## 3.3 Explicit proof that `seed.ts` is not invoked

Three independent layers, each checkable before pressing anything:

1. **The `init` service cannot run it.** `compose.production.yml` defines
   `init.command = ["sh","-c","npx tsx src/db/migrate.ts"]` — migrate only. Verify literally:
   ```bash
   docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod config \
     | grep -A3 -E '^\s+init:' | grep -i command
   # expect:  command: [sh, -c, npx tsx src/db/migrate.ts]     — the word "seed" must not appear
   docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod config \
     | grep -c "seed.ts"
   # expect: 1  — the single occurrence is the `seed` service, which is profile-gated
   ```
2. **The seeding service is behind an explicit profile** (`profiles: ["bootstrap"]`), so it is not
   started by `up`, `run --rm init`, or any command in this plan. It runs only if someone types
   `--profile bootstrap run --rm seed`, which this plan never does.
3. **The image's default command does not seed.** `Dockerfile.production` ends with
   `CMD ["npm","run","start"]`; `npm run start` is `next start -p 3080`.
4. **Post-hoc proof** (step 7 below): the five tables introduced by 0018–0021 must all be **empty**
   after migration, and every new nullable column must be **100 % NULL**. Seeding would violate both.
   This exact assertion passed on the production clone.

## 3.4 Post-deployment verification

```bash
# ─── 7) Health, schema, counts, fingerprints ──────────────────────────────────
curl -s http://127.0.0.1:3080/api/health                       # {"status":"ok","db":"up",…}
docker ps --format '{{.Names}} {{.Status}} {{.Ports}}' | grep madrasa-prod
#     db MUST show 5432/tcp only (no host binding)

docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from drizzle.__drizzle_migrations;"         # expect 22
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select count(*) from pg_tables where schemaname='public';"  # expect 83  (78 + 5 new)

#     DATA-COUNT COMPARISON — must equal the step-0 baseline exactly
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select 'programs',count(*) from programs
   union all select 'program_activities',count(*) from program_activities
   union all select 'program_milestones',count(*) from program_milestones
   union all select 'people',count(*) from people
   union all select 'documents',count(*) from documents
   union all select 'program_kpis',count(*) from program_kpis
   union all select 'program_risks',count(*) from program_risks;"
#     expect 26 / 129 / 129 / 54 / 31 / 15 / 9   (audit_log will have grown — that is correct)

#     LEGACY FINGERPRINT COMPARISON (D-022)
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc "
  select md5(string_agg(t,'|')) from (
    select id::text||coalesce(name,'')||coalesce(status,'')||coalesce(progress::text,'') as t
      from program_activities
    union all
    select id::text||coalesce(title,'')||coalesce(status,'')||coalesce(progress::text,'') as t
      from program_milestones
    order by 1) s;"
#     expect 4572c57060e20c4b0de4db52545a8e3f   (UNCHANGED)

#     ISSUED-SNAPSHOT COMPARISON
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select md5(string_agg(doc_number||coalesce(html_snapshot,''),'|' order by doc_number)) from documents;"
#     expect c9383e4b0fea0f460560effedeaff7bd   (UNCHANGED)

#     SEED PROOF — all five new tables empty, all new columns NULL
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select 'plan_swot_items',count(*) from plan_swot_items
   union all select 'financial_items',count(*) from financial_items
   union all select 'program_closure_history',count(*) from program_closure_history
   union all select 'template_definitions',count(*) from template_definitions
   union all select 'template_versions',count(*) from template_versions;"
#     expect 0 / 0 / 0 / 0 / 0
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select 'closed_at',count(*) from programs where closed_at is not null
   union all select 'created_by',count(*) from programs where created_by is not null
   union all select 'template_version_id',count(*) from documents where template_version_id is not null;"
#     expect 0 / 0 / 0

#     Ollama still loopback-only (Stage 1 must survive the deployment)
lsof -nP -iTCP:11434 -sTCP:LISTEN          # expect 127.0.0.1:11434 only
curl -s --max-time 4 http://192.168.0.48:11434/ || echo "LAN refused — correct"
```

## 3.5 Authenticated smoke tests (principal, in the browser)

Run at `http://192.168.0.48:3080` or the Tailscale hostname. Every item is a click-through with an
observable effect — not a page load.

| # | Area | Test | Expected |
|---|---|---|---|
| 1 | **Login** | Sign in as principal | Reaches `/dashboard`; `/dashboard` without a session redirects to `/login` |
| 2 | **Add a program** | `/plan` → «إضافة برنامج» → save with **no fields filled** | Program appears immediately as «بدون عنوان»; double-clicking save creates only one |
| 3 | **Close a program** | Open it → «إقفال البرنامج» → confirm | Leaves the operational list, appears under «البرامج المغلقة» with «مغلق»; closure date recorded |
| 4 | **Reopen** | «إعادة فتح البرنامج» | Returns to the active list; the earlier closure stays visible in the history |
| 5 | **School-level income** | `/budget` → add income with **no program and no classification** | Saves; appears in the list and in the totals |
| 6 | **School-level expense** | Add an expense exceeding the item's allocation | **Saves**, shows the Arabic overrun warning with the amount, **no acknowledgement checkbox** |
| 7 | **Financial item calculations** | Create an item, set an allocation, post income and expense against it | «المخصص / الإيرادات / المصروفات / المتبقي» all correct for **that item only**; other items unchanged |
| 8 | **Receipt on a NEW record** | Attach an image or PDF while creating an income/expense | Saved and listed with its invoice number |
| 9 | **Receipt on an EXISTING record** | Attach a receipt to a row saved earlier | Attaches without re-entering the row (this is the H5 regression — verify explicitly) |
| 10 | **Reports** | `/reports` → open a category → run a report → export CSV and Excel | Report renders; exports download and open in Arabic correctly |
| 11 | **Report deep links** | «تقارير القسم» from الخطة · المخاطر · **التحليل الرباعي** · المالية · الشواهد · الأداء · اللجان · المبنى · المنسوبون · الوثائق · الاستيراد · التقويم · المهام · مؤشرات الأداء · المتابعة · التدقيق · الملاحظات | Each opens its own category (and named report) with no error |
| 12 | **Template text and colour** | `/admin/templates` → create → edit title, intro, primary colour, font | Preview updates live |
| 13 | **Section editing** | Hide «الملاحظات»; move it up; give «المقدمة» a heading | Preview reflects each change immediately |
| 14 | **Column editing** | Hide «المجال»; rename «البرنامج»; set a width | Preview table changes accordingly |
| 15 | **Version comparison** | Save → publish → edit → save → compare the two versions | Grouped Arabic differences; **no editing control inside the comparison** |
| 16 | **Sample preview** | Default preview with no record selected | Renders with «بيانات نموذجية» |
| 17 | **Actual-record preview** | Pick a real program → «معاينة بسجل حقيقي» | Real values shown; amber «معاينة فقط» banner; afterwards **no new document** in «الوثائق الصادرة» |
| 18 | **PDF preview** | «معاينة PDF» | PDF opens, Arabic RTL correct, hidden columns absent |
| 19 | **Word preview** | «معاينة Word» | .docx downloads and opens with the same sections/columns |
| 20 | **SWOT page** | `/plan/swot` | Before import: Arabic empty state naming the import. After the SWOT import: **24 items** — 6 قوة / 7 ضعف / 5 فرص / 6 تهديدات |
| 21 | **SWOT report** | «تقارير القسم» from `/plan/swot` | Opens «سجل التحليل الرباعي» with the same 24 rows; «التحليل الرباعي حسب النوع» shows 6/7/5/6 |
| 22 | **Global back navigation** | Open a deep page directly by URL (e.g. `/plan/swot`, a committee meeting, a perf session) then press «العودة» | Returns to the logical parent — not always the dashboard; works on mobile RTL |
| 23 | **Frozen history (most important)** | Open a document issued **before** this release, then edit and publish its template, then reopen the document | The document is **byte-identical** — unchanged |

**SWOT population (a separate, later, principal-only action).** After the smoke tests pass:
«دفعات الاستيراد» → «استيراد التحليل الرباعي» → upload
`الخطة_التشغيلية_المتكاملة_لمجمع_الخشعة_1448_1449.xlsx` → preview shows **24 rows (6/7/5/6)** and the
notice that no program/KPI/risk is touched → commit. Verify `/plan/swot` then shows 24. **Do not use
«استيراد الخطة التشغيلية» for this** — that path will fail on the existing programs.

## 3.6 Rollback commands

```bash
# ── A) Application-only rollback — the expected path. Instant, no data change. ──
#    Every migration in this release is additive, so the previous image runs
#    unchanged against schema 22.
docker tag madrasa-app:0.1.0-prev-v2_2-<date> madrasa-app:0.1.0
docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod \
  up -d --no-deps app
curl -s http://127.0.0.1:3080/api/health
docker exec madrasa-prod-db-1 psql -U madrasa -d madrasa -tAc \
  "select md5(string_agg(doc_number||coalesce(html_snapshot,''),'|' order by doc_number)) from documents;"
#    expect c9383e4b0fea0f460560effedeaff7bd

# ── B) Undo a SWOT import only (if the wrong workbook was committed) ───────────
#    From the UI: open the batch under «دفعات الاستيراد» → «التراجع الكامل».
#    It deletes only the SWOT rows that batch created. Programs, KPIs, risks and
#    documents are untouched. Rehearsed on the clone.

# ── C) Full data rollback — destructive, last resort only ─────────────────────
#    Discards everything entered since the backup. Use only on data corruption.
BACKUP_PASSPHRASE=… bash scripts/restore.sh backups/predeploy/db-<stamp>.dump.enc

# ── D) Undo the Ollama change (Stage 1) ──────────────────────────────────────
launchctl setenv OLLAMA_HOST 0.0.0.0:11434
pkill -f 'ollama serve'
OLLAMA_HOST=0.0.0.0:11434 nohup /usr/local/bin/ollama serve \
  > ~/AI-Hub/09_Logs/ollama.out.log 2>&1 & disown

# ── E) Discard the release entirely from the repository ──────────────────────
git reset --hard 501e7e2      # migrations 0018–0021 were never applied to production
```

**Recovery point already verified today:** `backups/predeploy/db-20260727-131643.dump.enc` —
`SHA256SUMS` OK, decrypts, restores to 78 tables / migration 17 / programs 26 / activities 129 /
milestones 129 / people 54 / users 2.

## 3.7 What this deployment does NOT do

No reset, truncate or reseed · the database container is never recreated · no port, firewall, Docker,
PostgreSQL or Ollama exposure change · no production workbook re-import (that is the principal's own
later action) · no release tag · no gold backup · no migration to the principal's PC.

---

## Open items carried into deployment

| Item | Status |
|---|---|
| **`TRUSTED_ORIGINS` names `192.168.0.171`, but the host is now `192.168.0.48`** | Dead configuration, **not a fault** — verified previously: Next only consults `allowedOrigins` when Origin ≠ Host, so LAN login works. Optional cleanup: drop the IP entry, keep the Tailscale hostname. A router DHCP reservation is the durable answer. The address has now drifted **twice** (.48 → .171 → .48) |
| Open WebUI listens on `*:8080` | Outside the school platform and outside the authorised change — flagged for a separate decision |
| `brace-expansion` high advisory | Transitive, runtime tree, **unreachable** (no glob pattern anywhere), accepted with evidence |
| Dev dependencies present in the production image | Accurate description recorded; hardening deferred to its own change |
| Disclosed feature gaps not in this round's scope | saved report configs · configurable report columns · Word export from the report centre · page-break preview · template logo picker · term/academic-year finance cards · unsaved-changes warning · nonce CSP · per-entity file-download scoping |
