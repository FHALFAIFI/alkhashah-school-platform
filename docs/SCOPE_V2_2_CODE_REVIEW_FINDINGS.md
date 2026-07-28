# Scope v2.2 — §11.1 Repository Review Findings

**Scope of review:** the entire application, not only v2.2 code.
**Branch:** `scope-v2.1-corrections` · **Date:** 2026-07-29
**Reviewed surface:** 65 pages · 21 API route handlers · 158 server actions · 88 lib modules ·
17 shared components · 14 scripts · 2 Dockerfiles · 2 Compose files · 21 migrations · ~41,000 LOC.

**Production untouched throughout.** All rehearsals ran on clones or isolated stacks.

---

## Classification summary

| Severity | Count | Fixed | Accepted / Deferred |
|---|---|---|---|
| Blocker | 0 | — | — |
| High | 6 | 6 | 0 |
| Medium | 6 | 5 | 1 |
| Low | 5 | 5 | 0 |
| Accepted technical debt | 4 | — | 4 |
| False positive / not applicable | 3 | — | — |

---

## HIGH

### H1 — Production compose ran `seed.ts` on every `compose up`
**Module:** `compose.production.yml` (init service) · also legacy `Dockerfile` CMD
**Issue:** `init` was `migrate.ts && seed.ts`, and `app` declares
`depends_on: init: service_completed_successfully`. Every start of the production stack executed
the seed.
**Impact:** The standing instruction is that `seed.ts` must never run in production. `seed.ts` is
genuinely idempotent (`onConflictDoNothing`, skips existing users) and truncates nothing, so **no
data was ever lost** — production surviving many deploy cycles is empirical proof. The real risk is
forward-looking: any reference row added to seed data in a later version would have been inserted
into production silently, which §B2 forbids ("do not silently create production records through
seed logic").
**Fix:** `init` is now migrate-only. Seeding moved to a `seed` service behind an explicit
`bootstrap` profile, so a fresh install still works but nothing seeds automatically.
**Evidence:** `docker compose config` shows no `seed.ts` in the default service set; it appears
only with `--profile bootstrap`.
**Residual risk:** none. Note `Dockerfile.production` (what production actually builds from) was
already clean — the exposure was the compose init service.

### H2 — Unescaped interpolation into official documents
**Module:** `src/lib/pdf.ts` (`officialPageHtml`)
**Issue:** `title`, org lines, header/footer notes, principal name, document number, verification
code and image data URIs were interpolated into HTML with no escaping. Titles are built from
user-entered names (`تقرير برنامج: ${program.name}`).
**Impact:** A program named `<img src=x onerror=…>` became live markup inside the document's
**frozen snapshot** and executed in server-side Chromium during PDF generation. Free-text program
creation (M1) made it trivially reachable.
**Fix:** every interpolation escaped; one shared `src/lib/html-escape.ts` replaced eight duplicated
local helpers that escaped only `& < >` and left attribute-context escapes incomplete.
**Evidence:** `tests/unit/template-security.test.ts` (XSS payload matrix),
`tests/integration/security-existing-surfaces.test.ts` (document escaping).
**Residual risk:** none known.

### H3 — Next.js carried 9 reachable high advisories
**Module:** `package.json` (next 16.2.10)
**Issue:** SSRF in Server Actions, DoS in Server Actions, unauthenticated disclosure of internal
Server Function endpoints, middleware/proxy bypass, two cache-confusion issues, unbounded Edge
Server Action payload, SSRF via rewrites, image-optimisation DoS.
**Impact:** This application is built on Server Actions, so several were directly reachable.
**Fix:** upgraded to 16.2.12 (patch-level, not semver-major); transitively cleared postcss and sharp.
**Evidence:** `npm audit` shows no direct Next.js advisories; full suite green after upgrade.

### H4 — `adm-zip` crafted-ZIP memory exhaustion
**Module:** `package.json` · used by `src/lib/imports/xlsx.ts`, `src/lib/evidence-render.ts`
**Issue:** adm-zip < 0.6.0 allocates up to 4 GB on a crafted ZIP (xlsx is a ZIP container).
**Impact:** An authenticated user with `imports.read` uploading a malicious workbook could exhaust
server memory. Reachable, though it requires an authenticated administrative account.
**Fix:** upgraded to 0.6.0 (semver-major, done deliberately and verified).
**Evidence:** all 31 import/xlsx integration tests pass on 0.6.0; `npm audit` now reports **no
direct dependency with its own advisory**.

### H5 — Receipt attachment to an existing finance record was lost (regression I introduced)
**Module:** `src/app/(app)/budget/page.tsx` (M2 rewrite)
**Issue:** The rewrite dropped the per-row «الإيصال»/«الفاتورة» link that opened the evidence panel
for an **already-saved** income or expense. I added upload-at-creation and treated it as equivalent.
**Impact:** Real loss of delivered v2.1 capability (D-026). Invoices commonly arrive after the
operation is recorded; without the link the principal could not attach one at all afterwards.
**Fix:** restored the receipt panel and both per-row cells (status badge + link) on the new page.
**Evidence:** Playwright `workflows.spec.ts` س2ب — the test that caught it now passes.
**Residual risk:** none. Recorded prominently because it was self-inflicted and only the operational
gate caught it — the unit and integration suites did not.

### H6 — `"use server"` file exported a non-async constant (regression I introduced)
**Module:** `src/app/(app)/budget/finance-actions.ts` (M2)
**Issue:** The file exported `ITEM_COLORS`. Next.js permits only async function exports from a
`"use server"` module.
**Impact:** **The entire budget page's client components failed to load** — add income, add expense
and the financial-item forms were all unusable in a browser. Severity is High because the feature
was completely broken in the product while appearing healthy in CI.
**Why the test suite missed it:** unit and integration tests import the action module directly in
Node, where Next's module constraints do not apply. All 527 passed against a broken page. Only the
browser gate could catch this.
**Fix:** constant moved to `src/lib/finance/colors.ts` (a plain module), imported by both the action
file and the UI.
**Evidence:** Playwright now green (60 passed / 1 skipped / 0 failed); added a permanent guard test
asserting no `"use server"` file exports a non-async value. The guard initially produced false
positives on files that merely *mention* `"use server"` in a comment, so its detection was tightened
to require the directive to be the file's first real statement.
**Residual risk:** none — the class of bug is now covered by a standing test.

---

## MEDIUM

### M1 — No HTTP security headers anywhere
**Module:** `next.config.ts` (no `headers()`, no middleware)
**Issue:** No CSP, no frame protection, no referrer policy, no permissions policy. `nosniff` existed
only on the file-download route.
**Impact:** Clickjacking/UI-redress against an authenticated session; no defence-in-depth against
content-type confusion or referrer leakage.
**Fix:** added `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin`, `Permissions-Policy` (camera/mic/geo/payment/usb off), and a CSP
restricting `frame-ancestors`, `object-src`, `base-uri`, `form-action`, `img-src`, `font-src`,
`connect-src`.
**Evidence:** headers present on responses; full Playwright suite green with them enabled.
**Residual risk:** `script-src`/`style-src` still permit inline. See D2 below — this is deliberate
and recorded, not overlooked.

### M2 — Uploads trusted browser-supplied MIME with no signature check
**Module:** `src/lib/storage.ts`
**Issue:** `validateUpload` cross-checked extension against MIME, but MIME is attacker-controlled
and no file signature was verified. §11.5.F requires that images and PDFs not be trusted on browser
MIME alone.
**Impact:** Arbitrary content could be stored under a trusted type. Downloads are served
`Content-Disposition: attachment` with `nosniff`, so browser rendering was not the exposure; the
concern is content reaching PDF/xlsx parsers (see H4).
**Fix:** added magic-byte validation for every supported type (JPEG/PNG/WEBP/PDF/OOXML/OLE2);
`text/plain` has no fixed signature and is documented as unvalidated-by-design.
**Evidence:** security suite rejects HTML disguised as `.pdf`/`.png`, plus empty and truncated files.

### M3 — Raw error messages reached the UI
**Module:** 9 action/route files
**Issue:** `error: e instanceof Error ? e.message` returned library/filesystem/database text straight
to the user on unexpected failures.
**Impact:** Potential disclosure of filesystem paths, table names, or raw English text in an Arabic
UI. §11.5 prohibits exposing implementation details.
**Fix:** typed `UploadValidationError` + `userFacingError()` — our own Arabic validation messages
surface; anything else becomes a generic Arabic message.
**Notable sub-case:** the import-commit path's comment claimed the message was sanitised while it
returned the raw one. It now returns a generic message plus the existing correlation reference, with
full technical detail retained in the audit row. The AI chat stream did the same and now logs
server-side.

### M4 — Backup scripts could silently back up the DEV database
**Module:** `scripts/backup-lib.sh`
**Issue:** Production's DB is unpublished, and `.env` sets `DATABASE_URL` to the dev DSN
(`localhost:5544`). Running `npm run backup:daily` from a terminal produced a **successful-looking
encrypted backup containing no school data**.
**Impact:** False confidence in backups — worse than an outright failure, because nothing signals
the problem until a restore is attempted.
**Fix:** scripts now print the resolved target database and refuse port 5544 unless
`ALLOW_DEV_BACKUP=1`.
**Evidence:** verified refusal without the flag and warned-but-proceeding with it. The existing
2026-07-27 predeploy backup was independently confirmed to contain genuine production data.

### M5 — Flat file-download authorization (no per-entity scoping)
**Module:** `src/app/api/files/[id]/route.ts`
**Issue:** Any principal with `files.download` can fetch any file by UUID. There is no entity-scope
check tying a file to a record the caller may see.
**Impact:** None in practice today: the role model has exactly two administrative roles (principal,
sysadmin) and both are trusted with all school data. Sensitive files (signature/stamp) already carry
an extra permission gate plus audit.
**Status:** **ACCEPTED for the current role model, documented.** If per-teacher accounts are ever
introduced, this becomes a real horizontal-privilege issue and must gain entity-scoped checks.

### M6 — Unguarded static-data server action
**Module:** `src/app/(app)/admin/templates/actions.ts` (`templateDocTypeOptions`) — introduced in M4
**Issue:** A `"use server"` export with no authorization check, returning static document-type labels.
**Impact:** Minimal (no secrets), but an unnecessary exposed endpoint.
**Fix:** removed; the page builds the list locally from the shared constant.

---

## LOW

| # | Module | Issue | Status |
|---|---|---|---|
| L1 | `src/app/(app)/budget/actions.ts` | Raw English `"Invalid UUID"` from Zod reached the Arabic UI | **Fixed** — Arabic message + test asserting no Latin text escapes |
| L2 | `src/lib/reports/loaders.ts` | `max(created_at)` returns a string from Postgres, not `Date`; two reports crashed with real data (invisible on an empty DB) | **Fixed** — found by the production-clone pass, regression test added |
| L3 | `src/lib/templates/placeholders.ts` | `{{__proto__}}` resolved to `Object.prototype` and rendered `[object Object]` | **Fixed** — substitution restricted to the closed registry + own-property check |
| L4 | `src/app/(app)/admin/templates/actions.ts` | Deleting a draft version freed its number for reuse, producing two different "version 2" audit entries | **Fixed** — drafts archived, not deleted |
| L5 | `package.json` | `konva` and `react-konva` are direct dependencies with zero references (floor editor renders plain SVG) | **Fixed** — removed after verifying no dynamic import, no string reference, no config use |

---

## Accepted technical debt

| # | Item | Rationale | Remediation plan |
|---|---|---|---|
| D1 | Session lifetime is absolute-only — no idle timeout and no rotation on privilege change | Single-principal school app on a trusted LAN; tokens are hashed at rest, `httpOnly`, `SameSite=lax`, expiry enforced on every read | Add idle timeout if multi-user accounts are introduced |
| D2 | CSP still allows inline `script-src`/`style-src` | Next.js App Router injects inline bootstrap/hydration scripts; a strict policy needs per-request nonces via middleware. The first attempt at a strict policy broke every page and was caught by the Playwright gate | Introduce a nonce-generating middleware, then tighten `script-src` |
| D3 | Plain-HTTP LAN access (`ALLOW_INSECURE_LAN_HTTP=true`) | Explicit prior decision for the principal's LAN retest; Tailscale Serve is the real posture. HTTP provides no transport confidentiality and session cookies travel unencrypted on the LAN — stated plainly, not re-characterised as safe | Remove the flag once Tailscale is the only access path |
| D4 | Remaining `npm audit` entries (24) | All transitive or development-only: eslint chain, drizzle-kit/esbuild (dev server only, absent from the production image), postcss/sharp reachable only via Next which npm cannot "fix" without a downgrade | Re-audit each dependency batch; no reachable runtime advisory remains |

---

## False positives / not applicable

| # | Suspected | Verdict |
|---|---|---|
| F1 | `src/lib/plan/baseline-verify.ts` appeared to be an orphan module | **False positive** — used by `scripts/verify-milestone-baseline.ts` and `scripts/run-milestone-backfill.ts`, and explicitly protected under D-022. Retained. My initial scan omitted `scripts/`; verified before touching anything |
| F2 | `console.log` statements left in source | **Not applicable** — all occurrences are in `src/db/*` CLI seed/migrate scripts where console output is the intended interface |
| F3 | `await` inside `for` loops suggesting N+1 | **Not applicable** — the three occurrences are bounded row-by-row import processing, one-time permission seeding, and indicator-snapshot iteration. Report loaders use grouped count queries, not per-row lookups |

---

## Authorization matrix (verified by automated sweep, not by inspection alone)

| Boundary | Total | Enforced | Exceptions |
|---|---|---|---|
| Server actions | 158 | **158** | `loginAction` / `logoutAction` — unauthenticated by nature |
| API route handlers | 21 | **21** | `/api/health` — container healthcheck, no secrets, returns status/db/version/time only |

Three actions (`commitBatchAction`, `submitFeedbackAction`, and feedback submission) use
`getCurrentUser()` plus an explicit permission check rather than `requirePermission()`. This is
deliberate and documented in the code: they are invoked inside `startTransition`, where a thrown
`NEXT_REDIRECT` would be swallowed silently and leave the UI spinning. They return typed rejection
results instead. `commitBatchAction` returning `PERMISSION_DENIED` without permission is covered by
test.

Two repository-wide sweeps in `tests/integration/security-existing-surfaces.test.ts` assert these
invariants continuously, so a future unguarded action or route fails CI rather than shipping.

---

## Module-by-module notes

| Module | Findings | Notes |
|---|---|---|
| Authentication (`src/lib/auth/*`) | D1 | argon2 with salting, IP rate limit, escalating lockout after 5 failures, generic errors (no account enumeration), sha256-hashed session tokens, per-session CSRF token, TOTP + recovery codes, audit on failure |
| Authorization | — | Verified exhaustively; see matrix above |
| Uploads / storage | M2 | Server-generated UUID paths (filename never influences path), `safeResolve` traversal guard, 0600 file mode, sha256, 20 MB cap, MIME↔extension allowlist, now signature validation |
| Reports / exports | — | Column allowlist from the registry, sort whitelist, clamped pagination, bounded exports, formula-injection neutralisation, export audit rows |
| Documents | H2 | Frozen `html_snapshot` at issue time; verified unchanged across template edits and across migration 0020 |
| Finance | — | Single calculation service; null≠zero; archived excluded; no double counting (legacy text column deliberately excluded from the new calculation) |
| Committees / performance | — | Write actions permission-gated; individual performance correctly requires both `reports.generate` and `performance.individual.read` (D-013) |
| Imports | H1, M3 | Correlation-id audit trail on start/success/failure; idempotent commit with race handling |
| Templates | M6, L3, L4 | Allowlisted configuration model — not a template language |
| Migrations | — | 0018–0020 additive only; no old migration edited; rehearsed twice on production clones |
| Docker / Compose | H1 | Non-root `uid=1001`, healthchecks, `unless-stopped`, named volumes, Postgres unpublished, `.dockerignore` excludes `.env*`, `storage/`, `backups/` |
| Secrets | — | Clean scan: no hardcoded passwords/tokens/keys; only `.env*.example` tracked; `.gitignore` covers `.env*`, `reference_files/`, `storage/private/` |
