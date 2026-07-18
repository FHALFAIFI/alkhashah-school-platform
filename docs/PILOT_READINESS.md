# تقرير جاهزية التشغيل التجريبي (Pilot Readiness) — 2026-07-18

## STATUS: ACCEPTED — SOFTWARE READY; OPERATIONAL ACTIVATION PENDING

**Accepted 2026-07-18.** The software capabilities are accepted (5 modules PASS). Operational activation
is the principal's manual sequence (§3). **No release tag is created** — `v1.0.0-pilot` waits until the
principal completes activation (starting with committing the Fares batch). Activation **step 1 (commit
Fares) is prepared and staged to «تأكيد التنفيذ» but NOT executed** — see `docs/FARES_ACTIVATION_STEP1.md`.

منصة الإدارة المدرسية المتكاملة — مجمع الخشعة التعليمي للبنين. لغة التقرير إنجليزية حسب سياسة المستودع؛
النصوص الواجهية مقتبسة بالعربية. **لا يُنشأ وسم إصدار قبل اعتماد المدير لهذا التقرير.**

## 1. Passed capabilities (accepted)

| Module | Status | Commit |
|---|---|---|
| Operational-plan workflow | **PASS** | `a3523bc` |
| Committees & Learning Communities | **PASS** | `7520a8f` |
| Performance Management | **PASS** | `0975f0b` |
| Digital Twin (building) | **PASS (capability)** | `a36fd8b` |
| Principal Command Center + Local AI | **PASS** | `16b644c` |

- **Command center**: the dashboard shows a "قرارات مدير المدرسة الاستراتيجية" panel with the 8 genuine
  pending decisions, each linking directly to the record/action (verified desktop + 390×844, 0 overflow).
- **Local AI**: Ollama **qwen3:4b** enabled via the Arabic settings UI, local-only (no Claude/paid);
  connection «✔ الاتصال ناجح»; assistant dock visible on desktop and mobile.
- **Read-only prompts**: 5 real-data prompts answered in Arabic, grounded in real (non-synthetic) state,
  **no writes**.
- **Controlled actions**: preview → confirmation → audit for all AI write tools; the AI has **no tool** to
  rate, change weights, approve, lock, sign, stamp, commit imports, delete, send final email, or change
  permissions.
- **Failure behavior**: on a stopped local service the assistant shows a clear Arabic message + a
  settings/troubleshooting link + "بقية المنصة تعمل"; the rest of the platform stays usable; no
  fabricated results.
- **Gates**: 143 vitest + 39 Playwright green (1 skipped = C5); typecheck/lint clean.

## 2. Real configuration still pending (principal's manual decisions)

1. **Fares employee batch** is in «معاينة» (52 rows) — **not committed**. Blocks committees + performance.
2. **Operational plan**: imported/executed batch `385c615a`, but the **26 programs are «مسودة»** — not
   approved/locked.
3. **D-014**: 3 weight cells (5% adopted vs 15% guide) marked «بانتظار المطابقة مع نظام فارس» — real
   final-lock is blocked until reconciled with نظام فارس (new audited model version).
4. **Digital Twin real config = PARTIAL**: ground floor published (17 rooms); **upper floors (الأول/
   الثاني/الثالث) remain drafts** pending principal review/publish.
5. **Synthetic-data archive**: deferred (records hidden by the central exclusion filter, not archived).

## 3. Exact principal actions — recommended order

1. **Commit the Fares batch** — `/imports/12673bed-c6ae-4f28-af9d-c311fb2e7a3d` → review the 52 rows →
   «موافقة صريحة وتنفيذ الاستيراد». (Unblocks committees + performance.)
2. **Approve the 26 operational-plan programs** — `/plan` → each program → «اعتماد وإقفال». (Enables
   weekly follow-up + change requests.)
3. **Reconcile D-014 with نظام فارس** — `/performance/models/...` → confirm the 3 cells → if different,
   «إعادة فتح بسبب موثق» → new approved model version. (Enables final locking for those models.)
4. **Review & publish the upper floors** — `/building/editor/first` (then second, third) → compare with
   the source image → «نشر النسخة». (Generates their room registers.)
5. **(Optional) Archive synthetic records** — `/admin/cleanup` → «أرشفة السجلات التجريبية» (deferred; the
   central filter already hides them from customer views).

## 4. AI provider / model and measured response time

- **Provider**: Ollama (local, Mac mini) — `أولاما (محلي)`. **No external/paid provider** (Claude not
  selected; external requires explicit recorded consent).
- **Model**: **qwen3:4b** (also installed: `llama3.2:3b`). Thinking mode disabled (`think:false`).
- **Connection ping**: «✔ الاتصال ناجح — qwen3:4b — 18 م.ث» (server-measured).
- **Real-prompt latency** (5 read-only prompts with tool-use, round-trip): **~12–22 s** each, average
  **≈16 s**. Suitable for a single-principal pilot; not a multi-user concurrent load profile.
- **Known limitation**: the small 4B model occasionally mis-selects a tool (the building-readiness prompt
  returned a plan summary). Responses are grounded and never fabricated, but tool routing is imperfect on
  a 4B local model — acceptable for pilot, note for the principal.

## 5. Remaining deferred items

- **C5** (real HTTPS certificate / camera / PWA / offline): **DEFERRED_BY_PRODUCT_OWNER (D-018)**. Access
  over the current network with manual fallbacks («فتح غرفة بالرمز», plain file upload).
- **Synthetic-data archive**: deferred (see §2.5).
- **Editor precise wall/polygon editing**: desktop/tablet-only (fixed Konva canvas) with an Arabic note on
  mobile; numeric room editing works on mobile.

## 6. Release-tag recommendation

**Recommended: create `v1.0.0-pilot` ONLY after the principal (a) accepts this report and (b) completes
actions §3.1 (commit Fares) and §3.2 (approve the plan).** Until Fares is committed, committees and
performance cannot run with real staff, so a pilot tag would capture a not-yet-operational configuration.
The software capabilities are accepted (PASS); the remaining blockers are the principal's manual
configuration decisions, not code. **No tag has been created — awaiting your approval.**
