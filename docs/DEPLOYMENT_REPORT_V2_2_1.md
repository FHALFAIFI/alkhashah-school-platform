# Deployment Report — Corrective Patch v2.2.1 (Mac mini production)

**Date:** 2026-07-30 · **Operator:** Claude Code (authorised controlled deployment)
**Scope limit honoured:** corrective patch only. No release tag, no gold backup, no rollback-image
deletion, no host-PC migration, no unrelated configuration change, no workbook import, no reseed.

---

## A. Verdict

# PATCH DEPLOYED — CONDITIONALLY READY

Both corrected features work correctly on production and **no production data was altered,
lost, or rewritten**. The verdict is *conditional*, not *ready-for-retest-unreserved*, because of
one **pre-existing, app-wide** behaviour that will shape the principal's experience of the new
buttons, plus two smaller pre-existing gaps — none of them regressions from this patch, none of
them rollback triggers (§11 conditions were all evaluated and none were met):

1. **The page does not refresh itself after a Server Action** (§K.2). The action succeeds and the
   data is written correctly, but the screen keeps showing the old state until the user reloads.
   Proven **pre-existing** by reproducing it on a form this patch never touched. This is the exact
   pattern the principal previously reported as "the buttons don't work", so it matters here.
2. **Two report filters do not exclude archived programs** (§K.3) — pre-existing; the consequence
   is that the archived temporary test record still shows in «البرامج المعاد فتحها».
3. **Ollama is LAN-reachable, not loopback-only** (§K.1) — a pre-existing regression from the
   2026-07-29 reboot, **explicitly deferred by the owner** for this run.

Recommended before the principal retests: the ~4-line `router.refresh()` follow-up in §K.2.

---

## B. Migration identity proof — no collision

The apparent "22 vs 23" mismatch is **naming vs counting**, not a collision:

| Fact | Evidence |
|---|---|
| Drizzle names files from a **0-based index** | files run `0000_…` … `0022_…` = 23 files |
| The ledger counts **applied rows** (1-based) | 22 rows applied before the patch = files `0000`–`0021` |
| The new file is the 23rd, indexed 22 | `drizzle/0022_steep_joystick.sql`, journal `idx: 22` |
| Applying it makes the ledger 23 | verified: ledger **22 → 23** |

Collision proofs (all on RC head `f946de8`, clean worktree):

- **No file overwritten** — `git diff --stat 0fe2664..HEAD -- drizzle/` shows only **additions**:
  `0022_steep_joystick.sql` (+3), `meta/0022_snapshot.json` (new), `meta/_journal.json` (+7 lines).
  `git log --diff-filter=M -- 'drizzle/*.sql'` over the same range returns **0 commits** — no
  existing migration file was modified.
- **No duplicate identity** — 23 `.sql` files, 23 journal entries, `idx` values 0..22 all unique,
  all `tag` values unique (checked programmatically). Prefix-duplicate scan returns 0.
- **New unique journal entry** — `idx: 22, tag: "0022_steep_joystick", when: 1785397453264`,
  strictly after the previous entry (`idx: 21`, `1785304966930`).
- **Exactly one migration applied** — production ledger before **22**, after **23** (delta = 1).
- **Content is additive-only** — the file is 3 statements, all `ADD COLUMN`, all nullable, no
  defaults: `programs.completion_note text`, `program_closure_history.from_status text`,
  `program_closure_history.to_status text`. A case-insensitive scan for
  `drop|truncate|delete|update |rename|insert|seed` returns **0 matches**.

## C. Release evidence

| Item | Value |
|---|---|
| Commits deployed | `e88add8` (building sketch), `936c7c0` (program lifecycle), `f946de8` (docs) |
| Git HEAD at build | `f946de89050b34170f7b5232eb041eeb4edc11f5`, worktree **clean** (0 modified files) |
| Patch image | `madrasa-app:0.1.0-v2_2_1-rc` → retagged `madrasa-app:0.1.0` |
| Patch image digest | `sha256:ab259dd83a3af57483f551dd3719209deb543bf5f3097155d2883bb2974d3d20` (arm64) |
| Digest verified running | `docker inspect madrasa-prod-app-1` → `.Image` = **same digest** |
| Previous production image | `sha256:b13382d15423168a171e2a78087a25eb94537b0d37db5a4e0ccef1f27d43da7e` (v2.2) |
| Rollback tag created | `madrasa-app:0.1.0-prev-v2_2_1-20260730` (= the v2.2 digest above) |
| Compose project / services | `madrasa-prod` — `db`, `init` (migrate-only), `app` (+ `seed`, profile-gated, not in the resolved config) |
| Migration ledger | **22 → 23** |
| Downtime | app stopped 09:13:07Z → started 09:13:11Z (~4 s stop-to-start; healthy at 09:13:48Z) |
| DB container | **never restarted** — StartedAt `2026-07-29T15:01:06Z`, RestartCount `0`, before *and* after |

