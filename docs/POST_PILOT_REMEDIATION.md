# Post-Pilot Remediation

Working log for the post-pilot remediation, clean-production reset, building-module
rebuild, and Docker homelab deployment. English per the repository language policy; the
customer-facing application stays Arabic/RTL. This file is appended to as each phase
completes — do not restart; continue from the last checkpoint.

Related: `PROGRESS.md`, `docs/DECISIONS.md`, `docs/WORKFLOW_ACCEPTANCE_AR.md`,
`docs/CLEAN_PRODUCTION_BASELINE.md` (Phase 7), `docs/UI_ACTION_AUDIT.md` (Phase 1).

---

## Principal feedback (source of this engagement)

1. Buttons throughout the application do not work reliably.
2. Assets need a safe deletion workflow.
3. All demo/fake data must disappear from the active production system so real data can be re-imported.
4. The building module needs three scanning capabilities: editable inspection templates, phone document scanning, QR-code scanning.
5. Inspection templates currently cannot be created or edited.
6. The existing building sketch is not suitable.
7. The principal wants to create rooms manually and arrange them on a simple 2D sketch.
8. Deploy properly with Docker on a homelab server.
9. Remote access via Tailscale (private; no Funnel).
10. The principal must be able to retest and submit feedback.

Non-negotiable safety rules are recorded verbatim in the engagement brief and mirrored in
`CLAUDE.md`. The controlling ones for destructive steps: never destroy or delete the old
production DB/storage; create a fresh clean production DB/volume and keep the old one as a
cold encrypted checkpoint; never auto-commit the Fares batch; never auto-approve the plan;
never create employee accounts; never auto-resolve D-014; never publish building floors
without approval; no public Postgres/Ollama/SSH; no Tailscale Funnel; never fabricate PASS.

---

## PHASE 0 — Baseline, backup, restore rehearsal  ✅ PASS (2026-07-19)

### Baseline (captured read-only)

| Item | Value |
| --- | --- |
| Git branch / HEAD | `main` / `35b720e` (working tree clean at start) |
| App dev server | Next.js 16, port **3080** (running, PID node) |
| Postgres | Docker `madrasa-db`, `postgres:16-alpine`, host port **5544** → 5432 |
| Ollama | host-native, `127.0.0.1:11434` (local AI, optional) |
| Production DB | `madrasa` (owner `madrasa`, UTF8) |
| Test DB | `madrasa_test` (isolation guard: `MADRASA_ENV=test` requires a `_test` DB name) |
| Applied migrations | 8 (`0000`…`0007`), hashes recorded in the recovery manifest |
| Public tables | 66 |
| Uploaded files | 181 `stored_files` rows / **184** physical files under `storage/` (5.8M) |
| Docker files (pre-existing) | `Dockerfile` (single dev-oriented image), `docker-compose.yml` (db always; app under `production` profile) |
| PWA | `public/sw.js` (cache `madrasa-offline-v1`), registered only from `/building/offline`; `manifest.webmanifest` |
| Tailscale assumptions | `tailscale serve --bg localhost:3080` (NO Funnel); `TRUSTED_ORIGINS` default `*.ts.net`; Secure cookies behind HTTPS; QR host-derived. Gate C5 (real-HTTPS camera) = DEFERRED_BY_PRODUCT_OWNER (D-018). |

Domain row counts (real `madrasa`, non-empty tables): users 2, roles 2, permissions 55,
role_permissions 108, people **80**, programs **58**, program_milestones 194,
program_deliverables 42, program_roadmap_cells 312, plan_years 1, committees 15,
committee_members 29, meetings 14, meeting_outcomes 14, perf_cycles 14, perf_models 9,
perf_indicators 123, perf_ratings 286, documents 56, evidence_items 149,
floors 5, rooms **17**, assets **3**, inspections **11**, maintenance_issues 11,
inspection_templates 5, import_batches **77**, import_rows 657, audit_log 1214,
stored_files 181, sessions 305, feedback 0.

