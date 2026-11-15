# Father's App RC1 — manual acceptance on a clean Windows 11 laptop

Run this **before** the laptop holds real school data. Use only the synthetic/temporary
accounts the app creates; do not import the Fares batch or any real records during the test.
Record every result (✅ / ❌ + note) in a copy of this file; a single ❌ in a **[STOP]** item
means NO-GO until fixed.

Time needed: ~60 minutes, one USB stick (≥ 4 GB, empty), the release SHA-256 received over
a channel different from the one used to deliver the installer.

## A. Machine pre-checks (before downloading anything)

| # | Check | How | Expected |
|---|---|---|---|
| A1 **[STOP]** | 64-bit Intel/AMD | Settings → System → About → *System type* | "x64-based processor" (ARM64 laptops are not supported by RC1) |
| A2 | Windows 11 22H2 or newer, fully updated | Settings → Windows Update | no pending restart |
| A3 **[STOP]** | Smart App Control state | Windows Security → App & browser control → Smart App Control | **Off** or **Evaluation**. If **On**: stop — RC1 is unsigned and will be blocked; do **not** turn it off just for this app (it cannot be turned back on without resetting Windows). A signed build is required. |
| A4 | Free disk space | File Explorer → This PC | ≥ 5 GB free on C: |
| A5 | Clean machine | Settings → Apps → Installed apps | no Node.js, PostgreSQL, Visual Studio, "Microsoft Visual C++ Redistributable" may or may not be present (record which) |
| A6 | Signed in as the account the principal will use daily | Start menu account picture | note whether the account is an administrator and whether its user name contains Arabic letters |
| A7 | Controlled folder access | Windows Security → Virus & threat protection → Ransomware protection | record On/Off (On may block saving the recovery key to Documents) |

## B. Download and verify the installer

| # | Check | Expected |
|---|---|---|
| B1 **[STOP]** | In PowerShell, in the download folder: `Get-FileHash .\FathersApp-Setup-2.6.0-x64.exe -Algorithm SHA256` | equals the SHA-256 in `docs/WINDOWS_RC1_READINESS.md` §1, character by character |
| B2 | Right-click the file → Properties | size matches the report; "Digital Signatures" tab absent (unsigned RC — expected) |
| B3 | Double-click | SmartScreen "Windows protected your PC" may appear → *More info* shows "Unknown publisher" → only after B1 passed: *Run anyway* |
| B4 | UAC prompt | one prompt, "Unknown publisher"; approve |

## C. Install and first run

| # | Check | Expected |
|---|---|---|
| C1 | Installer finishes without further questions | app window opens by itself (splash «جارٍ التحضير…» then progress messages) |
| C2 | First-run time | login page within ~30 s (CI measured 12–17 s) |
| C3 | Credentials dialog «تم إعداد المنصة لأول مرة…» | two accounts listed; use «نسخ إلى الحافظة» and paste into Notepad (test only) |
| C4 **[STOP]** | Readiness dialog «حماية بيانات المدرسة لم تكتمل بعد» | lists: recovery key not saved, no external folder |
| C5 | Desktop icon "Father's App" exists | yes |
| C6 | `C:\Program Files\FathersApp` | exists; try to create a text file inside it without admin → refused |
| C7 | `%LOCALAPPDATA%\FathersApp` | contains `postgres`, `storage`, `backups`, `config`, `logs` |

## D. Recovery key and off-device backup (must be hard to skip)

| # | Check | Expected |
|---|---|---|
| D1 | In the readiness dialog choose «حفظ مفتاح الاستعادة…», save to **Documents** | message says the file is on this computer only |
| D2 **[STOP]** | Close and reopen the app | readiness dialog appears again ("مفتاح الاستعادة محفوظ على قرص هذا الجهاز فقط") |
| D3 | Insert the USB stick; «النسخ الاحتياطي ← حفظ مفتاح الاستعادة…» → save to the USB stick | confirmation «حُفظ مفتاح الاستعادة وتم التحقق من الملف» |
| D4 | Open the key file in Notepad | Arabic text + a line starting `FATHERSAPP-BACKUP-KEY:` |
| D5 | «النسخ الاحتياطي ← تحديد مجلد النسخ الخارجي…» → a folder on the USB stick | a backup runs immediately; success message mentions the USB path |
| D6 | USB stick contains `FathersApp-backups\full-….tar.gz.enc` and `.sha256` | yes |
| D7 | Choose an external folder on C: instead (then switch back to USB) | warning «هذا المجلد على قرص هذا الجهاز نفسه» |
| D8 **[STOP]** | Restart the app with the USB stick connected | no readiness dialog |
| D9 | «النسخ الاحتياطي ← حالة النسخ الاحتياطي…» | shows last backup, last external copy, key «محفوظ خارج هذا الجهاز» |
| D10 | Delete the copy of the key from Documents | — |

## E. Daily use

| # | Check | Expected |
|---|---|---|
| E1 | Log in as principal; change both temporary passwords; enable TOTP if desired | works |
| E2 | Create a synthetic record (e.g. a test task «تجريبي»), attach a small PDF | saved; attachment preview renders |
| E3 | Generate/download one report as PDF, Word and Excel | files open in Edge/Word/Excel, Arabic text correct, RTL |
| E4 | Print preview (Ctrl+P) | Arabic renders |
| E5 | Double-click the desktop icon while the app is open | same window comes to front; no second copy |
| E6 | Disconnect Wi-Fi / airplane mode, restart the app, repeat E2–E3 | everything works offline |

## F. Close, shutdown, power loss, sleep

| # | Check | Expected |
|---|---|---|
| F1 | Close the window (✕) | «إيقاف قاعدة البيانات بأمان…», app exits within ~10 s; Task Manager shows no `postgres.exe` / `node.exe` from FathersApp |
| F2 | Reopen | starts in a few seconds, still logged in, E2 record present |
| F3 **[STOP]** | With the app open: Start → Power → **Restart** | Windows may briefly show that Father's App is preventing shutdown, then continues on its own; after reboot the app opens normally and E2 record is present |
| F4 | With the app open: Start → Power → **Shut down**, then power on | same as F3 |
| F5 | With the app open: close the lid (sleep) for 5 min, reopen | app keeps working |
| F6 | With the app open: hold the power button (hard power-off), power on, open the app | starts (possibly slower: database recovery); E2 record present. If it does not start: record logs, **do not delete anything** |
| F7 | After F6, check `%LOCALAPPDATA%\FathersApp\tmp` | empty |

## G. Restore drill (proves the backup is usable)

| # | Check | Expected |
|---|---|---|
| G1 | Create a second synthetic record after the last backup | — |
| G2 | «استعادة نسخة احتياطية…» → the backup on the USB stick → «ملف مفتاح الاستعادة…» → the key on the USB stick → confirm with the checkbox | success message names the pre-restore safety copy |
| G3 | G1 record is gone, E2 record and its attachment are present | yes |
| G4 | Try a restore with a wrong key file (edit one character in a copy) | refused with «مفتاح الاستعادة غير صحيح…»; data unchanged |

## H. Uninstall / reinstall (optional on the principal's laptop; required on a test laptop)

| # | Check | Expected |
|---|---|---|
| H1 | Settings → Apps → Father's App → Uninstall | program removed; `%LOCALAPPDATA%\FathersApp` still present |
| H2 | Reinstall the same installer | opens with existing data, not re-seeded |

## I. Sign-off

- All **[STOP]** items ✅, no unexplained ❌.
- Logs folder zipped and kept with this sheet (contains no passwords by design; may contain operational data — keep private).
- Tester, date, laptop model, Windows build (`winver`), installer SHA-256.
