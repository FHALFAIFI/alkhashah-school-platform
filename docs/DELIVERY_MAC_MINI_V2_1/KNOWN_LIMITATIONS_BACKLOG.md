# Known Limitations & Post-Delivery Backlog — Scope v2.1

## Known limitations (as delivered)

1. **`insertBefore` root cause = PROBABLE (D-029).** The class-level fix is in place (browser-translation
   guard, hardened shared primitives, shell hydration, Arabic-only error boundary, secure client
   diagnostics) and the deployed login SSR is clean, but the conclusive proof is the principal's
   real-browser retest. Not raised to CONFIRMED on inference.
2. **Tailscale Serve dormant.** Remote HTTPS access is not currently configured (`No serve config`) — the
   platform is reached over the LAN (`192.168.0.48:3080`) during the retest phase. Re-enabling remote
   access is an operator action (`tailscale serve --bg 3080`); intentionally not done here (exposure change).
3. **Temporary LAN retest settings live.** `APP_BIND=192.168.0.48` + `ALLOW_INSECURE_LAN_HTTP=true` allow a
   non-Secure session cookie over plain-HTTP on the trusted LAN. These are temporary; revert to loopback +
   Tailscale HTTPS (always-Secure) after the retest. The `compose.production.yml` LAN diff is deliberately
   left **uncommitted**.
4. **Retained legacy records.** 129 `program_activities` + 129 `program_milestones` (+ deliverables /
   evidence-requirements / state-history) are retained but inert — kept for audit/traceability/rollback,
   not read by any current workflow. They are not deleted (no destructive migration).
5. **Committee task templates seed on demand.** `committee_task_templates` / `committee_task_assignments`
   are empty at delivery; predefined templates are seeded in-app via the task-templates action — not via a
   production reseed.
6. **C5 / D-018 deferral.** The HTTPS camera / service-worker (PWA) test is skipped unless `APP_URL` is an
   HTTPS origin; deferred by product owner. Not part of v2.1.
7. **D-014** remains an open, documented performance-source reconciliation (models file vs guide weight
   cells) — unrelated to this deployment; reconciled by the principal at the first real evaluation cycle.

## Post-delivery backlog (not started — require separate authorization)

1. **Host-PC migration** — see `DESTINATION_PC_CHECKLIST.md`. Not started.
2. **Final release tag** — created only after genuine principal acceptance.
3. **Structural no-seed guarantee** — a dedicated migrate-only compose service (or removing `seed.ts` from
   `init`) so the no-reseed guarantee is structural, not command-discipline. Deferred so the uncommitted LAN
   compose diff stays untouched.
4. **Restore-to-live drill on destination hardware** — rehearse restoring the encrypted backup on the PC
   before cutover.
5. **Revert temporary LAN cookie relaxation** — once Tailscale HTTPS is the access path again, set
   `ALLOW_INSECURE_LAN_HTTP=false`, remove `APP_BIND`, and trim `TRUSTED_ORIGINS` back.
6. **Optional pruning of retained legacy activity records** — only after the principal confirms no
   rollback need, and only via an authorized, backed-up, reversible step.

## Disclosed historical deviation (permanent record)

During an earlier read-only verification an accidental `CREATE EXTENSION pgcrypto` was immediately reversed
with `DROP EXTENSION pgcrypto` (no CASCADE, no dependents) — **net-zero**, no application table modified.
This deployment did **not** repeat it; pgcrypto is confirmed absent and is unnecessary on Postgres 16
(`gen_random_uuid()` is a core function). Integrity checks use the canonical `verify-milestone-baseline.ts`
tool, never SQL `digest()`.