> Data provenance note: the `madrasa` DB mixes **official** data (26 preserved programs, the
> official 1448-1449 calendar, the 8 ministry performance models, 6 committee templates) with
> **synthetic scenario** data created by earlier e2e/scenario runs (the 80 people, the 17
> `KHS-RM-*` rooms, 3 assets, 11 inspections/maintenance, ~32 demo programs). The **real Fares
> staff batch remains uncommitted in «معاينة»** (in `import_rows`, 0 rows written to `people`).
> This is exactly the mix the principal wants cleaned (feedback #3) — handled non-destructively
> in Phase 7 (cold checkpoint + fresh empty production DB), never by truncation here.

### Backup + restore rehearsal (Quality Gate 0)

- `npm run restore:rehearsal` → PASS: fresh encrypted weekly full backup created and restored
  into an isolated disposable DB — 66 tables, 2 users, 181 file records / 184 physical files.
- `scripts/phase0-verify.sh` (new, reproducible) → **PASS**:
  - Fresh **encrypted** DB-only backup (`backups/daily/db-*.dump.enc`) and full DB+files backup
    (`backups/weekly/full-*.tar.gz.enc`), both `chmod 600`, AES-256-CBC + PBKDF2 (200k iters).
  - **SHA-256 checksums** computed for both archives.
  - Restore of the full backup into a **disposable** DB (`madrasa_phase0_verify_*`) + temp
    storage, then a **domain-by-domain equality check**: source counts == restored counts for
    public tables (66), migrations (8), users (2), import_batches (77), programs (58), people
    (80), documents (56), floors (5), rooms (17), assets (3), inspections (11), audit_log
    (1214), stored_files (181), plus **184** physical files restored to disk.
  - Disposable DB **dropped** after verification (trap on exit); real `madrasa` untouched (dump-only).
  - **Combined recovery manifest** written to `storage/private/recovery/recovery-manifest-*.json`
    (git-ignored): app commit, PG version, source DB, both backup paths + sha256, migration
    id/hash list, verified counts, restore result. `chmod 600`.

Encryption keys are **not** stored in Git or inside the archives (`BACKUP_PASSPHRASE` lives in
git-ignored `.env` / `storage/private`).

**Gate 0 verdict: PASS.** Backup and restore rehearsal both succeed; safe to proceed.

### Investigation leads carried into later phases

- **PWA / service worker (Phase 1 suspect).** `public/sw.js` uses a constant cache name
  (`madrasa-offline-v1`), so its `activate` handler never purges caches when the app content
  changes across deploys, and it serves `/_next/static/` **cache-first**. It registers with the
  default scope `/` from a single visit to `/building/offline`, after which it controls every
  route. For immutable hashed chunks cache-first is tolerable, but this design is fragile after
  redeploys and offers no controlled update/refresh path — to be reworked with versioned caches,
  network-first for authenticated navigations, an Arabic update notice, and chunk-error recovery.
- **Production-build verification required.** The principal runs a built/deployed app, not `npm
  run dev`. The button audit (Phase 1) must exercise a real `next build` + `next start`, because
  hydration/chunk failures typically only reproduce against the production bundle.

### Artifacts added in Phase 0

- `scripts/phase0-verify.sh` — reproducible baseline backup + checksum + disposable-restore
  verification + manifest generator.
- `storage/private/recovery/recovery-manifest-*.json` — recovery manifest (git-ignored).
- This document.

---

## PHASE 1 — System-wide button failure investigation  (fixes landed; Gate 1 partial)

### Method

Investigated against a real **production build** (`next build` + `next start` on port 3082),
on the isolated `madrasa_test` DB (never the real data). A headless Chromium logged in as
principal and swept all 37 authenticated routes capturing status, page/console errors, failed
requests, an interactive-element census, and a click-blocking-overlay detector. Full inventory
and per-route evidence: **`docs/UI_ACTION_AUDIT.md`**.

### Root-cause finding

The report "all buttons don't work" is **not** a universal per-button code defect. Every route
renders **200 with functioning interactive elements**, the shared `SubmitButton` is correct
(pending state, double-click-safe, Arabic confirm), and no click-blocking overlay exists. The
real-world failure is consistent with **stale PWA/browser cache after a redeploy** (dead JS
chunks → no interactivity), aggravated by a hydration break on one page. Four concrete causes
were found and fixed:

1. **Hydration mismatch — `/building/offline` (React #418).** `useState` lazy initializer read
   `navigator.onLine` during hydration. **Fixed** (deterministic initial value + `useEffect`).
   Confirmed gone in the post-fix production sweep.
2. **Unsafe service worker.** Constant cache name (never purged across deploys), registered at
   scope `/` from a single offline-page visit. **Rewrote `public/sw.js`:** navigations / RSC /
   server actions are **network-first, never cached**; cache-first only for immutable hashed
   `/_next/static/` + the offline page; versioned cache (`madrasa-v2`) purged on activate.
3. **No update path / no chunk recovery.** New global **`PwaManager`** (mounted in
   `(app)/layout.tsx`): app-wide SW registration, Arabic update notice «يتوفر تحديث جديد
   للمنصة» + «تحديث الآن», reload on `controllerchange`, and a **guarded one-time**
   `ChunkLoadError` recovery (clear caches + unregister SW + reload; `sessionStorage` guard
   against loops). New root **`global-error.tsx`** Arabic recovery screen for chunk/layout errors.
4. **Malformed `[id]` → server error.** `/building/rooms/x` threw a Postgres uuid-cast error
   before the `notFound()` guard. New `isUuid` guard (`src/lib/validation.ts`) → clean 404
   (verified authenticated: no console/server error, not-found page shown). Same sweep to be
   applied to other `[id]` routes in Phase 9.

### Verification

- Post-fix production sweep: all 37 routes 200, **no page errors, no blocking overlays**; the
  only prior console error (`/building/rooms/x`) resolved. `_rsc … ERR_ABORTED` entries are
  benign Next.js prefetch cancellations, not user-facing failures.
- `npm test` → **171/171 vitest pass** (no regression).
- `npm run typecheck` clean; `npm run lint` 0 errors; `npm run build` clean.
- e2e `https-pwa` (SW served, PWA manifest RTL, Secure cookie) + `arabic-and-auth` → pass
  against the production server (C5 physical-HTTPS test remains the single deferred skip).

### Gate 1 status

- Automated production-build render + interactive census + error/overlay capture (principal,
  valid session) — **PASS**.
- **Deferred to Phase 9:** scripted per-action click matrix across desktop / tablet / 390×844,
  principal + administrator roles, and valid / expired-session / validation-failure /
  server-failure / repeated-click states, extending the existing 48 Playwright action tests.

### Artifacts added / changed in Phase 1

- `public/sw.js` (rewritten), `src/components/pwa-manager.tsx` (new),
  `src/app/global-error.tsx` (new), `src/lib/validation.ts` (new),
  `src/app/(app)/building/offline/offline-ui.tsx` (hydration fix),
  `src/app/(app)/building/rooms/[id]/page.tsx` (uuid guard),
  `src/app/(app)/layout.tsx` (mount PwaManager), `tests/e2e/https-pwa.spec.ts` (assertion for
  the redesigned SW), `docs/UI_ACTION_AUDIT.md` (new).

---

## PHASE 2 — Safe asset lifecycle  ✅ (archive/restore + guarded permanent delete)

### Design

Additive **migration 0008** adds `archived_at` / `archived_reason` / `archived_by` to `assets`
(no data touched; `active=false` + `archived_at` set = archived). New permission **`assets.delete`**
(seeded to principal + sysadmin via `permissionsSeed`; idempotent retrofit
`seedAssetLifecycleRbac` for already-seeded DBs). Lifecycle logic isolated in
`src/lib/building/asset-lifecycle.ts` (server-only, testable); shared confirm phrase in
`src/lib/building/asset-constants.ts` (importable by client + server).

- **«أرشفة الأصل»** (default, non-destructive): requires an Arabic reason, sets `active=false`
  + archive metadata, writes an `أرشفة` event to `asset_history`, audits with before/after
  (`asset.archived`). Hides the asset from active operational lists via the existing
  `active=true` filter — **preserves** inspections, maintenance, room history, QR identity
  (code unchanged), and audit history. Reversible via **«استعادة الأصل»** (`asset.restored`).
- **«حذف نهائي»** (guarded): requires `assets.delete`, an explicit **«أُنشئ بالخطأ»** affirmation,
  and the typed confirmation phrase **«حذف الأصل نهائياً»**. Server re-checks dependencies via
  `getAssetDependencies` (maintenance issues, evidence/attachments, issued documents) and
  **blocks server-side** with the Arabic dependency types + counts when any exist. Only the
  asset row + its own `asset_history` are removed, in one transaction — **never cascades**
  inspections/maintenance/evidence/documents; the school-wide `audit_log` entry is retained.
- UI (`assets/page.tsx` + `assets-ui.tsx`): active/archived filter, **«مؤرشف» badge**, archive
  reason column, per-asset **history** (`<details>`), and the lifecycle controls. When
  dependencies exist the delete control shows «الحذف النهائي غير متاح — …» instead of a button.

### Verification

- **Integration** `tests/integration/asset-lifecycle.test.ts` (3 tests, exercise the real
  server actions): archive is non-destructive + reason-required + reversible; permanent delete
  blocked by a maintenance dependency (asset + issue both survive, Arabic dependency shown);
  delete requires the mistake affirmation + exact phrase, then removes a dependency-free asset.
- **Real UI** (production build on `madrasa_test`, principal): active→archive (reason) →
  archived view shows badge + reason → removed from active → restore → back in active;
  guarded permanent delete of a dependency-free archived asset removes it. **390×844 zero
  horizontal overflow, no page errors.**
- `npm test` **174/174** (171 + 3), typecheck / lint (0 errors) / build clean.

### Artifacts

- `drizzle/0008_careless_payback.sql`, `src/db/schema/building.ts` (+3 cols),
  `src/db/seed-data/permissions.ts` (`assets.delete`),
  `src/lib/building/asset-lifecycle.ts` + `asset-constants.ts` (new),
  `src/app/(app)/building/actions.ts` (archive/restore/delete actions),
  `src/app/(app)/building/assets/{page,assets-ui}.tsx`,
  `tests/integration/asset-lifecycle.test.ts` (new).

---

## PHASE 3 — Editable inspection templates  ✅ (CRUD + versioning + historical snapshot)

### Design

Additive **migration 0009** extends `inspection_templates` (code, root_id, version, purpose,
instructions, sections jsonb, assignment jsonb, is_system) and `inspections`
(template_snapshot jsonb, template_version). A template is a **family of versions** keyed by a
stable `code` + `root_id` with an ascending `version`. Status values: مسودة | معتمد (=مُفعّل,
kept for back-compat with the offline/run/readiness readers) | معطّل. `sections` is the rich
edit/preview/snapshot source; `items` is a derived flat list for those legacy readers.

Pure defs (types, response-type labels, severities, `flattenItems`, `validateSections`,
`systemTemplates`) live in `inspection-template-defs.ts` (no `server-only`, importable by
client + server + seed); `nextTemplateCode` (db) stays in the `server-only`
`inspection-templates.ts` which re-exports the defs.

- **Routes** (`/building/inspections/templates`): list (grouped by family, versions + status +
  usage), `new` (create), `[id]` (preview + versions + usage history + activate/deactivate/
  duplicate/delete/new-version), `[id]/edit` (editor).
- **Editor** (`template-editor.tsx`): add/edit/remove/**reorder** sections and items; each item
  carries label, instructions, required, **response type** (yes/no, compliant, numeric, rating,
  text, date, photo, attachment), **severity on fail**, and **corrective-action required**.
  Serializes sections to a hidden JSON field; server `validateSections` re-checks.
- **Actions** (`template-actions.ts`): create (draft v1, family), update (in place if an unused
  draft; **otherwise creates a new draft version** — historical integrity), activate (sets
  مُفعّل, deactivates sibling active versions), deactivate, duplicate (new family), delete
  (draft + unused only — **used versions cannot be hard-deleted**).
- **Historical integrity**: `submitInspectionAction` freezes `template_snapshot` +
  `template_version` on the inspection row, so later template edits never alter past inspections.
- **System defaults**: 10 Arabic reference templates (general readiness, safety, cleanliness,
  electrical, lab, computer lab, fire equipment, elevator, toilets, outdoor) seeded as `is_system`
  + active with rich sections — clearly **system reference templates, not fake inspection
  results** — and are editable/duplicable/activatable/deactivatable by the principal.

### Verification

- **Integration** `tests/integration/inspection-templates.test.ts` (5 tests): create→draft v1
  (code/root/derived items); edit-in-place vs new-version-when-active; activate deactivates
  siblings; used template can't be deleted **and** the inspection froze snapshot+version;
  draft-unused delete works.
- **Real UI** (production build on `madrasa_test`, principal): 10 system templates listed;
  create→redirect to detail + preview; activate→«مُفعّل»; new-version edit→v2; duplicate→«(نسخة)».
  **No page errors; 390×844 zero horizontal overflow.**
- `npm test` **179/179** (174 + 5), typecheck / lint (0 errors) / build clean.

### Artifacts

- `drizzle/0009_orange_krista_starr.sql`, `src/db/schema/building.ts`,
  `src/lib/building/inspection-template-defs.ts` + `inspection-templates.ts`,
  `src/app/(app)/building/template-actions.ts`,
  `src/app/(app)/building/inspections/templates/**` (list/new/[id]/[id]/edit + editor/preview/controls),
  `src/app/(app)/building/actions.ts` (snapshot freeze), `src/db/seed.ts` (system templates),
  `src/app/api/sync/offline-data/route.ts`, `tests/integration/inspection-templates.test.ts`.

---

## PHASE 4 — Phone document scanning → PDF  ✅ (with upload fallback)

### Design

New building-module hub `/building/documents`. All processing is **local** (no external AI/cloud).

- **Scanner** (`document-scanner.tsx`, client): «مسح مستند» opens the rear camera via
  `getUserMedia({facingMode:'environment'})`; «التقاط صفحة» captures frames to canvas with an
  optional **تحسين الوضوح** (grayscale + contrast) pass; captured pages support **إعادة الالتقاط**
  (remove), reorder, and **تدوير** (rotate 90°). «إنشاء ملف PDF وحفظ وإرفاق» renders rotations,
  posts ordered JPEG pages as JSON with the CSRF token.
- **Camera denial / unavailable** is handled gracefully with an Arabic notice explaining the
  secure-context (HTTPS/Tailscale) requirement, and a **«رفع ملف بدلاً من استخدام الكاميرا»**
  fallback (image → PDF, or a ready PDF used as-is) is **always** present.
- **API** `POST /api/building/scan` (`route.ts`): login + a building-module write permission +
  CSRF + rate limit; accepts JSON pages (camera) or multipart (upload); builds one A4 PDF per
  page via the existing local Playwright renderer (`buildScanPdf`); saves it as a **sensitive**
  private stored file; creates an evidence item (kind=file, source «مسح مستند») linked to the
  target and **audits** (`document.scanned`). Max 30 pages.
- **Attach targets**: building (resolved to the school record's id — `evidence_links.entity_id`
  is a uuid), floor, room, asset (route also supports inspection/maintenance). Title + category
  + sensitive flag. Downloads go through the existing authenticated, audited `/api/files/[id]`
  (sensitive → authorized-only).

Not implemented (within the brief's "if technically reliable" allowance): freehand crop —
documented limitation; rotate + grayscale/contrast enhance are provided.

### Verification

- **Integration** `tests/integration/document-scan.test.ts` (2 tests): `validateTarget`
  accepts existing entities + building-without-id and rejects a missing uuid;
  `attachScannedDocument` saves a sensitive PDF, creates the «مسح مستند» evidence + link, audits,
  and `listScannedDocuments` returns it.
- **Real UI** (production build, fake camera stream, principal): camera capture (2 pages +
  rotate) → PDF built server-side → attached → listed → **download returns a valid `%PDF-`**;
  image **upload fallback** → PDF attached; **fallback always present** without camera; no page errors.
- `npm test` **181/181** (179 + 2), typecheck / lint (0 errors) / build clean.

### Artifacts

- `src/lib/building/document-scan.ts`, `src/app/api/building/scan/route.ts`,
  `src/app/(app)/building/documents/{page,document-scanner}.tsx`,
  `src/app/(app)/building/page.tsx` (links), `tests/integration/document-scan.test.ts`.

---

## PHASE 5 — QR scanning (room / asset) with manual fallback  ✅

### Design

New `/building/scan` page. Room/asset QR identity is **stable**: room QR encodes a URL with the
room's uuid; asset QR encodes a URL with the asset's stable `code` — neither changes when the
item is moved on the sketch (they are not geometry-derived).

- **Pure parser** `src/lib/building/qr-parse.ts` (client + server safe, tested): recognizes room
  URLs (`/building/rooms/<uuid>`), asset URLs (`?رمز=<code>`, incl. percent-encoded), and raw
  codes (`KHS-RM-…`, `KHS-AST-…`).
- **Scanner** (`qr-scanner.tsx`, client): «مسح رمز غرفة» / «مسح رمز أصل» start the camera and use
  the native **`BarcodeDetector`** (secure-context) to read QR frames; where unsupported it shows
  an Arabic notice and relies on **«إدخال الرمز يدوياً»** (always available). **No write happens
  from scanning** — results render as navigation links only.
- **Resolver** (`scan-actions.ts`, `resolveScanAction`, read-only): requires `building.read`,
  resolves to a typed room/asset result, and returns Arabic errors for **invalid/unknown**
  codes, **archived** rooms (blocked) / assets (flagged), and surfaces permission-gated actions.
- **Result actions**: room → «فتح الغرفة», «بدء فحص» (→ room `#inspection`), «إنشاء بلاغ صيانة»
  (→ room `#صيانة`); asset → «فتح الأصل» (archived opens the archived view), «إنشاء بلاغ صيانة»
  (its room) when active. Deep-link anchors added to the room page.

### Verification

- **Unit** `tests/unit/qr-parse.test.ts` (5) + **integration** `tests/integration/qr-scan.test.ts`
  (5): URL/raw parsing; resolve room-by-uuid/raw-code with permissions; asset resolve + archived
  flag; archived room blocked with Arabic message; unknown code error.
- **Real UI** (production build, principal): both scan buttons present; manual room + asset codes
  resolve and render the correct action links; «فتح الغرفة» targets the room; unknown code shows
  an Arabic alert; camera-unsupported (headless) degrades to the Arabic manual-entry notice; 390×844
  zero overflow, no page errors.
- `npm test` **191/191** (181 + 10), typecheck / lint (0 errors) / build clean.

### Artifacts

- `src/lib/building/qr-parse.ts`, `src/app/(app)/building/scan-actions.ts`,
  `src/app/(app)/building/scan/{page,qr-scanner}.tsx`,
  `src/app/(app)/building/rooms/[id]/page.tsx` (anchor), `src/app/(app)/building/page.tsx` (link),
  `tests/unit/qr-parse.test.ts`, `tests/integration/qr-scan.test.ts`.