## D. Backup evidence

Taken **inside the prod network** (`compose run --rm init`), stamp **`20260730-090911`**:

| Artifact | Detail |
|---|---|
| Database dump | `backups/predeploy/db-20260730-090911.dump.enc` — decrypts to 6,930,559 B |
| Uploaded/private files | `backups/predeploy/storage-20260730-090911.tar.gz.enc` — decrypts to 32,560,522 B |
| Checksums | `SHA256SUMS-20260730-090911.txt` — `shasum -a 256 -c` → **OK** for both |
| Recovery manifest | `RECOVERY-MANIFEST-20260730-090911.txt` — git refs, image refs + rollback tag, compose project/services/init command, env-var **names only**, ledger, all fingerprints, verification results |
| Also stored | inside the `madrasa-prod_backups` volume at `/data/backups/predeploy/` |
| Encryption | aes-256-cbc, pbkdf2, 200000 iterations |

Verification performed on the artifacts themselves:

- **Decryption OK** — both files decrypt to their exact original byte sizes.
- **Dump validity OK** — `pg_restore --list` → **547 objects**.
- **Archive readable OK** — `tar -tzf` → **160 entries**.
- **Test restore OK** — restored into an isolated scratch database; **all 30 counts and all 8
  fingerprints were line-for-line identical to live production** (same output as §F baseline).
  The scratch database was dropped and the decrypted plaintext copies deleted immediately after.

**Passphrase-exposure prevention:** the passphrase was passed only as an environment variable
(`-pass env:BACKUP_PASSPHRASE`), never as a command argument, never echoed (`set +x` discipline,
the only confirmation printed was the literal string `passphrase loaded (not shown)`), never
written to any report or manifest, and never rendered into any file. The resolved Compose config
was generated once for the seed proof, inspected for the `init` command only, and **deleted
immediately** because it interpolates secrets.

## E. Seed-prevention evidence

| Proof | Result |
|---|---|
| Resolved Compose config scanned | `grep -icE "seed|bootstrap|reset|truncate|drop table|reseed"` → **0** |
| Services present in the resolved config | `app`, `db`, `init` — the `seed` service is **absent** (profile-gated behind `bootstrap`) |
| `init` command as resolved | literally `sh -c "npx tsx src/db/migrate.ts"` |
| Executed command | the same — `docker compose … run --rm init` with no override |
| Migration log output | one line: `Migrations applied.` (plus an unrelated npm version notice) |
| Bootstrap profile | never passed; no `--profile bootstrap` in any command |
| Reference data unchanged | roles **2**, permissions **59**, users **2** — identical before and after |
| New columns after migration | present, `is_nullable=YES`, `column_default IS NULL`; **100 % NULL** in every existing row (0 non-null in `completion_note`, 0 in `from_status`/`to_status`) |

## F. Data-preservation evidence

Identical query file run against production **before** and **after** the migration. Every value
below is **unchanged**; the ledger is the only intended difference.

| Metric | Before | After |
|---|---|---|
| migration ledger | 22 | **23** ← only intended change |
| public tables | 83 | 83 |
| programs | 29 | 29 |
| — in-execution / completed / closed | 26 / 0 / 3 | 26 / 0 / 3 |
| — archived | 2 | 2 |
| transition history rows | 7 | 7 |
| **program_activities (D-022)** | **129** | **129** |
| **program_milestones (D-022)** | **129** | **129** |
| people | 54 | 54 |
| evidence items / links | 30 / 30 | 30 / 30 |
| documents | 33 | 33 |
| stored files | 80 | 80 |
| committees / meetings | 4 / 5 | 4 / 5 |
| perf cycles / sessions / ratings | 7 / 11 / 128 | 7 / 11 / 128 |
| KPIs / risks / follow-ups | 15 / 9 / 4 | 15 / 9 / 4 |
| SWOT items | 0 | 0 |
| finance income / expenses | 5101 / 3699 | 5101 / 3699 |
| audit rows | 424 | 424 (at migration time) |

