# Third-party components — Father's App (Windows desktop edition)

The installer redistributes the following unmodified third-party components. Exact
versions, download URLs and SHA-256 hashes of every archive and every shipped
executable/DLL are recorded in `BINARIES.lock.json` next to this file.

| Component | Version | License | Source |
| --- | --- | --- | --- |
| Electron (Chromium, Node.js) | 45.3.2 | MIT; Chromium BSD-3-Clause and third-party licenses (`LICENSES.chromium.html` in the install folder) | https://github.com/electron/electron |
| Node.js runtime | 24.22.3 | MIT (+ bundled licenses in `node/LICENSE`) | https://github.com/nodejs/node |
| PostgreSQL server and client tools (EDB Windows binaries) | 16.15-1 | PostgreSQL License (`pgsql/server_license.txt`); bundled libraries per `pgsql/commandlinetools_3rd_party_licenses.txt` | https://www.postgresql.org/ftp/source/ |
| Chrome Headless Shell (Chrome for Testing) | 149.0.7827.55 | BSD-3-Clause + third-party (`LICENSE.headless_shell`) | https://chromium.googlesource.com/chromium/src |
| Poppler utilities (poppler-windows build) | 26.02.0 | GPL-2.0-or-later (`poppler/COPYING`, `poppler/COPYING.gpl2`); bundled libraries under their own licenses | https://gitlab.freedesktop.org/poppler/poppler — build recipe https://github.com/oschwartz10612/poppler-windows |
| Microsoft Visual C++ 2015–2022 runtime DLLs (app-local) | from the Visual Studio redistributable folder | Microsoft Visual Studio redistribution terms | https://learn.microsoft.com/cpp/windows/redistributing-visual-cpp-files |
| npm packages of the application | see `app/node_modules/*/package.json` | per package (MIT/Apache-2.0/ISC/BSD) | https://www.npmjs.com |
| IBM Plex Sans Arabic font | 5.2.9 (@fontsource) | SIL Open Font License 1.1 | https://github.com/IBM/plex |

**GPL source offer (Poppler).** Poppler is distributed unmodified in binary form. Its complete
corresponding source is available at the URL above for the exact tag `poppler-26.02.0`; on
request the school will provide a copy of that source on physical media at no more than the
cost of distribution, for at least three years from the date of this distribution.
