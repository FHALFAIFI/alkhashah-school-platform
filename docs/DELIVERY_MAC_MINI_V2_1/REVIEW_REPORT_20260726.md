# Final Demo Release-Readiness Review — Mac mini (Scope v2.1)

**Date:** 2026-07-26 · **Compose project:** `madrasa-prod` · **Production URL:** `http://192.168.0.48:3080`
**Verdict:** ✅ **CONDITIONAL GO — SAFE FOR PRINCIPAL DEMO WITH LISTED NON-BLOCKING LIMITATIONS**

This was a verification-only review. No production data was changed, no migration/seed ran, no code was
changed or deployed, no network exposure changed, no release tag was created, no host-PC migration began.
All mutating tests ran in an isolated clone.

---

## 1. Reviewed artifact & production integrity

| Item | Value |
|---|---|
| Repo HEAD | `2b94783` = approved app commit **`8fb59c1`** + delivery-docs only (0 source changes) |
| Running image | `madrasa-app:0.1.0` · `sha256:a492d908bcfb8e97d578eea5b71f186e42e09b14c85f0fa2cb194d1b9a5e529a` (built from `8fb59c1`) |
| Migration level | **0016** (`83a4babb…`), 17 journal rows, none pending, seed did not run |
| Counts | users 2 · people 54 · programs 26 · milestones 129 · activities 129 (129 distinct links, **0 orphans**, 1:1) · feedback 1 · stored_files 18 · documents 10 · evidence 3 · audit_log 146 |
| D-022 fingerprint | `8d5375e0f610ee06cd80702b4f1427a3967cbf19884ef091820d2f5a77a382cf` (unchanged across preflight, deploy, restore, restart) |
| Retained activities | inert — 0 runtime imports of `activity-progress`/`milestone-backfill`/`@/lib/plan/readiness` |
| Uploaded files | 19 physical (≥ 18 rows), readable |
| Exposure | app `192.168.0.48:3080` (approved LAN); PostgreSQL `5432/tcp` internal (**not** host-published); Ollama `127.0.0.1:11434` loopback — **before == after** |
| Compose LAN diff | only the two known lines (`ALLOW_INSECURE_LAN_HTTP`, `APP_BIND`) + comments — no unrelated change |

## 2. Engineering gates (exact commit `8fb59c1`, isolated env)

| Gate | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | ✅ clean |
| Lint (`eslint .`) | ✅ 0 / 0 |
| Unit + integration + authorization (`vitest`) | ✅ **280 passed / 53 files** |
| Full Playwright (real browser) | ✅ **60 passed / 1 skipped** (skip = C5/D-018 HTTPS-camera environmental — not a weakening; does not affect the demo) |
| Production build (`next build` in Docker) | ✅ |

Test isolation is fail-closed (`assertTestDatabase` + `assert-non-production`) — suites refuse production targets. No suite ran against production.

## 3. Isolated clone (for all mutating/active tests)

Project `madrasa-review` · DB `madrasa_review` · loopback `127.0.0.1:3090` · own volumes — restored from the
verified encrypted backup, then migration 0016 applied. Clone fingerprint == F0, counts identical, 0 orphans.
Fail-closed against production identifiers. Torn down after the review.

## 4. Real-browser smoke (authenticated, against the byte-identical clone with real data)

- Logged-out `/dashboard` → redirects to `/login`; logged-out `/api/files/<uuid>` → **401**.
- Login form **rejects a wrong password** with a generic Arabic error and **no username enumeration**.
- All 10 key routes load with real Arabic titles (dashboard, plan, committees, budget, performance,
  evidence, reports, documents, people, pilot) — **0 raw errors, 0 client-secret leaks, 0 console errors**.
- Program detail loads (no activity weights, no closure-readiness).
- **Logout invalidates the session** (subsequent `/dashboard` → `/login`).
- Mobile RTL 390×844: no horizontal overflow (dashboard/plan/budget).

> Note on the authenticated session: the clone login with the documented `initial-credentials.txt` temp
> password did not authenticate (the clone shares production's password hashes; the temp password no longer
> matches — see the credential check below), so the authenticated navigation above was driven by a session
> minted directly in the isolated clone DB. Successful-login-flow evidence comes from the green Playwright
> suite (which logs in via the real form with its own seeded admin).
>
> **Credential check (production, authorized auth test, 2026-07-26):** a real-browser login against
> `http://192.168.0.48:3080` with the `initial-credentials.txt` temp passwords **failed for both
> `principal` and `admin`** — the server recorded `login.failed` with a valid actor id (usernames valid →
> **wrong password**), no lockout (failed_logins = 1 each). The initial temp passwords have been **changed**
> and are no longer active — good practice. (Two intermediate notes in this review — first "rotated at
> go-live", then a retraction claiming the initial credentials were "still active" — were both premature;
> this empirically-verified statement supersedes them.) Side effect disclosed: 2 `login.failed` audit rows
> (audit_log 146 → 148); no session created, nothing to clean up.