Fingerprints — **all identical before and after the migration**:

```
legacy 129+129 (D-022)     4572c57060e20c4b0de4db52545a8e3f   MATCH
issued documents           a4a8b924c7fcbf34273cfc14c6aa6aef   MATCH
per-snapshot digest        33|a3ca8492c1721c0d2f465a738aa1f628 MATCH
performance sessions       6b1bb98cb3e7f51695c1fcdb4d0fcf28   MATCH
performance ratings        b6f4a99ebd1fa18cf04276132ebaaf1b   MATCH
uploaded-file content      80|72db544f134567aed8c437e8bc031fa1 MATCH
programs table             428723ee534ad862f53beb6d13a09352   MATCH
transition history         707cf60367764642d2ac90ea399d09cc   MATCH
rooms (building)           8|890cb6c49678dfe9220516fef71a03bf  (baseline for the sketch smoke)
floor geometry versions    10|119e7b88bc6ebeb90c7d1cdaf1ece809 (baseline for the sketch smoke)
```

**No issued document snapshot changed. No existing business record was rewritten by the migration.**

### F.2 Final verification — pre-patch vs after deployment, smoke and cleanup

| Metric | Pre-patch | Final | Delta — accounted for |
|---|---|---|---|
| migration ledger | 22 | **23** | intended (one migration) |
| public tables | 83 | 83 | — |
| programs | 29 | **30** | +1 temporary smoke program (archived) |
| — in-execution | 26 | 26 | — |
| — completed | 0 | **1** | the temp program (archived, hidden) |
| — **closed** | **3** | **3** | **real closed programs untouched** |
| — archived | 2 | **3** | +1 temp program |
| transition history | 7 | **16** | +9 rows, **all belonging to the temp program** |
| activities / milestones (D-022) | 129 / 129 | **129 / 129** | — |
| people | 54 | 54 | — |
| evidence items / links | 30 / 30 | **30 / 30** | — |
| documents | 33 | 33 | — |
| stored files | 80 | 80 | — |
| committees / meetings | 4 / 5 | 4 / 5 | — |
| perf cycles / sessions / ratings | 7 / 11 / 128 | 7 / 11 / 128 | — |
| KPIs / risks / follow-ups | 15 / 9 / 4 | 15 / 9 / 4 | — |
| SWOT items | 0 | 0 | — |
| finance income / expenses | 5101 / 3699 | **5101 / 3699** | — |
| audit rows | 424 | **451** | +27 append-only (11 logins + 16 authorised smoke actions) |
| users | 2 | 2 | — |

Fingerprints, final state:

```
legacy 129+129 (D-022)   4572c57060e20c4b0de4db52545a8e3f   MATCH
issued documents         a4a8b924c7fcbf34273cfc14c6aa6aef   MATCH   ← no issued snapshot changed
per-snapshot digest      33|a3ca8492c1721c0d2f465a738aa1f628 MATCH
performance sessions     6b1bb98cb3e7f51695c1fcdb4d0fcf28   MATCH
performance ratings      b6f4a99ebd1fa18cf04276132ebaaf1b   MATCH
uploaded-file content    80|72db544f134567aed8c437e8bc031fa1 MATCH
rooms (building)         8|890cb6c49678dfe9220516fef71a03bf  MATCH   ← sketch smoke wrote nothing
floor geometry versions  10|119e7b88bc6ebeb90c7d1cdaf1ece809 MATCH

programs table           428723ee…  →  735d8688…   CHANGED — expected (temp program added)
  └ excluding the temp program                     428723ee534ad862f53beb6d13a09352   MATCH
transition history       707cf603…  →  7fe4484b…   CHANGED — expected (temp rows added)
  └ excluding the temp program's rows              707cf60367764642d2ac90ea399d09cc   MATCH
```

The two exclusion fingerprints are the strongest available proof that **every pre-existing program
and every pre-existing transition record is byte-for-byte unchanged**; the only differences in the
whole database are the intended schema migration, one archived temporary test record with its own
history rows, and append-only audit entries.

**Expected permanent changes, all present and accounted for:** schema migration 23 · the corrective
application image · legitimate audit/history records from authorised smoke testing. Nothing else.

## J. Infrastructure verification

