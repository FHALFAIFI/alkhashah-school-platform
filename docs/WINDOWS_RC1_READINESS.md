# Father's App — Windows 11 Release Candidate 1: readiness report

Branch `claude/eloquent-lovelace-7kr1k4` · not merged · not deployed · production (Mac/Ubuntu)
and all real school records untouched. Date: 2026-11-15.

## 1. The release-candidate artifact

| Item | Value |
|---|---|
| Installer | `FathersApp-Setup-2.6.0-x64.exe` (NSIS, per-machine, x64, **unsigned**) |
| Built from commit | `@@COMMIT@@` |
| CI run | @@RUN@@ |
| GitHub artifact | `fathersapp-windows-installer` (installer + `SHA256SUMS.txt` + `BINARIES.lock.json` + `SIGNATURES.json`); retention 30 days — **download and archive it before @@EXPIRY@@** |
| Size | @@SIZE@@ bytes |
| **SHA-256** | `@@SHA@@` |

The SHA-256 above is the value printed by the CI "Checksums" step on the Windows runner
that built the file and is the value inside the artifact's `SHA256SUMS.txt`. It is the only
identity of RC1: any other file — even one with the same name — is not RC1.

## 2. Verdict

**Conditional GO** for installing RC1 on the father's laptop, under three conditions:

1. The manual checklist (`docs/WINDOWS_11_ACCEPTANCE_CHECKLIST.md`) is executed on that
   laptop **before** it holds real school data, and every **[STOP]** item passes.
2. Smart App Control on that laptop is **Off** or **Evaluation** (checklist A3). If it is
   **On**, the answer is **NO-GO** until a code-signed build exists — do not turn it off.
3. The recovery key is saved on a USB stick and an off-device backup folder is configured
   during the checklist (section D), i.e. before the first real record is entered.

Without the clean-machine checklist the recommendation is **NO-GO**: CI runs on Windows
Server images with administrator rights, Visual Studio runtimes and no SmartScreen
reputation checks, so it cannot prove the consumer experience (SmartScreen/Smart App
Control, a real reboot with the app open, sleep, a hard power-off, a real USB stick).

## 3. What changed in this review (minimal fixes, each with a regression test)

| # | Finding | Severity | Fix | Test |
|---|---|---|---|---|
| F1 | **The RC-hardening commit `bb2243c` was red on Windows CI** (run 43671088164): the new Windows-shutdown test timed out. The backup-readiness reminder — shown at every launch until the key and off-device folder are set — was an **unparented** message box, i.e. a second unowned top-level window. It received `WM_QUERYENDSESSION`, answered "yes", and the graceful stop never ran. The last green run (43647675275) predates the hardening, so "CI passed" did not cover the current code. | High (release gate; also priority 2: an unowned reminder can slip behind the maximized app) | Every dialog is now owned by the visible main window (modal — cannot be lost behind the app); after a session-ending stop the process exits directly so an open modal cannot keep it alive. | Unit test fails on the old `main.js`; CI step now sends the query to every visible top-level window (as Windows does) and requires: reminder owned by the main window, exactly one unowned window, one veto, PostgreSQL stopped with `pg_ctl fast`, no `postmaster.pid`. |
| F2 | Electron 45's clipboard API is **asynchronous**. Restore → «لصق المفتاح من الحافظة» passed a Promise to the key parser, so this option could never restore (it failed safe: «لم يُعثر على مفتاح صالح», no data touched). | Medium (a recovery path silently broken) | `await clipboard.readText()` / `writeText()`. | Static assertion: no un-awaited clipboard call; `main.js` now type-checks clean against Electron 45 typings. |
| F3 | Guide §7 promised «بياناتك تبقى كما هي» on upgrade. | Low (priority 7) | Reworded: back up off-device first; the update does not delete the data folder. | Guide wording test. |

Local gates: typecheck 0 · lint 0 · Vitest unit 623/623 (desktop 31). The Linux Electron
E2E could not run in this container (it runs as root, which `initdb` refuses); the Windows
CI run executes the same E2E on the target OS and is the authoritative gate.

## 4. Audit results by priority

### 4.1 Installation, runtime security, process lifecycle, recovery

Verified by CI on Windows (run in §1) and by code review:

- **Install**: per-machine NSIS into `C:\Program Files\FathersApp`; one UAC prompt; `Users`
  have no write access to installed binaries (asserted); all 3,559 runtime files of the
  server tree present after install (asserted against a build-time list); desktop shortcut.
  Data lives per user in `%LOCALAPPDATA%\FathersApp`; uninstall keeps data and backups.