Production itself was verified read-only (health `db:up`, route gating, SSR shell with `translate="no"` +
`notranslate`, zero raw-error markers). **A real-browser authenticated pass on production with the
principal's own normal browser profile remains a human acceptance step — it was not performed and is not
claimed.**

## 5. Scope v2.1 workflows (Playwright green + clone + deployed-source inspection)

| Area | Result |
|---|---|
| Programs | No activities/milestones/weights/closure-readiness; progress/status direct; retained activities inert |
| Evidence | Informational strings (`لم يتم رفع أي شاهد حتى الآن` / `تم رفع شاهد واحد` / actual count); `evidence-summary.ts` has **no** quota/target/remaining/`جاهزية` wording |
| Budget | Label `البند`; income+expense receipts (optional); link/download |
| Committees | Task templates + distribution table columns (`المهمة`/`العضو المكلف`/`الصفة/الدور`/`توقيع العضو`/`ملاحظات`); `requires_signature` per-type (all existing types `false`) |
| KPI | Real data: 2 planning sessions (`تخطيط`) + 38 ratings; `جلسة التخطيط` visible but excluded; `لم يبدأ التقييم بعد` / `لا يُحتسب` |
| Reports | Corrected data layer; removed modules not imported by runtime |

## 6. Authorization & session (static review + clone)

- **No default/initial credentials active** — seed generates a random per-account password (argon2id), written only to git-ignored `storage/private/initial-credentials.txt` (0600). **Verified 2026-07-26** (authorized production auth test): those initial temp passwords no longer authenticate (`login.failed`, valid usernames → wrong password, for both `principal` and `admin`) — the accounts use **changed** credentials. Recommend enabling MFA (TOTP is implemented) before host-PC/wider exposure, and removing/securing the now-stale plaintext `initial-credentials.txt`.
- argon2id (OWASP params); login rate limit + 5-failure lockout; generic error.
- Session cookies: HttpOnly + SameSite=lax always; Secure under HTTPS/prod (except the documented LAN flag); 30-day absolute + 12-hour idle expiry; **logout fully invalidates** the DB session; change-password kills all sessions.
- Server-side authorization enforced on all mutations (budget/committees incl. task-template/assignment/plan/admin/files/export), independent of UI.
- CSRF: Server-action origin allow-list (`TRUSTED_ORIGINS`) + per-session `x-csrf-token` on every mutating route handler.
- AI-resource reads scoped by ownership; storage path-traversal-safe; file downloads require `files.download`.

## 7. Secrets / logging / dependencies (static review + `npm audit`)

- **Secrets clean:** `.env`/`.env.production` never tracked; `.gitignore` correct; no hardcoded secrets; no client-bundle leakage (no `NEXT_PUBLIC_` secret; server-only modules); `SESSION_SECRET` is dead config (sessions are DB-backed opaque SHA-256 tokens).
- **Logging clean:** D-029 diagnostics log console-only (booleans + pathname + 300-char truncated), no page content/PII; login never logs passwords; `audit()` → DB only, gated by `admin.audit.read`; Arabic-only error boundaries (no stack/SQL/path to users).
- **Dependencies:** lockfile present. `npm audit` 25 (20 high / 5 moderate); `--omit=dev` 14 (13 high / 1 moderate). Chief: Next.js `16.2.10` advisories (a **16.2.12** patch bump clears most), build-time postcss, sharp; `uuid` moderate is unreachable (transitive via exceljs — do not force-downgrade). None reachable-critical on a private single-user LAN.

## 8. Performance (LAN, read-only on prod / clone for load)

| Metric | Target | Measured |
|---|---|---|
| Login page / completion | ~3 s | SSR 11 ms; Playwright login flows sub-second |
| Dashboard | ~3 s | median 22 ms (p95 79 ms) |
| Program list / detail | ~3 s | plan 16 ms / program 12 ms |
| Report page render | ~10 s | 13 ms (p95 23 ms) |
| 5 concurrent sessions (300 reqs) | — | **median 35 ms, p95 75 ms, max 110 ms, 0 errors, 0 5xx** |