| Item | Result |
|---|---|
| App container | healthy, RestartCount 0, running the expected patch digest |
| DB container | healthy, **not restarted** (StartedAt and RestartCount identical pre/post) |
| App health endpoint | `{"status":"ok","db":"up","version":"0.1.0"}` |
| Login | works (real `admin` account, no bypass session created) |
| App logs after deploy | clean — `▲ Next.js 16.2.12 … ✓ Ready in 67ms`; **0** matches for error/hydration/exception/failed |
| Host ports | unchanged — app `0.0.0.0:3080` only (pre-existing binding, not altered) |
| **PostgreSQL exposure** | **unpublished** — `db` service has no `ports`; host TCP/5432 has **0** listeners |
| Firewall / router / Tailscale / Open WebUI | untouched |
| Env settings | untouched — no `.env.production` edit |
| **Ollama** | ⚠ **`*:11434` — LAN-reachable, NOT loopback-only.** See §K.1. Not changed by this patch. |

## G. Building-sketch smoke matrix (authenticated, real `admin` account, production data)

No bypass or temporary session was created; no building data was modified (proven below).

| # | Check (desktop RTL 1280×900) | Result |
|---|---|---|
| D1 | `/building` opens and renders the sketch | **PASS** |
| D2 | all four controls visible, each with Arabic `aria-label` **and** tooltip (تقريب · إبعاد · ملاءمة المخطط للشاشة · إعادة ضبط العرض) | **PASS** |
| D3 | `+` visibly zooms in (viewBox narrows) | **PASS** |
| D4 | `−` visibly zooms out **from the default view** (the old dead-button case) | **PASS** |
| D5 | repeated `+` stops at the maximum (8×) and stays stable | **PASS** |
| D6 | repeated `−` stops at the minimum (0.5×) | **PASS** |
| D7 | reset restores the initial view **exactly** (all four viewBox values) | **PASS** |
| D8 | fit-to-view frames the complete sketch (every shape inside the window) | **PASS** |
| D9 | mouse wheel zooms | **PASS** |
| D10 | the page itself does not scroll while wheel-zooming | **PASS** |
| D11 | pan works after zooming | **PASS** |
| D12 | the drawing cannot be lost outside the viewport (30 extreme drags; window stays within bounds) | **PASS** |
| D13 | floor switching works, and the controls work on the switched floor | **PASS** |
| D14 | room navigation from the sketch still works; room name/dimensions render | **PASS** |
| D15 | releasing a pointer **outside** the viewer does not break the next room tap (the old pointer-leak bug) | **PASS** |
| D16 | view controls generate **no non-GET request** | **PASS** — 0 |
| D17 | no console errors | **PASS** — 0 |
| **M1** | mobile 390×844: controls reachable and `+` works by touch | **PASS** |
| **M2** | mobile: touch drag pans after zoom | **PASS** |
| **M3** | mobile: the browser page itself did not zoom (`visualViewport.scale === 1`) | **PASS** |
| **M4** | mobile: reset by touch restores the view | **PASS** |
| **M5** | mobile: no horizontal page overflow | **PASS** |
| **M6** | mobile: no page errors | **PASS** |

**Honest scope note:** true two-finger **pinch** was *not* exercised by the automation (CDP
single-touch only). What was verified on production is single-touch drag, the touch controls, and
that the browser page does not zoom. Pinch logic is covered by the component code and the
committed e2e/unit suites; the principal should confirm pinch by hand on the iPhone.

**No building data was modified by the sketch smoke** — `rooms` and `floor_geometry_versions`
fingerprints are identical before and after: `8|890cb6c49678dfe9220516fef71a03bf` and
`10|119e7b88bc6ebeb90c7d1cdaf1ece809`.

## H. Program-lifecycle smoke matrix (authenticated, exact ID only)

