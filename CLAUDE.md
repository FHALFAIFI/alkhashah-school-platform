# CLAUDE.md

Guidance for working in this repository (منصة الإدارة المدرسية المتكاملة — مجمع الخشعة التعليمي للبنين).

## Language policy (permanent)

Use **English** for:
- All responses and progress updates
- Plans and implementation summaries
- Test and acceptance reports
- Technical documentation
- Code comments and commit messages

Keep **Arabic (RTL)** for:
- All visible application UI
- Labels, buttons, statuses, and validation messages
- The in-app AI assistant's customer-facing responses
- PDFs, reports, emails, templates, and school documents
- Official source data, names, and terminology

Rules:
- **Preserve Arabic source content verbatim.** Never paraphrase or "clean up" official
  data, names, or terminology from the source files.
- **Do not rewrite existing files merely to translate developer-language comments.**
  Apply this policy going forward; leave existing Arabic code comments in place unless
  you are already editing that code for another reason.
- Acceptance/verification reports and docs authored from now on are in English, even
  when they describe Arabic UI (quote the Arabic strings inline as needed).

## Stack & environment

- Next.js 16 (App Router) · TypeScript · Drizzle ORM · Postgres 16 (Docker).
- Postgres runs in Docker container `madrasa-db` on host port **5544** (5432 is taken by
  another project). App dev server on port **3080** (`npm run dev`).
- RTL Arabic app (`locale: ar-SA`, `timezoneId: Asia/Riyadh`).
- `tsx` scripts that import `server-only` modules need `NODE_OPTIONS=--conditions=react-server`.

## Commands

- `npm run dev` — dev server on :3080
- `npm test` — Vitest (unit + integration; integration needs the Docker DB up)
- `npm run test:e2e` — Playwright (drives the real app at :3080)
- `npm run typecheck` / `npm run lint`
- `npm run db:generate` / `npm run db:migrate` — Drizzle migrations

## Safety rules (do not violate)

- **Real import batches stay in «معاينة» (preview) and are never committed by the agent.**
  This includes the Fares employee batch and the official operational-plan batch. Executing
  an import is the principal's explicit manual action only.
- **Never commit school data, personal data, signatures, or secrets.** Original school
  files live in git-ignored `reference_files/`; temp credentials in git-ignored
  `storage/private/`. Per-row reports with real names go under `storage/private/`, not Git.
- Verify import/DB-affecting changes through the UI, not by editing the database directly.

## Domain notes

- **D-014** is a documented, unresolved conflict between two ministry source files (3 weight
  cells: models file 5% vs guide 15%). The platform adopts the models file (each sums to
  100%); the principal reconciles against نظام فارس at the first real evaluation cycle.
  Keep it recorded as a separate performance-source issue — unrelated to imports.
- Arabic PDF text extraction from the source files is unreliable; render pages to images
  and verify visually before trusting extracted values.
- Acceptance state and history: `docs/WORKFLOW_ACCEPTANCE_AR.md` (Arabic, source-facing).
  Read `PROGRESS.md` + `git log` before resuming — continue prior work, don't restart.