- **Network exposure**: PostgreSQL listens on `127.0.0.1` only, `pg_hba` allows only
  `127.0.0.1/32` with SCRAM; the Next.js server binds `127.0.0.1`; readiness is
  token-authenticated; the E2E runs with outbound traffic firewalled and checks the renderer
  cannot reach the network.
- **Electron**: sandboxed renderer, context isolation, no Node integration, navigation and
  `window.open` restricted to the app origin (external links only `https:`/`mailto:` via the
  OS); fuses: no `RunAsNode`, no `NODE_OPTIONS`, app only from asar, encrypted cookies;
  packaged builds ignore `FATHERSAPP_*` path overrides.
- **Secrets**: generated per installation, encrypted at rest with Electron `safeStorage`
  (DPAPI, bound to the Windows user); never logged; PostgreSQL never logs failing statements;
  psql errors and failure logs are redacted.
- **Lifecycle**: single instance; atomic first-run `initdb`; seed only on an empty `users`
  table (CI asserts warm runs never re-seed); migrations only when the journal changes, after
  a pre-upgrade safety backup; job-draining graceful stop; crash/orphan recovery (CI kills
  the whole tree, re-installs over an orphaned PostgreSQL, and proves an unrelated
  PostgreSQL service is untouched); Windows shutdown/restart handled (F1).
- **Residual risks (documented, not changed — architecture)**:
  - The `safeStorage` key lives in Electron's default profile folder under `%APPDATA%`
    while the encrypted secrets file is under `%LOCALAPPDATA%\FathersApp\config`. If either
    is lost, or the Windows password is **reset by someone else** (DPAPI), the app refuses
    to start — it does not re-initialise or delete anything — and the way back is a restore
    with the **recovery key** onto a fresh data folder (support-assisted). This is why the
    recovery key off the device is a [STOP] item.
  - App-local VC++ runtime DLLs are not serviced by Windows Update; they are refreshed only
    by a new installer. Acceptable for an offline, loopback-only app; revisit per release.

### 4.2 Recovery key and off-device backup — hard to overlook

- A modal reminder «حماية بيانات المدرسة لم تكتمل بعد» appears at **every launch** until:
  the key is saved **off this disk**, an off-device folder is set, an off-device copy has
  succeeded within 7 days, and the last automatic backup succeeded (≤ 3 days old).
  After F1 it is owned by the main window and cannot be hidden behind it.
- Saving the key reads the file back and verifies it; saving to the same volume as the data
  keeps the reminder active («محفوظ على قرص هذا الجهاز فقط»).
- Choosing an off-device folder probes writability, warns when it is on the same disk, and
  immediately runs a verified backup to it; «حالة النسخ الاحتياطي» shows the current state.

### 4.3 Manual acceptance checklist

`docs/WINDOWS_11_ACCEPTANCE_CHECKLIST.md` (updated: modal reminder, clipboard-key restore
G5, SHA reference to §1 of this report).

### 4.4 Provenance and redistribution of bundled runtimes

All archives are pinned by SHA-256 in `desktop/binaries.manifest.json`; the fetch script
refuses any mismatch (CI log: "verified" for all four). Authenticode results from the build
(`SIGNATURES.json` in the artifact):

| Component | Source / pin | Signed? | Redistribution | Status |
|---|---|---|---|---|
| Node.js 24.22.3 | nodejs.org; pin matches official `SHASUMS256.txt` | `node.exe` signed **OpenJS Foundation** (CI hard requirement) | MIT; `node/LICENSE` shipped | ✅ |
| PostgreSQL 16.15-1 (EDB zip binaries) | get.enterprisedb.com; **trust-on-first-use pin** (EDB publishes no checksum); 183 files **NotSigned** | No (EDB zip binaries are unsigned) | PostgreSQL License (`server_license.txt`) + bundled-library licenses (`commandlinetools_3rd_party_licenses.txt`) shipped; permissive | ⚠️ provenance rests on one download over TLS from the vendor; independent re-download from this review environment was blocked by its network policy. **Action (non-blocking for RC1):** re-download once on a different network and compare with `25e6fcdf…f81e`. |
| Visual C++ 2015–2022 runtime (8 DLLs, app-local in `node`, `pgsql/bin`, `poppler/bin`) | Visual Studio `VC\Redist\MSVC\…\Microsoft.VC143.CRT` on the build runner | Valid, Microsoft ("Microsoft Windows Software Compatibility Publisher") — CI hard requirement | Allowed as "Distributable Code" under the Visual Studio license terms, **to a licensed Visual Studio user**. The build uses GitHub's runner image. | ⚠️ For a private, non-commercial install this is low risk; before wider distribution either the publisher holds a Visual Studio licence (Community qualifies for individuals) or the installer ships Microsoft's `vc_redist.x64.exe` instead. |
| Poppler 26.02.0 (poppler-windows build) | GitHub release; **pin independently re-verified in this review** (`993e4a94…cda5`, 16,107,283 bytes) | 37 NotSigned | GPL-2.0-or-later: licence texts shipped; written source offer in `THIRD_PARTY_NOTICES.md` (3 years, exact tag) | ✅ (GPL obligations met by the offer; keep it in the install) |
| Chrome Headless Shell 149.0.7827.55 | Google Chrome-for-Testing bucket, pinned | NotSigned (as published) | BSD-3 + third-party licences shipped | ✅ |