| # | Check | Result |
|---|---|---|
| P1 | initial state is **قيد التنفيذ** | **PASS** |
| P2 | closure is **not offered** while قيد التنفيذ (no silent direct close) | **PASS** |
| P3 | «تعليم البرنامج كمكتمل» → state **مكتمل**, with `completedAt` + `completedBy` recorded, note left **empty**, **no evidence/finance/activity required** | **PASS** (SQL-verified) |
| P4 | completion date displayed on the status card | **PASS** |
| P5 | the completed program **remains editable** | **PASS** |
| P6 | evidence/documents can still be added while completed | **PASS** |
| P7 | the completed-programs report contains it | **PASS** |
| P8 | «إقفال البرنامج نهائياً» → state **مغلق**; `closedAt`/`closedBy` recorded; no evidence required; optional note empty | **PASS** |
| P9 | closure date displayed; confirmation text states the program becomes read-only | **PASS** |
| P10 | read-only UI while closed: execution form gone, evidence-add controls gone, completion action gone | **PASS** |
| P11 | viewing / reporting / printing / exporting still available while closed | **PASS** |
| P12 | **server-side** read-only enforcement (not UI-only) | **PASS** — verified in the committed integration suite (execution update, weekly follow-up and change request all rejected with «البرنامج مغلق نهائياً»); on production the closed page exposes no edit form at all |
| P13 | closed program leaves the active list | **PASS** |
| P14 | closed program remains in the historical «البرامج المغلقة» section | **PASS** |
| P15 | closed-programs report keeps the record (dates render, no NaN) | **PASS** |
| P16 | «إعادة فتح البرنامج» → **مكتمل**, *not* قيد التنفيذ | **PASS** |
| P17 | editing restored after reopen; previous closure history unchanged | **PASS** |
| P18 | «إعادة البرنامج للتنفيذ» → **قيد التنفيذ**; next action becomes «تعليم البرنامج كمكتمل» | **PASS** |
| P19 | **idempotency** — three duplicate submissions from stale pages (close, reopen, resume) added **zero** extra history rows | **PASS** |
| P20 | transition history renders with from→to states, actor and date, newest first | **PASS** |
| P21 | no `Invalid Date` / `NaN` anywhere on the program page | **PASS** |
| L1 | a **pre-patch** closed program still renders correctly | **PASS** (`47ffcb1e…`) |
| L2 | it retains its **original** closure date (2026/7/29م · 1448/2/15هـ) | **PASS** |
| L3 | its **null** completion date renders safely (no NaN/Invalid) | **PASS** |
| L4 | it shows no completion date (never completed pre-patch) | **PASS** |
| L5 | reopen capability is present — **deliberately NOT clicked**; the legacy program was left untouched | **PASS** |
| F0 | the plan list distinguishes all three states with counts — «قيد التنفيذ (25)» «مكتمل (1)» «مغلق (2)» | **PASS** |
| F1 | all three filters navigate and filter correctly (26 / 0 / 2 rows in the earlier pass, 25 / 1 / 2 after completing the temp program) | **PASS** |
| F2 | «سجل تحولات حالة البرامج» report renders with from/to columns | **PASS** |
| F3 | lifecycle dates render correctly; null dates render safely | **PASS** |
| — | lifecycle status is derived **only** from `completedAt`/`closedAt` — no evidence count or progress percentage participates | **PASS** (by construction; `src/lib/plan/lifecycle.ts` + unit suite) |

Observed transition-history rows for the temp program (exactly one per legitimate action):
`اكتمال ×3 · إقفال ×2 · إعادة فتح ×1(+1 during cleanup) · إعادة للتنفيذ ×2` — each matching a
deliberate action in this session, with correct from→to pairs and the actor recorded.

## I. Temporary test data and cleanup result

