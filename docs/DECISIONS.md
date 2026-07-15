# سجل القرارات التقنية — Technical Decisions Log

> Language note: this file is technical documentation, so English is permitted per the master prompt.

## D-001 — Repository root
The repository root is the project directory itself. Original reference files stay in `reference_files/` which is **git-ignored** (school data must never enter Git). Derived runtime data lives in `local_data/` (also ignored).

## D-002 — Stack selection (pinned)
| Concern | Choice | Version | Rationale |
|---|---|---|---|
| Framework | Next.js (App Router) | 16.2.10 | Current stable; RSC + server actions suit a modular monolith |
| Language | TypeScript | 5.9.3 | TS 7.x (Go compiler) just shipped; 5.9 is the proven line for Next 16 |
| Runtime | Node.js | ≥20.9 (dev machine: 24.16) | |
| DB | PostgreSQL | 16 (Docker, host port **5544**) | Port 5432 already occupied by another project's container on this Mac |
| ORM | Drizzle ORM + drizzle-kit | 0.45.2 / 0.31.10 | SQL-first, light on 8 GB RAM, transactional SQL migrations |
| Validation | Zod | 4.4.3 | |
| CSS | Tailwind CSS | 4.3.2 | Logical properties give real RTL support |
| Auth | Custom DB-backed sessions + `@node-rs/argon2` | 2.0.2 | No suitable maintained session lib for Next 16; hand-rolled is auditable. Argon2id hashing |
| 2FA | otplib (TOTP) + recovery codes | 13.4.1 | Optional per master prompt |
| 2D plan | Konva / react-konva | 10.3.0 / 19.2.5 | Canvas editing with two-way dimension binding |
| 3D overview | three.js | 0.185.1 | Simple isometric view from same geometry |
| XLSX | exceljs | 4.4.0 | Parse (imports) + generate (exports) |
| DOCX export | docx | 9.7.1 | |
| PDF | Playwright Chromium rendering controlled HTML | 1.61.1 | Only reliable server-side Arabic/RTL shaping; Chromium reused by e2e tests |
| QR | qrcode | 1.5.4 | |
| Hijri | `Intl.DateTimeFormat` with `islamic-umalqura` calendar | built-in | Umm al-Qura compatible, no dependency; official Hijri text from the Ministry calendar is stored verbatim and never recomputed |
| Tests | Vitest (unit/integration) + Playwright (e2e) | 4.1.10 / 1.61.1 | |
| Offline | PWA (manifest + service worker) + IndexedDB queue | hand-rolled | Serwist/next-pwa churn vs Next 16; a small custom SW is auditable and scoped to inspections only |

## D-003 — App port
Dev/prod app port **3080** (3000 commonly taken on this machine).

## D-004 — File storage
`StorageProvider` abstraction with a `LocalStorageProvider` writing under `storage/` (outside `public/`, git-ignored, served only through authenticated, authorized, path-safe API routes). Interface is S3-compatible-ready for later.

## D-005 — Signature & stamp
Imported at seed time from `reference_files/` into `storage/private/branding/` (never Git). Per mapping: `WhatsApp Image 2026-07-15 at 9.23.26 PM.jpeg` = principal signature, `...9.23.25 PM.jpeg` = school stamp. Use is permission-gated and audited. No application-level encryption in first release (approved decision; Tailscale + FS permissions + auth).

## D-006 — Missing reference files (recorded blocker, work continues)
Three files named in the master prompt are **absent** from `reference_files/`:
1. `نماذج تقيم اداء شاغلي الوظائف التعليمية1.pdf` — the 8 official performance models. Official indicator names/weights **must not be invented**, so Phase 3 ships the full model infrastructure (models, indicators, weights, cycles, sessions, scoring) plus the flexible form designer, with the 8 official models left as **pending official content** to be entered/verified visually when the file arrives.
2. `الدليل الارشادي لادارة الاداء الوظيفي.pdf` — guidance only; no invented policy content.
3. `بيانات الموظفين في فارس.xlsx` — the 52-employee source. The full safe-import pipeline is built and tested with **synthetic fixtures**; the real file can be imported through the UI when available.
Also absent: `Pasted markdown.md` (workflow reference only — ignorable by instruction).

## D-007 — Operational plan source of truth
`الخطة_التشغيلية_المتكاملة_...xlsx` is the import source (it is a superset: 26 programs + execution details + deliverables/evidence sheets). The other three plan workbooks are earlier revisions kept for reference only. Official values (including program end date 5/1/1449هـ and Hijri date strings) are stored verbatim.

## D-008 — Dates
Business dates stored as Gregorian ISO (`date`/`timestamptz`). Official Hijri strings from source files stored verbatim alongside. Display: teacher contexts Hijri-first, employee contexts Gregorian-first, both always shown. Calendar snapshots are frozen per cycle (JSONB copy at cycle creation).

## D-009 — Extra reference files not in the prompt's mapping
`الخطة_التشغيلية_الرسمية_...xlsx`, `الخطة_التشغيلية_لمجمع_..._مرتبطة_بالتقويم_...xlsx`, `تحليل_وخطة_...xlsx`, `الخطة_التشغيلية_لمجمع_...docx`, `تقرير_التحليل_والخطة_...docx` — earlier revisions/exports of the same plan; reference only (see D-007). `WhatsApp Image 2026-07-11 at 9.23.33 PM.jpeg` is unmapped; treated as sensitive, not used until identified by the principal.

## D-010 — RBAC design
Permission-based RBAC: `roles` ⇄ `permissions` via `role_permissions`, users get roles. All checks are permission-keyed (e.g. `performance.individual.read`), never role-name-keyed, so future roles (teacher/coordinator) can be added without code changes. Individual performance data requires an explicit permission granted only to the principal role by default.

## D-011 — Import framework
Generic `import_batches` + `import_rows` tables. Every import: upload → parse (no business writes) → preview → validate → correct → explicit approve → transactional commit → error log kept → whole-batch rollback when safe (tracked via `import_batch_id` on created rows).

## D-012 — PDF engine and Chromium
PDF service launches Playwright Chromium with `--font-render-hinting=none`, A4, embedded local Arabic fonts (IBM Plex Sans Arabic, bundled as static assets under version-controlled `src/assets/fonts/` — open SIL license). No network fetch at render time.
