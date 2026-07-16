# الأمن والنسخ الاحتياطي — Security & Backup Design

## Threat model & posture
Single-school internal system, reachable **only** via Tailscale (first release). No public internet exposure; enabling it later requires a separate security review (per prompt §11).

## Authentication
- DB-backed sessions: opaque 256-bit token, stored **hashed (SHA-256)** in `sessions`; HTTP-only, `SameSite=Lax`, `Secure` (behind TLS/Tailscale Serve) cookie; idle timeout 12h, absolute lifetime 30d; rotation on privilege change.
- Passwords: Argon2id (`@node-rs/argon2`, memory 19 MiB, iterations 2, parallelism 1) + per-account lockout with progressive delay after 5 failures (audited).
- Optional TOTP (otplib, ±1 step) + 10 single-use recovery codes (hashed).

## Authorization (RBAC)
- `users → user_roles → roles → role_permissions → permissions` (permission keys like `people.read`, `evidence.delete`, `performance.individual.read`, `branding.use`).
- Every server action / route handler calls `requirePermission()`; **deny by default**.
- Individual performance data additionally guarded by a dedicated permission granted only to the principal role in seed.

## Input & upload safety
- All mutations validated with Zod; all queries via Drizzle parameterized SQL (no string SQL).
- CSRF: session cookie is `SameSite=Lax` **and** all mutating requests must carry the `x-csrf-token` header matching a per-session token (double-submit); Next server actions additionally check Origin.
- Uploads: allowlisted MIME + extension pairs, size caps, filenames replaced by UUIDs; originals' names stored as metadata only; files written outside `public/` under `storage/`; downloads stream through authenticated handlers with `Content-Disposition` original-name and path-traversal-proof ID lookup (no client paths ever touch the filesystem).
- XSS: React escaping everywhere; no `dangerouslySetInnerHTML` with user content; evidence previews rendered from server-generated safe artifacts (images/extracted text), never raw HTML.
- Rate limiting: in-process token bucket on login, TOTP, downloads, and import endpoints (sufficient for single-host Tailscale deployment; documented limitation for multi-instance).

## Audit
Append-only `audit_log` (actor, action, entity, before/after summary JSONB, IP, timestamp) for: login success/failure, logout, approval, reopening (with reason), sensitive downloads, administrative changes, permission changes, signature/stamp use, import commit/rollback, backup/restore runs. No deletes; admin UI is read-only over it.

## Secrets
Only via environment (`.env` git-ignored; `.env.example` committed without values). No secrets in code, logs, or Git history. Signature/stamp live in `storage/private/branding/` (git-ignored), access permission-gated + audited. No app-level attachment encryption in v1 (approved decision D-005): mitigations = Tailscale-only network, Unix permissions (`storage/` chmod 700, service user), authenticated routes.

## Backups
- **Daily** (cron/launchd): `pg_dump -Fc` → `age`-encrypted (X25519, passphrase fallback) → `backups/daily/`, retention default 14.
- **Weekly full**: tar of DB dump + `storage/` + config manifest → `age`-encrypted → `backups/weekly/`, retention default 8; copy synced to an off-host target (external disk or second Tailscale node — operator guide).
- Retention configurable via settings; every run audited + notified in-app on failure.
- **Restore rehearsal**: `scripts/restore-rehearsal.sh` restores latest backup into a scratch Postgres (Docker) + scratch storage dir, runs smoke checks, records result. Required green before release (A15).

## Hosting path
Mac mini (dev/test) → Ubuntu Server: Docker Compose (app + Postgres 16 + volume-mounted storage/backups), Tailscale with HTTPS via `tailscale serve`, UFW default-deny, unattended-upgrades. Full steps in `docs/DEPLOY_UBUNTU_AR.md` (Phase 5).

## AI assistant security (corrective release, 2026-07-16)
- **No raw access:** the model only proposes calls into a typed, zod-validated tool registry; free-form output is never executed; no SQL or filesystem tools exist.
- **RBAC everywhere:** every read tool re-checks the current user's permission keys internally; write proposals re-check permission **at execution time**, not just at prompt time.
- **Two-step writes:** every write becomes a proposal with an itemized preview; explicit confirmation required; a guarded status transition + unique idempotency key make duplicate confirmations no-ops.
- **Hard exclusions:** approve/lock/sign/stamp/rating/weight/import-commit/permanent-delete/final-send/user-management actions have no tools at all; the allowlist is pinned by `tests/integration/ai.test.ts`.
- **Local by default, consent for external:** Ollama/AnythingLLM run on-device; the Claude API provider refuses to construct without the recorded `allowExternal` consent flag. AnythingLLM is knowledge-only and never executes application actions.
- **Secrets:** provider API keys live only in env (outside Git, never in DB); the settings UI shows presence only. System prompts, secrets and raw DB errors are never surfaced to the chat.
- **Audit:** `ai.prompt`, `ai.action_proposed/confirmed/executed/failed/cancelled`, `ai.settings_updated`, `ai.connection_tested`, `ai.conversation_deleted`, `ai.history_deleted` are all recorded with provider/model detail.
- **Retention:** conversations are per-user, user-deletable, and auto-pruned by the configurable retention policy.

## Transport security (corrective release, 2026-07-16)
Access from devices goes through Tailscale Serve HTTPS only (`https://<device>.<tailnet>.ts.net` → localhost:3080); Funnel/public exposure is forbidden. Session cookies are `Secure` whenever the request arrives over HTTPS and always in production; `HttpOnly` + `SameSite=Lax` unchanged. Server-action origins behind the proxy are restricted via `TRUSTED_ORIGINS` (default `*.ts.net`).