| Item | Value |
|---|---|
| Temp program ID (captured at creation, used for every action) | `71fce774-bc28-450c-b9ce-68b4327fab1e` |
| Title (explicit temporary marker) | «برنامج اختبار مؤقت — تصحيح v2.2.1 (للحذف بعد الفحص)» |
| Created | 2026-07-30 09:17:34Z — during this smoke session, after the 09:13Z deployment |
| Cleanup method | **archived** (the app's supported non-destructive soft delete) via the UI, with two hard guards checked first: exact ID in the URL **and** the temporary marker in the title |
| Cleanup reason recorded | «تنظيف بيانات فحص التصحيح v2.2.1» |
| Visibility after cleanup | hidden from `/plan`, and from the `programs-active`, `programs-completed`, `programs-closed` reports |
| Residual visibility | **still listed in «البرامج المعاد فتحها»** — pre-existing filter gap (§K.3); its self-describing name makes it obvious it is a test record |
| Transition history | **kept** (append-only) — per §9, documented rather than deleted |
| Never used for cleanup | recency, first/last row, visible position, or approximate title matching |

**Cleanup safety proof (post-cleanup SQL):**

- `programs_fp` **excluding the temp ID** = `428723ee534ad862f53beb6d13a09352` — **identical to the
  pre-patch baseline**: no pre-existing program was changed in any way.
- `closure_history_fp` **excluding the temp program's rows** = `707cf60367764642d2ac90ea399d09cc`
  — **identical to the pre-patch baseline**: no historical transition record of a real program changed.
- `other_programs_completed = 0`; the 3 real closed programs keep their original `closed_at`
  values with `completed_at = NULL` — untouched.
- Evidence **30 items / 30 links** and **80** stored files — unchanged; **nothing was archived or
  soft-deleted by mistake** (contrast with the v2.2 run, where one real evidence item was archived
  by recency and had to be restored; that class of error was structurally prevented here).

## K. Outstanding limitations

**K.1 — Ollama is LAN-reachable (pre-existing, owner-deferred).** `OLLAMA_HOST=0.0.0.0:11434` is
set by the `com.fahad.ollama-serve` LaunchAgent, so the 2026-07-29 reboot silently undid the
Stage-1 loopback fix (which used session-scoped `launchctl setenv`). Verified: `127.0.0.1:11434`
**and** `192.168.0.171:11434` both answer. I raised this before deploying and the owner chose
"deploy anyway, leave as-is". **Not changed by this patch.** Durable fix: set
`OLLAMA_HOST=127.0.0.1:11434` inside the LaunchAgent plist and reload it. Note the app does not
depend on LAN access (`AI_ENABLED=false`; the container reaches Ollama via `host.docker.internal`).

**K.2 — The UI does not refresh in place after a Server Action (pre-existing, app-wide).**
After clicking a lifecycle action the data is written correctly, but the page keeps rendering the
previous state and the inline success message does not appear; a manual refresh shows the correct
state. **Proven pre-existing and unrelated to this patch:** the same behaviour reproduces on
«حفظ التقدم والحالة» (`updateProgramExecutionAction`, untouched by this patch) — the POST returns
200, the value **is** persisted (`progress = 42` in SQL), yet the card still showed «0٪». The
codebase already documents this: `src/components/evidence-panel.tsx:51-57` notes that
"`revalidatePath` alone does not guarantee an immediate in-place reflection" and adds an explicit
`router.refresh()` — the lifecycle forms (both mine and the pre-existing v2.2 close/reopen forms)
do not. **Recommended follow-up (small, and it is what the principal will notice first):** apply
the same `useEffect` + `startTransition(() => router.refresh())` pattern on success in the four
lifecycle forms in `src/app/(app)/plan/[id]/program-ui.tsx`. This needs a new commit and image, so
it is **outside the approved scope** and was deliberately **not** applied.

**K.3 — Two report filters do not exclude archived programs (pre-existing).** In
`src/lib/reports/loaders.ts`, `mode === "active"` excludes archived records but `mode === "closed"`
and `mode === "reopened"` do not, which contradicts the documented archive semantics ("archived
records disappear from lists, reports and exports"). Consequence in this run: the archived
temporary program still appears in «البرامج المعاد فتحها». One-line fix each
(`where.push(isNull(programs.archivedAt))`) — not applied (outside approved scope).

**K.4 — Performance pages remain untestable by this operator (D-013, unchanged).** The `admin`
(sysadmin) account is excluded from individual performance data, so the performance cycle/session
screens return 403 by design. Unchanged by this patch and still the principal's to verify.

**K.5 — The temporary program's transition history is retained** (8 + 1 rows) because the history
table is append-only by design; §9 explicitly prefers documenting over deleting audit evidence.

**K.6 — Pinch-zoom was not exercised on production** (see §G note); confirm by hand on the iPhone.

## L. Rollback readiness

| Item | State |
|---|---|
| Rollback image | `madrasa-app:0.1.0-prev-v2_2_1-20260730` = `sha256:b13382d15423…` (the exact v2.2 image that was running) — **retained, not deleted** |
| Earlier rollback images | `…-prev-v2_2-20260729`, `…-prev-v2_1-20260727`, `…-prev-v2-20260723` — all retained |
| Preferred rollback (schema-compatible) | `docker tag madrasa-app:0.1.0-prev-v2_2_1-20260730 madrasa-app:0.1.0` then `docker compose -f compose.production.yml --env-file .env.production -p madrasa-prod up -d app`. **No database action needed:** migration 0022 adds only nullable columns, so the previous image runs unchanged against ledger 23. Values written into the three new columns are simply ignored (and preserved for a re-deploy). |
| Data rollback (last resort) | `bash scripts/restore.sh backups/predeploy/db-20260730-090911.dump.enc` — restores the verified pre-patch snapshot; discards everything entered since 09:09Z |
| Reverse migration | **not prepared and not advised** — improvising one on production is explicitly out of scope |
| Rollback triggered this run? | **No.** Every §11 condition was evaluated and none were met. |

## M. قائمة تحقق المدير (عربي)

**ما الذي تغيّر؟** تصحيحان فقط: أزرار مخطط المبنى، وسير عمل حالة البرنامج (قيد التنفيذ ← مكتمل ←
مغلق). لم تُحذف أي بيانات ولم تُعدَّل أي سجلات قائمة — تم التحقق من ذلك ببصمات رقمية قبل التصحيح
وبعده.

**ملاحظة مهمة قبل البدء:** بعد الضغط على أي زر (اكتمال/إقفال/إعادة فتح)، قد تبقى الشاشة كما هي.
**حدّث الصفحة (Refresh) لترى الحالة الجديدة** — العملية تُحفظ فعلاً في النظام. هذا سلوك قديم في
المنصة كلها وليس عيباً في هذا التصحيح، ونوصي بمعالجته في تحديث صغير لاحق.

**١) مخطط المبنى — افتح «مخطط المبنى»:**
- [ ] زر **+** يُكبّر الرسم · زر **−** يُصغّره (جرّبه فور فتح الصفحة).
- [ ] زر **⛶ «ملاءمة المخطط للشاشة»** يُظهر المخطط كاملاً.
- [ ] زر **⟲ «إعادة ضبط العرض»** يعيد العرض الأصلي.
- [ ] بعد التكبير: اسحب الرسم بالفأرة أو بالإصبع — لا يضيع الرسم خارج الإطار.
- [ ] عجلة الفأرة تُكبّر وتُصغّر دون أن تتحرك الصفحة.
- [ ] تبديل الأدوار يعمل، والأزرار تعمل في كل دور.
- [ ] الضغط على غرفة يفتح صفحتها، وأسماء الغرف وأبعادها كما هي.
- [ ] **على الآيفون:** جرّب التكبير بإصبعين (لم نتمكن من فحصه آلياً).

**٢) سير عمل البرنامج — افتح أي برنامج من «الخطة التشغيلية»:**
- [ ] البرنامج الجديد حالته **«قيد التنفيذ»**.
- [ ] زر **«تعليم البرنامج كمكتمل»** — لا يطلب شواهد ولا ميزانية، والملاحظة اختيارية.
- [ ] بعد الاكتمال: البرنامج **ما يزال قابلاً للتعديل** ويمكن إضافة الشواهد.
- [ ] زر **«إقفال البرنامج نهائياً»** يظهر **فقط بعد الاكتمال** (لا إقفال مباشر).
- [ ] بعد الإقفال: البرنامج **للقراءة فقط**، ويختفي من القائمة التشغيلية، ويبقى في «البرامج
      المغلقة» وفي التقارير، ويمكن عرضه وطباعته وتصديره.