### 4.5 Unsigned installer — warning and checksum verification

- Expected on a consumer laptop: SmartScreen «حماية Windows / Windows protected your PC»
  with "Unknown publisher"; UAC shows "Unknown publisher". Both are expected for RC1.
- **Smart App Control "On" blocks unsigned installers outright** and must not be turned off
  for this app (it cannot be re-enabled without resetting Windows) → NO-GO on such a laptop.
- Safe verification (also in the Arabic guide §10 and checklist B1):
  1. Receive the SHA-256 over a **different channel** than the file (phone call or direct
     message — not the same e-mail/chat that carried the installer).
  2. `Get-FileHash .\FathersApp-Setup-2.6.0-x64.exe -Algorithm SHA256`
  3. Compare all 64 characters. Any difference → delete the file, do not run it.
- A matching hash proves the file is the one CI built and tested; it does not prove who
  published it. Code signing (OV/EV or Azure Trusted Signing) remains open for a later RC.

### 4.6 Backup, migration and rollback — data-loss scenarios

| Scenario | Behaviour | Residual risk |
|---|---|---|
| Restore with wrong key / tampered file | Verified (decrypt + manifest hashes + `pg_restore --list`) before any change; refused | none observed (CI harness) |
| Restore fails mid-way | Restored into a staging DB; storage swapped first, then DB renames; any failure reverts both; previous DB/storage kept until the next restore; pre-restore safety backup taken first | If the app cannot start **after** a successful swap, the user is told the restore *was applied* and where the safety copy is |
| Backup from a newer app version / data used by a newer version | Refused / refuses to start (no downgrade onto a newer schema) | Rollback after an upgrade = install previous version + restore the `pre-upgrade` safety copy (support-assisted, guide §8) |
| Upgrade with schema change | Pre-upgrade safety backup, then migrations | Local only — also needs the off-device copy (the guide now says so) |
| Interrupted backup / verify / restore | Decrypted leftovers in `tmp/` and partial `*.part` removed at start; backups serialized; stop waits for an in-flight backup | — |
| Laptop always shut down with the app open | Daily backup also ~90 s after start; Windows shutdown runs the graceful stop | A hard power-off relies on PostgreSQL WAL recovery (checklist F6) — no absolute guarantee, as the guide states |
| Damage noticed late | 14 newest full backups kept locally; **off-device copies are never pruned** | The USB stick eventually fills → the copy fails → the reminder reappears («تعذّر آخر نسخ إلى المجلد الخارجي»). The user must clear old copies manually. |
| Laptop lost/dead **and** recovery key not off-device | Backups cannot be decrypted anywhere | By design; this is exactly what the [STOP] reminder prevents |
| Windows password reset by an administrator / `%APPDATA%` profile cleaned | App refuses to start (secrets undecryptable); nothing is deleted | Recovery needs the recovery key (see 4.1) |

### 4.7 Arabic user guide

Reviewed in full. Power loss: «صُمِّمت … لكن لا يمكن ضمان ذلك في كل الأحوال»; logs: «صُمِّمت
السجلات بحيث لا تُكتب فيها كلمات المرور»; backups: «النسخة التي لم تُجرَّب استعادتها لا يُعتمد
عليها بالكامل»; checksum: «لا يغني عن التوقيع الرقمي». The only remaining absolute (§7
upgrade) was fixed (F3). Assertions in `tests/unit/desktop-edition.test.ts` keep it so.

## 5. Open items (not blocking a controlled RC1 on one laptop)

1. Clean consumer Windows 11 run (the checklist) — **blocking for GO**.
2. Code signing — blocking only where Smart App Control is On, and before wider use.
3. Independent re-download of the EDB PostgreSQL archive on a second network.
4. VC++ redistribution: licensed VS user or ship `vc_redist.x64.exe` before wider use.
5. ARM64 laptops unsupported in RC1.
