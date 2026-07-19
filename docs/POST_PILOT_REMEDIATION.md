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
