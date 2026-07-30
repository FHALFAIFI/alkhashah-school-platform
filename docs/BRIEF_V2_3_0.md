# Father's App — Principal Feedback Implementation Brief (v2.3.0)

> Verbatim requirements source received 2026-07-31 (principal's 5th feedback round).
> Target release: **v2.3.0 — Principal Acceptance Release**. Implementation tracking:
> `docs/SCOPE_IMPACT_V2_3.md`; decisions D-032+ in `docs/DECISIONS.md`.

## Target release

**v2.3.0 — Principal Acceptance Release**

This release shall incorporate the principal's operational feedback, improve usability and reporting, simplify the performance module, and remove unnecessary AI-related functionality.

The existing v2.2.1 corrective work for the building sketch and program lifecycle must be retained.

---

# 1. Non-negotiable production constraints

* Do not reset, truncate, recreate, or reseed production.
* Never run `seed.ts` in production.
* Preserve all existing activities, milestones, documents, financial records, evaluations, evidence, and audit history.
* Do not modify frozen or previously issued document snapshots.
* PostgreSQL must remain unpublished.
* No destructive migration is permitted.
* Every database migration must be rehearsed against an isolated production clone.
* Create and verify an encrypted backup before production deployment.
* Do not migrate to the principal's final host PC until principal acceptance.
* Do not create the final release tag or gold backup until acceptance is recorded.

---

# 2. Date system redesign

## Requirement

Every date field in the system must support both:

* Gregorian calendar.
* Hijri calendar.

The user must be able to choose which calendar to use while entering a date.

## Expected behaviour

* Every date picker must have a visible calendar selector:

  * هجري
  * ميلادي
* The selected date must be clearly identifiable.
* Avoid ambiguous numeric-only dates such as `03/04/1448`.
* Display the month name where practical.
* Show the selected calendar type beside the field.
* Important dates should display both calendar equivalents.

Example:

**15 أغسطس 2026م — 2 ربيع الأول 1448هـ**

## Technical rules

* Store one canonical Gregorian date in the database.
* Record the calendar mode used during entry when operationally useful.
* Generate the corresponding Hijri representation for display.
* Do not maintain two independent editable dates for the same event.
* Apply the date component consistently across:

  * Programs.
  * Evidence.
  * Performance evaluations.
  * Committees and councils.
  * Inspections.
  * Maintenance complaints.
  * Financial transactions.
  * Employee records.
  * Reports.
  * Documents.
  * Audit views.
* Validate impossible or malformed dates.
* Verify Hijri conversion around month and year boundaries.

---

# 3. Terminology changes

Replace:

**اعتماد وإقفال**

With:

**اعتماد**

Apply the wording consistently across:

* Buttons.
* Dialogues.
* Tutorials.
* Workflow instructions.
* Reports.
* Generated documents.
* Notifications.

Do not change the underlying workflow silently. Review every location using the old term and ensure that the new label accurately represents the action.

---

# 4. Workflow tutorial and contextual guidance

The workflow tutorial shown at the top of relevant pages must be rewritten to match the actual current workflow.

## Requirements

* Remove outdated workflow instructions.
* Explain the lifecycle using short operational steps.
* Reflect the three-state program lifecycle:

  * قيد التنفيذ
  * مكتمل
  * مغلق
* Explain that evidence is not required to complete or close a program.
* Explain the difference between:

  * تعليم البرنامج كمكتمل
  * إقفال البرنامج نهائياً
  * إعادة فتح البرنامج
  * إعادة البرنامج للتنفيذ
* Update tutorials for:

  * Programs.
  * Performance.
  * Inspection and readiness.
  * Maintenance complaints.
  * Finance.
  * Reports.
* Tutorials must be collapsible.
* The collapsed state should be remembered for the user.
* Do not allow instructional panels to consume excessive screen space.

---

# 5. Evidence and file-upload approval

## Required approval logic

Uploads made directly by the principal must be accepted automatically.

They must not require a second approval action by the same principal.

## Authorization rule

* Principal upload:

  * Automatically accepted.
  * Saved immediately.
  * Principal identity and timestamp recorded.
* Upload by any future non-principal role:

  * Remains pending.
  * Requires principal approval.
* Automatic acceptance must be server-side and based on authenticated role.
* It must not depend on a value sent by the browser.
* Record the approval method in the audit trail:

  * قبول تلقائي بواسطة المدير
  * اعتماد يدوي بواسطة المدير

This logic must apply to all appropriate upload areas, including:

* Program evidence.
* Performance attachments.
* Committee and council documents.
* Inspection evidence.
* Maintenance photographs and attachments.
* Receipts and invoices.
* Building documents.
* Reports and signed documents.

File-security validation must remain active even when the file is auto-accepted.

---

# 6. Budget and finance logic review

The finance dashboard and cards must provide operational detail, not only high-level totals.

## Required card information

Each financial item card must show:

* المبلغ المعتمد
* المصروف
* المتبقي
* نسبة الاستخدام
* عدد العمليات
* آخر عملية مالية
* قيمة آخر عملية
* وجود تجاوز أو اقتراب من الحد

## Drill-down

Selecting a card must open a detailed view showing:

* Income transactions.
* Expense transactions.
* Invoice number.
* Transaction date.
* Financial item.
* Description.
* Amount.
* Receipt or invoice attachment.
* User who entered the transaction.
* Creation and modification history.
* Running balance.

## Dashboard requirements

Show clearly:

* إجمالي الإيرادات
* إجمالي المصروفات
* الرصيد النقدي
* إجمالي الاعتمادات
* إجمالي المتبقي من البنود
* البنود الأعلى صرفاً
* البنود القريبة من النفاد
* البنود المتجاوزة
* المصروفات دون مرفقات, where applicable
* Recent financial activity

## Validation

Reconcile and test:

* Sum of item allocations.
* Sum of expenses.
* Remaining amounts.
* School cash balance.
* Behaviour when expenses exceed allocation.
* Behaviour when income and allocation represent different concepts.
* Editing and deleting transactions.
* Attachment replacement.
* Historical report totals.

The interface must clearly distinguish:

* School cash availability.
* Budget allocation by item.
* Actual expenditure.

These are related but not identical values.

---

# 7. Report generation and downloading

Reports must not remain screen-only views.

Every supported report must be generatable and downloadable.

## Required formats

Minimum:

* PDF.
* Word.

Where the report is primarily tabular:

* Excel export should also be available.

## Report-generation behaviour

* Generate reports from actual current data.
* Allow selection of applicable date ranges and filters.
* Display the active filters in the generated report.
* Record report generation in the audit history.
* Provide a clear file name containing:

  * Report type.
  * School name.
  * Generation date.
* Do not overwrite issued reports silently.
* Preserve immutable snapshots for formally issued documents.
* Draft previews may be regenerated without becoming issued snapshots.

## Long-report visual quality

Tall or multi-page reports must include:

* Proper page breaks.
* Repeated table headers.
* Page numbers.
* Report title on each major section.
* Table of contents for large reports.
* Executive summary.
* Summary cards or charts before detailed tables.
* Clear section dividers.
* Avoid rows splitting badly across pages.
* Avoid blank or near-empty pages.
* Avoid oversized headings.
* Avoid very small text.
* Proper RTL alignment.
* Consistent Arabic typography.

---

# 8. Ministry of Education visual identity

Generated formal reports and documents should use a visual system aligned with the Saudi Ministry of Education.

## Requirements

* Use approved Ministry of Education brand colours.
* Use the approved logo assets.
* Bundle assets locally.
* Do not retrieve logos or fonts remotely at report-generation time.
* Preserve sufficient whitespace around logos.
* Maintain print readability in colour and grayscale.
* Do not distort or recolour official logos.
* Use a consistent report header and footer.

Formal documents should show:

**مدير مجمع الخشعة للبنين**
**حسين بن جابر أحمد الفيفي**

This naming must be centralized in school settings rather than hard-coded repeatedly.

The document header should support:

* Ministry logo.
* School or education authority information.
* School name.
* Document title.
* Academic year.
* Reference number where applicable.
* Hijri and Gregorian date.
* Principal name and title.

---

# 9. Complete default document templates

The system must provide complete ready-to-use templates.

The principal should edit existing templates, not be required to create templates from an empty page.

## Required model

For each document/report type:

* Ship a professionally drafted default template.
* Allow the principal to edit it.
* Support preview using sample data.
* Support preview using an actual record.
* Maintain template version history.
* Allow restoring a previous version.
* Allow resetting to the system default.
* Preserve issued documents independently from later template edits.

## Default templates to prepare

At minimum:

* Program implementation card.
* Program assignment card for executers.
* Program completion report.
* Program closure report.
* Detailed employee KPI report.
* Overall performance report.
* Committee report.
* Council report.
* Meeting minutes.
* Inspection report.
* Room inspection checklist.
* Inspection-readiness report.
* Maintenance complaint letter.
* Maintenance follow-up report.
* Maintenance closure report.
* Financial summary report.
* Detailed financial report.
* Evidence portfolio report.
* Building and facilities report.
* Risk report.
* SWOT report.
* Employee report.
* Executive school dashboard report.

The template editor must remain allowlisted and must not allow arbitrary HTML, JavaScript, remote assets, or executable template code.

---

# 10. Employee KPI detailed reports

Create a detailed report for every employee evaluation.

## Employee-level report content

* Employee name.
* Job title.
* Department or assignment.
* Evaluation type.
* Evaluation period.
* Evaluator.
* Evaluation date.
* Each KPI or evaluation criterion.
* Maximum score.
* Actual score.
* Percentage.
* Rating.
* Notes.
* Recommendations.
* Attachments or evidence where applicable.
* Strengths.
* Weaknesses.
* Required improvement actions.
* Follow-up date.
* Previous evaluation comparison.
* Overall score.
* Final evaluation status.
* Principal approval.

## Report views

Provide:

* Individual detailed report.
* Employee evaluation history.
* Comparison between evaluation periods.
* Printable and downloadable report.
* Filter by employee, evaluation type, period, and status.

---

# 11. Overall KPI analysis and weakness detection

Create an overall performance dashboard that identifies weak evaluation areas and gives practical insights.

This must not depend on generative AI.

Use transparent, rules-based calculations.

## Required indicators

* Average score by evaluation criterion.
* Average score by evaluation model.
* Average score by employee.
* Highest-performing criteria.
* Lowest-performing criteria.
* Criteria below a configurable threshold.
* Employees requiring follow-up.
* Evaluations not yet started.
* Evaluations in progress.
* Evaluations completed.
* Evaluations awaiting final approval.
* Score distribution.
* Change between evaluation periods.
* Recurring weaknesses across multiple employees.
* Recurring weaknesses across multiple evaluation models.
* Criteria with insufficient data.
* Missing evaluation records.

## Deterministic insight examples

* "معيار التخطيط أقل من الحد المستهدف في 7 من أصل 12 تقييماً."
* "تحسن متوسط الزيارات الصفية بمقدار 8% مقارنة بالفترة السابقة."
* "ثلاثة موظفين لم تُستكمل تقييماتهم النهائية."
* "معيار استخدام التقنية يمثل أضعف معيار على مستوى المجمع."

Every insight must link to the underlying employees or evaluations used to calculate it.

Do not show an insight unless the supporting sample is sufficient.

---

# 12. Performance module simplification

Review the complete performance module and remove unnecessary functionality.

## Simplification objectives

* Reduce page count.
* Reduce duplicated actions.
* Remove inactive experiments.
* Remove unused configuration.
* Remove redundant statuses.
* Remove unnecessary mandatory fields.
* Remove AI-generated analysis.
* Remove AI buttons, prompts, indicators, and background requests.
* Keep only functions that support actual principal workflows.

## Recommended core structure

1. Employees.
2. Evaluation models.
3. Evaluation sessions.
4. Employee evaluation.
5. Final approval.
6. Individual reports.
7. Overall performance dashboard.

## AI removal

Remove AI from the school application runtime:

* No Ollama dependency for normal application use.
* No AI report generation.
* No AI recommendations.
* No AI chat component.
* No unused AI environment variables.
* No AI model-health checks.
* No AI-related loading delays.
* No dead AI dependencies in the application image.

Insights should be created using deterministic business rules.

Removing AI must not remove the controlled SWOT import unless that feature directly depends on AI. If it does, preserve imported data and replace the runtime dependency with a non-AI import path.

---

# 13. Dashboard redesign

The main dashboard should become a monitoring and control centre, not simply a collection of counts.

## Top-level monitoring cards

* Programs currently in progress.
* Programs completed.
* Programs closed.
* Programs delayed.
* Upcoming program dates.
* Open maintenance complaints.
* Maintenance complaints awaiting response.
* Unresolved inspection findings.
* Building readiness percentage.
* Financial balance.
* Remaining budget by item.
* Budget warnings.
* Evaluations requiring action.
* Weak KPI criteria.
* Missing employee evaluations.
* Recent evidence.
* Recent documents.
* Pending approvals, if any.
* Reports generated recently.

## Dashboard interaction

* Every card must drill into the underlying records.
* Filters must be preserved while navigating back.
* Display actionable records, not only totals.
* Use compact charts.
* Avoid excessive decorative graphics.
* Provide a clear "requires attention" section.
* Provide a recent activity section.
* Provide upcoming deadlines.
* Use consistent status colours and meanings.
* Avoid duplicating the same metric in several places.

---

# 14. Building sketch size

The building sketch must not dominate the page.

## Required behaviour

* Use a moderate default viewport height.
* Recommended desktop default: approximately 45–55% of the visible page height.
* Recommended mobile default: approximately 35–45% of the visible page height.
* Provide an explicit full-screen or expand option.
* Retain zoom, pan, fit, reset, wheel, pinch, and floor switching.
* Keep room details outside or beside the sketch where space allows.
* Do not place sketch controls underneath the sticky header.
* Preserve the v2.2.1 pure-SVG viewBox implementation.

---

# 15. Meaning and naming of "قائمة المرافق المطلوبة"

The current label is ambiguous.

It may be interpreted as:

* Facilities the school requests to add.
* Missing facilities.
* Facilities requiring maintenance.
* Facilities required during inspection.

Recommended replacement:

**المرافق المطلوب توفيرها أو تحسينها**

Use this section only for facilities that:

* Do not currently exist but are needed.
* Exist but require substantial development or replacement.

Examples:

* مصعد.
* قاعة متعددة الأغراض.
* غرفة صلاة مناسبة.
* مختبر إضافي.
* أدوات سلامة إضافية.

Do not use this list for ordinary repair issues. Repair issues belong under:

**بلاغات الصيانة**

If the list duplicates risks, inspections, or maintenance complaints without adding operational value, remove it rather than preserving a confusing feature.

---

# 16. Inspection and readiness workflow redesign

Review and restructure:

* الفحص والجاهزية
* تنفيذ الفحص
* نتائج الفحص
* إجراءات المعالجة
* تقارير الفحص

## Proposed workflow

1. Configure room types.
2. Configure the default inspection template for each room type.
3. Register actual rooms and facilities.
4. Start an inspection for a specific room.
5. Load the template associated with that room type.
6. Complete checklist items.
7. Record findings.
8. Add photographs or documents.
9. Assign severity.
10. Assign responsibility.
11. Set target resolution date.
12. Determine readiness.
13. Generate inspection report.
14. Create a maintenance complaint from a finding when required.
15. Follow up and close the finding.

## Suggested statuses

* لم يبدأ
* جارٍ الفحص
* يحتاج معالجة
* جاهز
* غير جاهز
* مغلق

Avoid using too many overlapping statuses.

## Readiness calculation

The calculation must be transparent.

Possible structure:

* Critical item failed:

  * Room cannot be marked ready.
* Non-critical items:

  * Contribute to a readiness percentage.
* Manually overridden readiness:

  * Requires principal reason and audit entry.

The interface must show exactly why a room is considered ready or not ready.

---

# 17. Room-based inspection templates

Inspection templates must be based primarily on room type, not inspection type.

## Examples of room types

* فصل دراسي.
* مختبر حاسب.
* مختبر علوم.
* مكتبة.
* مكتب إداري.
* غرفة معلمين.
* مستودع.
* دورة مياه.
* ساحة.
* ممر.
* درج.
* مصلى.
* غرفة كهرباء.
* غرفة أمن وسلامة.
* قاعة متعددة الأغراض.

## Template requirements

Each room type should have a complete default checklist covering applicable areas such as:

* السلامة.
* الكهرباء.
* النظافة.
* التهوية.
* التكييف.
* الأثاث.
* التقنية.
* الأبواب والنوافذ.
* الإضاءة.
* مخارج الطوارئ.
* أدوات الإطفاء.
* اللوحات الإرشادية.
* سهولة الوصول.
* الملاحظات العامة.

The principal must be able to:

* Edit a room-type template.
* Add an item.
* Remove an item.
* Reorder items.
* Mark an item critical.
* Set expected evidence.
* Set answer type.
* Activate or deactivate an item.
* Preview the checklist.
* Reset to the system default.
* Preserve previous inspections against the template version used at inspection time.

Changing a template must not alter historical inspection records.

---

# 18. Maintenance complaint workflow

Rename and standardize the module as:

**بلاغات الصيانة**

The objective is to generate a formal complaint or maintenance request document that can be sent to the maintenance company and followed until closure.

## Workflow

1. Create complaint.
2. Select building, floor, room, or facility.
3. Describe the issue.
4. Set priority.
5. Add images and attachments.
6. Link to an inspection finding where applicable.
7. Approve the complaint.
8. Generate the formal maintenance document.
9. Record sending date and recipient.
10. Track the response.
11. Record maintenance visit.
12. Record action taken.
13. Record whether the issue was fixed.
14. Close with a final resolution.

## Recommended statuses

* مسودة
* معتمد
* تم الإرسال
* تحت المعالجة
* تم الإصلاح
* لم يتم الإصلاح
* مغلق

## Closure rule

A complaint may be closed with either:

* **تم الإصلاح**
* **لم يتم الإصلاح**

If closed as **لم يتم الإصلاح**, require:

* Closure reason.
* Follow-up recommendation.
* Whether escalation or a new complaint is required.

## Generated complaint document

The formal document must contain:

* Document reference number.
* Date in Hijri and Gregorian.
* School name.
* Principal name and title.
* Maintenance company or responsible party.
* Building, floor, room, and facility.
* Issue description.
* Priority.
* Requested action.
* Photographs, where appropriate.
* Attachments list.
* Contact information.
* Signature area.
* Follow-up section.
* Final resolution section.

---

# 19. "Send note" button

The **إرسال ملاحظة** button must not consume a large area or obstruct page content.

## Required placement

* Place it as a small persistent action in the top application header.
* Prefer an icon with a tooltip and accessible Arabic label.
* It may open a small modal or drawer.
* It must not overlap navigation, sketch controls, tables, or mobile content.
* It should remain available globally.
* On mobile, place it inside the header actions or overflow menu.

Do not place a large floating button over operational content.

---

# 20. Program assignment cards for executers

Create downloadable program cards that can be delivered to the assigned executer, such as a teacher or employee.

## Card content

* Program name.
* Program domain.
* Purpose.
* Description.
* Assigned executer.
* Supporting participants.
* Planned start date.
* Planned end date.
* Target group.
* Required activities.
* Expected outputs.
* Expected evidence.
* Available resources.
* Budget information, where applicable.
* Responsibilities.
* Follow-up method.
* Submission instructions.
* Principal notes.
* Acknowledgement or signature area.
* Program reference number.
* QR code or internal reference link, if useful and available offline.

## Actions

* Preview.
* Generate PDF.
* Generate Word.
* Print.
* Download.
* Record that the card was issued.
* Preserve the issued snapshot.

---

# 21. Scrolling and interface usability

Perform a system-wide scrolling review.

## Required checks

* No nested scroll containers unless strictly necessary.
* Sticky headers must not cover page titles or controls.
* Tables should have controlled horizontal scrolling on small screens.
* Dialogues must scroll internally without moving inaccessible buttons off-screen.
* Preserve scroll position when returning from a record.
* Avoid sudden page jumps after save.
* Avoid full-page resets after filtering.
* Long forms should use clear sections.
* Provide sticky save actions only where they do not obstruct fields.
* Improve mobile touch targets.
* Verify RTL scroll direction.
* Verify keyboard navigation.
* Verify zoom at 100%, 125%, and 150%.

---

# 22. Reports centre restructuring

The report centre should clearly separate:

* Programs.
* Performance.
* Employees.
* Finance.
* Evidence.
* Committees and councils.
* Building and facilities.
* Inspection and readiness.
* Maintenance complaints.
* Risks and SWOT.
* Documents and audit.

Each report entry should provide:

* Report description.
* Available filters.
* Preview.
* Generate.
* Download.
* Last generation date.
* Recently issued versions.
* Template settings where authorized.

Avoid links that simply open a normal application page without providing report-generation capability.

---

# 23. Data abstraction and monitoring principles

Dashboards and reports should prioritize:

1. What requires attention?
2. Why does it require attention?
3. Which records are affected?
4. What action should the principal take?
5. When is the action due?

Avoid presenting numbers without context.

Every warning, metric, or insight should allow the principal to reach the supporting records.

---

# 24. Testing requirements

## Automated tests

Add or update tests covering:

* Hijri and Gregorian date selection.
* Date conversion.
* Ambiguous-date prevention.
* Principal upload auto-acceptance.
* Non-principal upload approval.
* Finance card calculations.
* Finance drill-down reconciliation.
* PDF generation.
* Word generation.
* Excel generation where supported.
* Template versioning.
* Immutable issued documents.
* Employee KPI details.
* Overall KPI weakness calculations.
* Rules-based insights.
* Room-type template versioning.
* Inspection execution.
* Readiness calculation.
* Maintenance complaint generation.
* Fixed and not-fixed closure paths.
* Program card generation.
* Dashboard drill-down.
* Scrolling and sticky-header regressions.
* Removal of AI dependencies.
* Existing authorization coverage.
* Existing building-sketch behaviour.
* Existing program lifecycle.

## Production-clone rehearsal

Before deployment:

* Restore the latest production backup into an isolated clone.
* Run all migrations.
* Confirm exactly the expected migrations are pending.
* Compare critical table counts.
* Compare historical-document fingerprints.
* Verify no existing records were rewritten.
* Verify new fields have safe defaults.
* Generate representative reports.
* Exercise inspection and maintenance workflows.
* Exercise employee KPI reporting.
* Destroy the clone and temporary dumps after verification.

---

# 25. Delivery sequencing

## Phase A — Architecture and inventory

* Map current date fields.
* Map report routes.
* Map templates.
* Map performance functionality.
* Map inspection and maintenance workflows.
* Map AI dependencies.
* Map all occurrences of old terminology.

## Phase B — Data and domain changes

* Date-input architecture.
* Principal auto-acceptance.
* Finance-detail corrections.
* Inspection-template versioning.
* Maintenance complaint lifecycle.
* Required audit entries.

## Phase C — Reports and templates

* Report-generation engine.
* Complete default templates.
* Employee KPI reports.
* Overall KPI analytics.
* Program assignment cards.
* Ministry-aligned document design.

## Phase D — Interface improvements

* Dashboard redesign.
* Building-sketch resizing.
* Scrolling corrections.
* Workflow tutorials.
* Global note button.
* Report-centre restructuring.

## Phase E — Simplification

* Remove unused performance functions.
* Remove AI runtime functionality.
* Remove unused dependencies and environment configuration.
* Confirm application remains fully functional without Ollama.

## Phase F — Verification and controlled deployment

* Typecheck.
* Lint.
* Unit tests.
* Integration tests.
* End-to-end tests.
* Production-clone rehearsal.
* Backup and restore verification.
* Controlled Mac mini deployment.
* Principal acceptance testing.

---

# 26. Stop conditions

Stop deployment immediately if:

* A migration collision is detected.
* More migrations are pending than expected.
* Production and clone migration histories differ unexpectedly.
* Existing counts or fingerprints change without an approved reason.
* Historical issued documents are modified.
* Finance totals no longer reconcile.
* A report exposes unauthorized employee data.
* Principal uploads fail or bypass security validation.
* The application still requires Ollama for normal operation.
* PostgreSQL becomes publicly accessible.
* `seed.ts` is invoked.
* Rollback cannot be demonstrated.

---

# 27. Required final delivery evidence

Provide:

* Final commit IDs.
* Migration list.
* Database schema change summary.
* Removed AI dependency list.
* Test totals.
* Authorization coverage results.
* Report-generation samples.
* Default-template inventory.
* Production-clone rehearsal results.
* Backup checksum.
* Restore-verification result.
* Deployed image tag and digest.
* Before-and-after screenshots for major UI changes.
* Known limitations.
* Principal retest checklist.

Expected technical verdict before principal testing:

**V2.3.0 DEPLOYED — READY FOR PRINCIPAL ACCEPTANCE TESTING**

Do not create the final release tag or final gold backup until the principal explicitly accepts the release.