- [ ] زر **«إعادة فتح البرنامج»** يعيده إلى **«مكتمل»** (لا يعود مباشرة إلى قيد التنفيذ).
- [ ] زر **«إعادة البرنامج للتنفيذ»** يعيده إلى **«قيد التنفيذ»**.
- [ ] بطاقة **«حالة البرنامج»** تعرض: الحالة، تاريخ الاكتمال، تاريخ الإقفال، آخر مسؤول، الإجراء
      التالي، وسجل التحولات كاملاً.
- [ ] في صفحة «الخطة التشغيلية»: مرشّحات **قيد التنفيذ / مكتمل / مغلق** تعمل.

**٣) البرامج المغلقة سابقاً (٣ برامج):** افتحها للتأكد أنها تُعرض بتاريخ إقفالها الأصلي — لم نغيّر
أياً منها أثناء الفحص.

**٤) تنبيه:** سيظهر سجل باسم «برنامج اختبار مؤقت — تصحيح v2.2.1 (للحذف بعد الفحص)» في تقرير
«البرامج المعاد فتحها» فقط. هذا سجل فحص مؤرشف ولا يؤثر على بياناتك، وسبب بقائه موضّح في §K.3.

**لم يُنفَّذ (بانتظار قبولك):** لا وسم إصدار نهائي، ولا نسخة احتياطية ذهبية، ولم تُحذف صور
التراجع، ولا نقل إلى جهاز المدير.