Memory stable (223 → 318 → 317 MiB, no leak); DB connections flat at 11 (no exhaustion); CPU peaked ~1 core under 5× load. No repeated 5xx. All within target by a wide margin.

## 9. Restart / persistence / backup

- `Dockerfile.production` CMD = `npm run start` (no migrate/seed on app start; `init` is the only seed path).
- Controlled restart of both prod containers → healed in ~11 s (`restart: unless-stopped`); **no seed ran** (audit_log 146, committee-task tables 0, roles 2 unchanged); migration 17; files 19; login 200; health `db:up`; **D-022 fingerprint unchanged**.
- Verified encrypted backup present + checksummed (`full-20260726-rc-v2_1.tar.gz.enc`, sha256 `11eafe79…8642`); prior restore rehearsal passed. **Gold backup + release tag deliberately not created** (post-acceptance).

## 10. insertBefore (D-029)

**Classification: PROBABLE.** Guard present (`translate="no"` + `notranslate`); form-stability suite 4/4; full
clone smoke had 0 console errors; the diagnostics classifier distinguishes all five causes (translation
`<font>` injection, extension/password-manager injection, dialog/portal lifecycle, hydration mismatch,
duplicate submission), logs console-only, and collects no sensitive data. A **forced** translation-like
DOM-mutation simulation on the clone (text nodes wrapped in `<font>` every 120 ms + `translated-rtl`,
during dialog clicks and navigation) produced **0 uncaught insertBefore, no user-visible raw error, and the
app stayed usable**. Not conclusively reproduced → remains PROBABLE; the principal's real-browser retest is
the final confirmation.

---

## Findings by severity

**BLOCKER:** none. **HIGH (demo-blocking):** none.

**MEDIUM — host-migration hardening (do NOT block the local LAN demo):**
1. Coarse file-download authorization (IDOR-class): `/api/files/[id]` gates on `files.download` without
   per-record/module scoping. **Not exploitable now** — both seeded roles hold the full permission set (no
   under-privileged user). Fix before creating any restricted role.
2. `ALLOW_INSECURE_LAN_HTTP=true` issues a non-Secure session cookie over plain-HTTP LAN — this is exactly
   what enables the HTTP LAN demo; documented + temporary. Revert (`false`, drop `APP_BIND`, trim
   `TRUSTED_ORIGINS`) and use Tailscale HTTPS before any exposure beyond the trusted LAN.
3. No security headers (CSP / X-Frame-Options / HSTS) — add at the Tailscale-Serve/proxy layer or via
   `headers()` before broader exposure. `TRUSTED_ORIGINS` default `*.ts.net` — pin to the host name.
4. Dependency advisories — bump **Next.js → 16.2.12** (and its postcss/sharp tree) before wider exposure.

**LOW:** the now-stale plaintext `storage/private/initial-credentials.txt` should be removed/secured (its
temp passwords are already changed and no longer valid); `الشواهد المطلوبة` on program detail is verbatim
source-plan text (not a quota — optional relabel); login lockout message enables username enumeration; login
rate-limit collapses to one global bucket on direct LAN HTTP (+ lockout DoS); MFA available but not
enforced; server actions surface raw `e.message` (English, not stack/SQL) to authenticated staff on
unexpected errors; `.env` mode 644 on the dev machine.

**BACKLOG:** `uuid` moderate advisory (unreachable); enforce MFA for the principal; structural no-seed
compose service; security headers at the proxy.

## Deferred to host-PC migration
Security headers + dependency bump + always-Secure cookie (drop the LAN flag) + `TRUSTED_ORIGINS` pinning +
file-download scoping (before restricted roles) + TLS everywhere. TLS absence is acceptable **only** while
strictly on the trusted LAN/Tailscale boundary.

## Explicit confirmations
Production data unchanged · no migration/seed ran · no exposure changed · no code change or deployment ·
no release tag created · host-PC migration not started.

---

## Verdict: CONDITIONAL GO — SAFE FOR PRINCIPAL DEMO WITH LISTED NON-BLOCKING LIMITATIONS
Technical demo readiness and principal acceptance are separate gates. Acceptance is still pending.
Non-blocking conditions for the demo: runs over trusted-LAN HTTP with the temporary non-Secure cookie;
the MEDIUM/HIGH items above are host-migration hardening; `insertBefore` stays PROBABLE pending the
principal's real-browser retest.

**Principal test URL:** `http://192.168.0.48:3080/pilot`
