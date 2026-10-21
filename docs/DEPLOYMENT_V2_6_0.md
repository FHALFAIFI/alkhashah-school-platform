# v2.6.0 — Production Deployment Report (2026-08-11)

**Status: DEPLOYED — acceptance candidate awaiting the principal's real-workflow
testing, with the Microsoft Word design gate still PENDING inspection (see
below). GitHub untouched (Actions quota): no push, no tag, no PR update, no
GHCR image, no release. Full evidence:
`~/Desktop/v2.6.0-deployment-e4be701/` (durable, outside script-controlled dirs).**

## Version identity

| | Previous | New |
|---|---|---|
| Version | v2.5.0 | **v2.6.0** |
| Commit | `39674ed` | **`e4be70124b8b8a8a6491d6a09c69faf87f11953f`** (full SHA embedded) |
| Image tag | `madrasa-app:0.1.0` | `madrasa-app:0.1.0` (= `0.1.0-v2_6_0-rc` = `2.6.0-rc-e4be701`) |
| Image ID | `sha256:bcd629a54848…` | **`sha256:5225669abf09…`** (built LOCALLY from the frozen source; linux/arm64) |
| DB ledger | 34 / 89 tables | **37 / 94 tables** (0035–0037, additive) |
| DB container | unchanged by deployment | unchanged by deployment |

Scope: the v2.6 reporting platform (archive, numbering, D-055 immutability,
63-report catalog, PDF/DOCX/XLSX/ZIP outputs), D-069/D-068/D-066 refresh and
filter fixes, Next 16.3, D-070 official Word design, and the `e4be701`
header-band reservation (the fix for the rejected `fade36f` Word gate).

## Gates (all recorded in the evidence folder)

- **Word design gate: PENDING — NOT passed.** The nine-file gate was regenerated
  from `e4be701` and every machine check is green (28/28 word-design tests, 9/9
  OOXML structural, 97/97 rendered-page header-band scan, 9/9 LibreOffice
  roundtrip), but the **interactive Microsoft Word inspection is not evidenced**:
  the only artifact is a single multiple-choice "proceed" selection, with no
  per-file or per-page findings. Deployment proceeded under that authorization;
  the gate itself stays open. Corrected 2026-08-11 — see
  `WORD_GATE_STATUS_CORRECTION.md` in the evidence folder. Files awaiting
  inspection: `~/Desktop/v2.6.0-word-design-final-gate-e4be701/`.
- **Local validation (clean checkout):** lint 0 / typecheck 0 / vitest
  **1228 passed, 3 justified skips** (git-ignored real Fares fixture; 8/8 pass in
  the repo tree) / production build OK.
- **Image:** built from the checksummed source archive, `RELEASE_COMMIT` = full
  SHA, saved+reload-verified; `npm audit`: 0 critical, findings identical to the
  deployed v2.5.0 lockfile (nothing new accepted).
- **Rehearsal (isolated, exact image):** clean install 37/94 + browser login +
  restart; **upgrade of the restored real production dump 34→37 with
  byte-identical data digests**; D-055 triggers live; rollback proven BOTH ways
  (restore+old-image, and v2.5.0-serves-ledger-37 fast path); full Playwright
  **147/1skip/0 ×3** over HTTP/1.1; D-069 scenarios **22/22 ×3**; output hashes
  durable across restart; auth 401/401/307/401; container DOCX carries the
  reserved header band.
- **Backup:** encrypted predeploy set `20260811-071037` (db/storage/config),
  **restore-verified byte-identical to live production** (578 objects, 0 probe
  diffs, uploads digest equal); exported copy + rollback image archive + source
  bundle in the evidence folder.

## Deployment & validation

Window **07:40:00 → 07:40:39** (+03). Migrate-only via the compose `init`
service, then app swap by immutable image ID. Health reports 2.6.0 + full
commit. Post-deploy: RBAC 401/401/307/401, app-restart recovery, zero
application log errors, data counts unchanged (audit +2 = validation login
probes). Authenticated smoke ran on a disposable clone of post-deployment data
(stale seeded credentials; production password reset forbidden — v2.5
precedent): all pages 200, exports carry the official design with the safe
text-identity fallback (production has no logos configured yet), synthetic
draft created/previewed/deleted with no manual reload. **Zero synthetic records
on production.**

## Closure review (2026-08-11, read-only)

- **ZIP export: PASS.** The post-deploy smoke's ZIP "failure" was a probe fault —
  it called the *catalog* export API (`/api/reports/export`), whose format
  whitelist is `csv|xlsx|pdf|docx` and silently coerces anything else to CSV
  (identical code in v2.5.0 and `e4be701`, so pre-existing, not a regression).
  ZIP belongs to archive issuance. Re-tested on a second isolated clone of the
  deployed state via `/api/reports/instances/<id>/download?format=zip`:
  HTTP 200, `application/zip`, `PK\x03\x04`, 66 448 B, Arabic
  `filename*`; the package opens with a clean CRC test, holds exactly the three
  expected outputs with full Arabic filenames, and every entry's sha256 plus the
  package sha256 match `report_outputs.checksum` and `stored_files.sha256`.
  Details: `ZIP_EXPORT_RESOLUTION.md`. Non-blocking observation retained: the
  catalog API should arguably return 400 for an unknown format instead of
  falling back to CSV.
- **Word gate reclassified to PENDING** (above); no application change.

## Incidents (pre-deployment, resolved, documented in the evidence folder)

1. The local image build OOM-starved the 2 GB Docker VM → the v2.5.0 app was
   OOM-killed/auto-recovered 3× (~5 s each). Rule adopted: never build images
   while production serves on this host.
2. Resulting containerd snapshot corruption wedged container creation → one
   controlled Docker Desktop restart (07:37, safety dump first): the session's
   single production DB restart (~20 s, clean). All data verified intact.

## Rollback (proven, retained)

`madrasa-app:0.1.0-prev-v2_6_0-20260811` = `sha256:bcd629a54848…` (+ archived
tar with checksum). Runbook: `ROLLBACK_RUNBOOK.md` in the evidence folder —
fast app-only path (additive migrations, proven) and full restore path
(encrypted set `20260811-071037`, restore-verified).

## Deferred until principal acceptance

`v2.6.0` git tag, push, PR #1 merge/closure, GHCR publication, GitHub release,
gold package, host-PC migration. The deployable source is preserved in
`~/Desktop/v2.6.0-release-preservation-e4be701/` (verified bundle + archive +
patch + lockfiles + checksums) for the eventual push.
