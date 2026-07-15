# PROGRESS — سجل التقدم

> Resume protocol: read this file top-to-bottom, then `git log --oneline -20`, `git status`, `docs/DECISIONS.md`, and the latest test results. Continue from the last checkpoint — never restart.

## Current state
- **Phase:** 0 — Discovery & foundation (in progress)
- **App:** Next.js 16.2.10 skeleton at repo root, port 3080. DB: Postgres 16 via Docker on host port **5544** (5432 is taken by another project on this Mac).
- **Docs:** REQUIREMENTS_AR, DECISIONS, DATA_MAPPING, ACCEPTANCE_TESTS, SECURITY_AND_BACKUP — written.
- **Reference files:** moved into `reference_files/` (git-ignored). Extraction scratch work in session scratchpad; canonical import happens at runtime from the originals.

## Key facts discovered (Phase 0)
- Operational plan (المتكاملة workbook): **26 programs** (الإدارة المدرسية 7، التعليم والتعلم 6، نواتج التعلم 8، البيئة المدرسية 5); end date **5/1/1449هـ** verbatim; program details include Hijri start/end, milestones, priority, baseline/target.
- School calendar 1448–1449: 16 official events; **عودة المعلمين = 1448/3/10 = 2026/8/23** (teacher-cycle anchor); عودة الهيئة الإدارية = 1448/3/2 = 2026/8/16; بداية الدراسة = 1448/3/17 = 2026/8/30.
- Evidence register workbook: package rules (شاهد تنفيذ + مخرج + أثر + خارجي عند الانطباق), lookup lists, readiness formulas.
- Committees PDF: 6 entities fully captured (chairs, seats, duties, recurrence) — see DATA_MAPPING §7.
- Building PPTX: 4 floors, raster plans + text overlays (names + meters). Site PDF: aerial with 26×18 m field calibration.
- **MISSING files (D-006):** official 8-model performance PDF, performance guidance PDF, Fares employee xlsx, Pasted markdown.md. Work proceeds; official model content and real employee import deferred until files arrive. NOT a reason to halt other phases.

## Checkpoints
- (pending) `phase-0` commit: docs + skeleton + docker + test framework.

## Next steps
1. Finish skeleton: configs, Docker Compose, Drizzle setup, base schema migration, seed, vitest/playwright wiring.
2. Commit Phase 0 checkpoint.
3. Phase 1: RTL shell + auth/RBAC + people + evidence + tasks + audit + safe imports + operational plan module.
