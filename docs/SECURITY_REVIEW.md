# Basic Security Review Report — تقرير المراجعة الأمنية الأساسية

Date: 2026-07-16 · Scope: first release, Tailscale-only deployment.

## Controls verified (with evidence)
| Threat | Control | Evidence |
|---|---|---|
| Broken auth | Argon2id hashes; DB-backed sessions w/ SHA-256-hashed opaque tokens; idle (12h) + absolute (30d) expiry; lockout w/ progressive delay; sessions invalidated on password change | `src/lib/auth/*`, `admin/users/actions.ts`; e2e A18 |
| Broken authorization | Deny-by-default `requirePermission` on every page/action/route; permission-keyed (not role-named); individual-performance + branding extra-gated | rbac tests; 401/403 e2e |
| SQL injection | Drizzle parameterized queries only; no string-built SQL | code review; no `sql.raw` with input |
| XSS | React auto-escaping; no `dangerouslySetInnerHTML`; report HTML built via `esc()` helper; evidence previews rendered from server-generated artifacts | `grep dangerouslySetInnerHTML` → none |
| CSRF | SameSite=Lax cookie; server actions Origin-checked by Next; state-changing API routes require `x-csrf-token` matching per-session token (sync endpoint tested) | building.test.ts (403 without token) |
| Path traversal | Files addressed by UUID only; `safeResolve` rejects paths escaping STORAGE_DIR; client never supplies paths | `src/lib/storage.ts` |
| Unsafe upload | MIME+extension allowlist, 20MB cap, UUID filenames, stored outside `public/`, streamed via authenticated handler with nosniff | `validateUpload`; A18 e2e |
| Sensitive data exposure | Data minimization at parse level (sensitive Fares columns never persisted); signature/stamp private + permission-gated + audited download; individual performance principal-only | A8 test; files route |
| Abuse/rate spikes | In-process token buckets on login/TOTP/downloads (documented single-host limitation) | `src/lib/rate-limit.ts` |
| Secrets in VCS | `.env*`, `storage/`, `backups/`, `reference_files/` git-ignored; `.env.example` valueless; no secrets in code | `.gitignore`; repo scan |
| Audit | Append-only log: logins, approvals, reopenings (w/ reason), sensitive downloads, admin changes, signature/stamp use, imports, backups sync | `src/lib/audit.ts` usages |
| Backup security | Always encrypted (AES-256-CBC, PBKDF2 200k iters); passphrase via env only; retention pruning; restore rehearsal green | scripts/, rehearsal log |

## Known limitations / accepted risks (first release)
1. **No app-level attachment encryption** — approved decision (D-005); mitigations: Tailscale-only network, Unix perms 700/600, authenticated routes.
2. **In-process rate limiting** — resets on restart, not shared across instances; acceptable single-host; revisit before any scale-out.
3. **No public internet exposure** — by design; separate security review REQUIRED before enabling.
4. **TOTP optional** — enabled per-account; recommend enabling for both accounts at go-live (recovery codes hashed).
5. **AI/M365 disabled by default** — enabling M365 introduces Graph credentials on host; store only in `.env` with 600 perms. Local AI providers receive record text; external AI would require per-action explicit consent (enforced in design; external provider not shipped).
6. Session cookie `Secure` flag requires HTTPS (Tailscale Serve) in production — documented in deploy guide.

## Recommendations before go-live
- Change both initial passwords; enable TOTP; delete `initial-credentials.txt` after storing safely.
- Run `restore-rehearsal` on the Ubuntu host; verify off-site backup copy exists.
- Review audit log weekly for failed-login clusters.
