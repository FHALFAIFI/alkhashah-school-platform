# BRIEF v2.4.0 — Principal post-acceptance feedback (round 6)

> Source: owner-delivered corrective/enhancement prompt of 2026-08-01, referencing the
> source package `fathers-app-review-2026-08-01.zip` (verified byte-identical to git HEAD
> `b47558c`, i.e. deployed v2.3.0). Production remains at migration 27 and is NOT touched
> by this scope until a separately authorized deployment. This document condenses every
> requirement; the operative English prompt is the authority of record.

## Priorities

**P0 — data correctness & navigation defects**
1. Budget remaining balance visible everywhere spending is shown.
2. Weekly follow-up incorrectly shows all programs as complete (root-cause fix, not presentation).
3. Sidebar: independent scroll + scroll-position retention across navigation/reload.
4. Safe deletion/archival of employee evaluation forms.

**P1 — missing operational outputs**
1. Detailed committee/council registry report (members as separate rows, tasks per member).
2. Detailed employee performance reports (individual + school-wide).
3. Program reports showing names, not only counts (by responsible employee, by domain).
4. Printable program card (reuse v2.3 `generateProgramCard` if suitable; wire access points).
5. Maintenance report suitable for external sending (reuse v2.3 `generateMaintenanceLetter`).
6. Direct inspection→maintenance workflow (post-save conversion offer, dedup, linked visibility).
7. Homepage program approval queue «بانتظار اعتماد المدير» (tabs: new/complete-awaiting-review/ready-to-close/returned).

**P2 — reporting presentation**
1. Unified official report header (one shared component; ministry identity via settings, D-040).
2. Report colors/visual hierarchy — official, restrained, print-safe.
3. Consistent print/PDF layout.

## Key domain rules from the brief

- Budget: `remaining = allocated − valid posted expenditure`; exclude deleted/cancelled/reversed/
  rejected; decimal-safe math; recompute from authoritative records; per-expense balance
  before/after where feasible; overspend → warning + negative display only if domain permits.
- Weekly follow-up must NOT equate: 100% progress ⇔ closure; evidence uploaded ⇔ complete;
  user-marked complete ⇔ principal approval; missing status ⇔ complete. Include all active
  programs; label «لم يتم التحديث هذا الأسبوع»; preserve historical snapshots where they exist.
- Evaluation forms: draft+unused → hard delete; published+unused → hard delete after confirm;
  used → archive (default), preserve history/reports/referential integrity; permanent cascade
  delete only for privileged role with linked-record counts + typed confirmation + audit +
  transaction safety. Last active default form is not deletable. UI actions: «أرشفة النموذج» /
  «حذف النموذج». Archived forms searchable via archive filter; historical reports still render.
- Homepage approval queue reflects real workflow states; return requires a comment; bulk approve
  only where safe and never bypassing required checks; all actions audited + permission-gated.
- Committee registry: one section per committee (basic info, members/assignments, meetings/minutes,
  decisions/recommendations, task execution, results/impact); each member a separate row; keep a
  standalone committee card doc.
- Maintenance: after saving an inspection with unsatisfactory findings, offer creating complaints
  (all / selected / review / skip); dedup against open linked requests; bidirectional links shown;
  draft complaints explain why print is unavailable + «اعتماد البلاغ وإصدار التقرير» action; after
  approval show print/PDF immediately.
- Building visual matters (map, green panel): explicitly deferred to a later building-focused
  iteration; document under known limitations.
- Header: one shared report-header component across all printable reports/PDFs; no per-report
  duplicated markup; identity assets owner-supplied via settings (D-040 stands).
- Migrations only when necessary; reversible where reasonable; rehearse on production clone;
  sidebar state requires NO migration.
- Full test coverage per brief §20; regression sweep §21; focused security review §22 (High/
  Critical must be fixed before release).

## Acceptance criteria (22)

As enumerated in the operative prompt §24 — tracked in the v2.4 delivery report.

## Out of scope (unchanged)

- Building map / green panel redesign (deferred, §14F).
- Any production deployment, release tag, gold backup, or host-PC migration — rehearsal only
  (§23 Phase G), deployment awaits explicit owner authorization.
