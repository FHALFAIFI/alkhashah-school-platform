# Claude Code Master Build Prompt

You are the lead engineer responsible for building a production-quality web application from scratch named:

**Integrated School Administration Platform**  
Arabic product name: **منصة الإدارة المدرسية المتكاملة**

The customer is **Al-Khashah Educational Complex for Boys** in Saudi Arabia. The entire user-facing application must be Arabic and right-to-left. The primary user is the school principal. An additional system administrator account is required. Do not create teacher, employee, or coordinator accounts in the first release, but design flexible role-based permissions so those accounts can be added later.

## Critical instructions

- Start from scratch. There is no existing application that must be preserved.
- `reference_files/Pasted markdown.md` may claim that an older application already exists or is complete. Ignore those implementation/status claims. Use that file only as workflow reference when it does not conflict with this prompt.
- This prompt is the final source of truth.
- Do not guess unclear official names, indicators, weights, dates, inventory, geometry, or policy content.
- Do not expose English in the user interface. English is allowed only in source code, technical documentation, unavoidable filenames, and integration names.
- Do not build attendance, absence, meeting-attendance, or quorum features.
- Do not create individual student profiles now.
- Never upload or send school data outside the device without explicit user consent for that specific action.
- Never commit employee data, signatures, stamps, secrets, backups, or real attachments to Git.
- The application must work completely without AI and without public internet access.

## Product goal

Build one integrated application containing four connected modules:

1. Employee and teacher performance management.
2. Operational plan, deliverables, and evidence management.
3. Councils, committees, and professional learning communities.
4. Digital twin of the school building, inventory, inspection, readiness, and maintenance.

All modules share people, calendars, tasks, evidence, attachments, documents, reports, approvals, notifications, archive, imports, and audit history.

---

# 1. Mandatory autonomous working protocol

Before coding:

1. Inspect the machine, repository, and every file in `reference_files/`.
2. Create and maintain:
   - `docs/REQUIREMENTS_AR.md`
   - `docs/DECISIONS.md`
   - `docs/DATA_MAPPING.md`
   - `docs/ACCEPTANCE_TESTS.md`
   - `docs/SECURITY_AND_BACKUP.md`
   - `PROGRESS.md`
3. Record the architecture, installed package versions, file-to-feature mapping, and the reason for any deviation from this prompt.
4. Initialize Git immediately and create a clear checkpoint commit after every completed phase.
5. Design migrations and imports to be repeatable and recoverable.
6. If power, the terminal, or the Claude session stops, resume by reading `PROGRESS.md`, `git status`, recent commits, migrations, and test results. Continue from the last safe checkpoint; do not restart.
7. Continue autonomously while quality gates pass. Do not stop for colors, spacing, component naming, or minor UI decisions. Choose a modern, formal, accessible Arabic design.
8. Stop only when one of these genuine blockers occurs:
   - unclear official content that would materially alter an official result;
   - a required source file is corrupt or unavailable;
   - a secret, account, API key, or user credential is required;
   - a new business decision would materially change scope;
   - a destructive action or irreversible external operation would be required.
9. Do not use destructive Git or filesystem commands.
10. After every phase, run formatting, lint, type checking, unit tests, integration tests, critical browser tests, migration checks, permissions tests, RTL checks, and print/report checks. Fix all failures before continuing.
11. Update `PROGRESS.md` after every substantial milestone so another session can resume safely.
12. Use clean production seed data. Put optional demonstration data in a clearly separate demo seed.

---

# 2. Recommended technical baseline

Use a maintainable modular monolith. The preferred baseline is:

- Next.js with TypeScript using pinned stable versions.
- PostgreSQL for development integration and production.
- A reliable ORM with transactional migrations and PostgreSQL support.
- Tailwind CSS and accessible components with real RTL support.
- Secure session authentication and extensible RBAC.
- Strong password hashing and optional TOTP two-factor authentication.
- Zod or an equivalent validation layer.
- Private local file storage behind a storage abstraction that can support S3 later.
- Canvas or SVG editing, such as Konva, for the interactive 2D building plan.
- Three.js or an equivalent library for a simple isometric 3D overview generated from the same geometry.
- PWA and IndexedDB for offline building inspections.
- Server-side Arabic PDF generation from controlled HTML, plus DOCX and XLSX exports.
- Docker Compose for the application and PostgreSQL.
- Unit, integration, and end-to-end tests with stable tools.

You may replace a specific library when there is a documented technical reason. Record the decision in `docs/DECISIONS.md`. Do not use SQLite as the production database. Do not create unnecessary microservices.

The first test machine is a Mac mini M2 with 8 GB RAM. The planned final host is Ubuntu Server. Keep local development resource usage reasonable.

---

# 3. Language, design, and accessibility

- Every visible label, button, validation message, notification, dashboard, form, table, report, Word export, and PDF must be Arabic and RTL.
- Product name shown to users: **منصة الإدارة المدرسية المتكاملة**.
- Use visible Arabic terms such as:
  - معلم
  - موظف
  - مؤشرات الأداء
  - شواهد
  - تقرير
  - اعتماد وإقفال
  - أرشفة
- Do not show KPI, Evidence, Report, Email, Educational, or Staff in normal UI.
- Use a modern, calm, formal design appropriate for the Saudi Ministry of Education, without copying another product.
- Support desktop and mobile layouts.
- Ensure keyboard navigation, clear focus states, field labels, contrast, readable error messages, and responsive tables.
- Verify Arabic line wrapping, mixed Arabic/Latin text, Hijri and Gregorian dates, and print output.
- Official PDF output should use A4 layout even if the application UI uses responsive web dimensions.

---

# 4. School structure and user roles

- One school complex for boys with Primary, Middle, and Secondary stages as subunits.
- People belong to the complex. Programs, committees, reports, and work items may target one or more stages.
- Initial accounts:
  - School Principal.
  - System Administrator.
- The administrator may see the entire system.
- The principal approves all business records.
- Individual performance details remain principal-only even after future roles are added.
- Prepare flexible roles and permission assignments, but do not create extra accounts now.
- Every important record begins as a draft and requires an explicit **Approve and Lock** action.
- Reopening an approved record requires a mandatory reason and must preserve the previous version and audit history.
- Bulk approval is allowed only when every prerequisite is satisfied.
- Date conflicts and holidays create warnings but do not block saving.

---

# 5. Shared platform services

## 5.1 People register

Visible categories:

- **معلم**: educational roles following the school academic calendar.
- **موظف**: non-teaching staff following the Gregorian year.

Employee Excel import rules:

- The current Fares file contains 52 records and must be reviewed before final classification.
- Current observed grouping is 42 educational-cadre records and 10 others, but do not silently trust that classification.
- Import by default only:
  - name;
  - job title;
  - cadre/rank;
  - employment status;
  - stage or organizational unit;
  - job number.
- Do not import by default:
  - national ID;
  - birth date;
  - direct manager national ID;
  - mobile number.
- Show preview, validation, duplicates, classification suggestions, and editable corrections before approval.
- Suggest the correct performance model from the job title, but require principal confirmation.
- Allow add, edit, and deactivate.
- Allow permanent deletion only when no records are linked; otherwise archive or deactivate.

## 5.2 Unified evidence and attachments

- The visible Arabic term is always **شواهد**.
- Upload an evidence item once and allow links to multiple modules and records.
- Do not allow deletion when linked to an approved record.
- Support images, PDF, Word, Excel, text, links, and other files.
- Reports must include meaningful evidence content, not filenames only:
  - embed images;
  - render PDF first page or selected pages;
  - extract readable Word text;
  - preview a safe limited area of the first Excel sheet;
  - display full text notes;
  - display links and descriptions without automatically fetching external content.
- When content is too long, display:
  **تم اختصار عرض الشاهد داخل التقرير، ويمكن الرجوع إلى الملف الأصلي.**
- Store attachments outside public web directories.
- Downloads must require authentication, authorization, safe path handling, and the original filename.

## 5.3 Unified tasks and actions

- One action/task register shared by all modules.
- A task may link to a program, committee, meeting, performance indicator, room, asset, inspection, or maintenance issue.
- Fields: title, description, owner, due date, priority, status, progress, attachments, and cross-links.
- Calculate overdue status automatically.
- A committee decision creates a mandatory action.
- A recommendation may create an optional action.

## 5.4 Calendars and dates

- Store business dates in Gregorian ISO format.
- Teacher screens show Hijri first and Gregorian below.
- Employee screens show Gregorian first and Hijri below.
- Use an Umm al-Qura-compatible Hijri display.
- Preserve official Hijri text when supplied by an approved Ministry calendar.
- Import the annual school calendar from Excel with preview and correction.
- Bind every historical performance cycle to the exact calendar snapshot used when created.
- Importing a new calendar must not recalculate old cycles.
- Holidays and date conflicts warn but do not block.

## 5.5 Documents, versions, and approvals

- Give every issued document a unique number and verification QR/code.
- Preserve a fixed issued snapshot and full version history.
- Record author, changes, reason, approval, reopening, and timestamps.
- Provide editable internal templates.
- Do not promise arbitrary Word files can automatically become official templates.
- Support configurable retention rules by record type.
- Export official PDF, editable Word, analytical Excel, and full-system backup/restore packages.

## 5.6 Signature and stamp

- Principal signature and school stamp are independent options.
- Provide global defaults and per-document overrides.
- Employee/teacher signature remains manual.
- Store signature and stamp privately, never in Git.
- The first release relies on private paths, Ubuntu permissions, authentication, and Tailscale rather than application-level attachment encryption.
- Restrict and audit signature/stamp use.

## 5.7 Email and notifications

- Provide in-app notifications and optional email workflow.
- Preferred workflow: use Microsoft 365 integration to create a draft with Arabic subject/body and attached PDF, then open it for the principal to review and send.
- Do not automatically send the final email.
- Fallback: download the PDF and open a draft email, clearly telling the user when attachment must be manual.
- The Fares file has no email column; allow emails to be added later manually or by import.

## 5.8 Reports

- One unified Reports section plus contextual reports inside every module.
- Monthly, school-term, and annual executive reports.
- Combined executive report across all modules.
- The principal may include detailed individual performance in executive reports; no other role may see it.
- Support PDF, Word, Excel, printing, and verification code.

---

# 6. Performance management module

## 6.1 Teacher cycle

- Based on the official school academic calendar.
- Begins on the **Teacher Return** event, not student start or supervisor return.
- Mandatory stages:
  - performance planning once;
  - mid-year review once;
  - final evaluation once.
- Unlimited classroom visits.
- Default annual follow-up target: five, configurable.
- A classroom visit before student study starts creates a warning only.

## 6.2 Employee cycle

- Runs from January 1 through December 31.
- The principal configures planning, mid-cycle, and final deadlines each year.
- Keep teacher and employee cycles separate while showing them in a unified management dashboard.

## 6.3 Official performance models

- Use the eight official educational-role models in the uploaded PDF.
- Visually inspect the PDF page by page because Arabic text extraction may be corrupted.
- Do not change official model names, indicator names, weights, keys, or totals.
- Every model must total 100%.
- Keep the school-principal model for possible future use, but do not let the principal self-evaluate.
- For non-teaching employees, create a flexible performance-form designer.
- A staff model remains a draft until the principal approves it.
- Suggest model assignment from job title and require confirmation.

## 6.4 Sessions and scoring

Every session contains:

- stage/type and date;
- every indicator from the selected model, always visible;
- rating, weight, and calculated result;
- notes, strengths, improvement opportunities, and actions;
- evidence linked to indicators;
- next follow-up date;
- coverage and session result.

Rules:

- Non-final sessions may be incomplete drafts.
- Final evaluation cannot lock until all indicators and required evidence are complete.
- Formula: `weighted score = (rating / 5) * indicator weight`.
- Never allow manual percentage override.
- A session report uses that session's ratings.
- Cycle progress uses the latest rating for each indicator.
- Final annual report uses final-evaluation ratings only.
- Improvement plans are a manual principal decision. The system may suggest one for weak ratings but must not force it.

## 6.5 Reports

- Every completed session requires a report record.
- The business record cannot be fully completed until the signed report is uploaded.
- Include all indicators, ratings, weights, results, notes, improvement information, and evidence previews.
- Include principal signature, teacher/employee signature, and date fields.
- Principal signature and stamp are independently optional.
- Reopening requires a reason and preserves the previous complete version.

---

# 7. Operational plan and evidence module

- Import the operational plan from the supplied workbook.
- The current plan contains 26 programs across four domains.
- The source sets the programs' end date to 5/1/1449 Hijri.
- Never silently alter official source values.

Each program includes:

- domain, objective, rationale;
- targeted stage(s);
- owner as both position and current person;
- start and end dates;
- weighted milestones;
- required deliverables;
- required evidence types;
- KPI/measurement and target;
- risks and budget when present;
- quantitative, qualitative, or mixed impact measurement.

Rules:

- Calculate progress from weighted milestones, not attachment count.
- Update progress from actual work and perform a monthly review.
- Show readiness for every deliverable and evidence requirement.
- Reuse a unified evidence record across modules.
- Changes to approved programs require a change request containing old value, new value, reason, approval, and version history.
- Principal approves the complete program package; individual attachment approval is not required.
- Close and archive the year as read-only.
- Use the supplied evidence workbook and Word template package as references.
- Do not activate attendance/absence templates.

---

# 8. Councils, committees, and learning communities

- Convert the six entities in the 1447 committee PDF into reusable templates.
- Do not copy old members into the new year.
- Members must be school employees only; no external members.
- Record membership at formation. Do not record meeting attendance or absence.
- Do not implement quorum.
- A meeting contains agenda, discussion, and outcomes.
- Outcome types: decision, recommendation, note.
- A decision creates a mandatory action; a recommendation may create an optional action.
- A signed meeting record is required before completion.
- Only the chair and secretary sign the minutes.
- The principal approves formations, minutes, and closures.
- Recurrence is configurable per entity: weekly, monthly, school-term, on demand, or none.
- Professional learning communities use a lighter model with name, leader, members, objectives, meetings, outputs, and evidence.
- Recreate committees annually from templates and archive previous years.

---

# 9. Digital twin, inventory, inspection, and maintenance

## 9.1 Site scope

- Coordinates: `17.2484051, 43.0609594`.
- The satellite location contains boys and girls facilities.
- The lower/southern building is the boys complex and is the managed target.
- The upper/northern building is the girls complex. Show it faded as geographic context only, with no rooms, assets, inspections, or records.
- Suggest an initial boys-complex boundary from visible fences and let the principal correct it.
- Use a replaceable local aerial background.
- Let the user move, scale, rotate, hide, show, and replace the background without changing vector geometry.
- Do not scrape Google imagery. A live Google layer is a future optional integration through an authorized API with required attribution.

## 9.2 Building plan sources

- `مخطط المبنى.pptx` contains Ground, First, Second, and Third floors.
- The underlying floor plans are raster images, while some names/dimensions are editable text boxes.
- Manually trace rooms and walls into editable SVG/Canvas polygons.
- Compare every traced floor side-by-side with the source before approving it.
- `أبو فهد_041337.pdf` contains the external site and reference dimensions.
- Initially calibrate the external plan using the 26 m by 18 m football field.
- Display measurements to one decimal place.
- Clearly label the plan as operational, not an engineering-certified drawing.

## 9.3 Plan editor

The editor must support:

- editing room/facility name and type;
- editing length and width in meters;
- two-way binding: entering a dimension changes geometry, and dragging geometry updates dimensions;
- moving, resizing, drawing, adding, and deleting rooms;
- basic doors and facilities;
- automatic area and perimeter;
- undo/redo;
- draft and publish workflow;
- full geometry version history;
- source-background toggle;
- editable suggested facility names;
- accurate 2D operational view;
- simple isometric 3D generated from the same stored geometry.

## 9.4 Inventory and QR

- Start with an empty inventory. Do not invent assets.
- Provide manual entry, an Excel template, preview import, validation, and import rollback.
- Important assets are individual records with serial number, condition, location, and maintenance history.
- Repeated furniture is stored by quantity and condition.
- Generate a unique asset code and QR automatically, with a configurable prefix such as `KHS-AST-0001`.
- Every room has a QR. Important assets may also have QR codes.
- Include rooms, yards, gates, emergency exits, safety elements, water, electricity, network, and external facilities.

## 9.5 Inspection, readiness, and maintenance

- Provide starter inspection templates by room type.
- Templates remain drafts until principal approval.
- Support recurring and ad-hoc inspections and reminders.
- Calculate readiness from checklist results, required assets, and open issues.
- Allow readiness override only with a mandatory recorded reason.
- Simple maintenance workflow only: issue, priority, status, photos, owner, repair, closure, and verification.
- No vendor portal, invoices, procurement, or maintenance costing.
- PWA offline mode supports building inspection, photos, and issue capture only.
- Queue changes in IndexedDB and synchronize safely when the connection returns.
- Approvals and official reports require an online connection.

---

# 10. Optional local AI

- All AI features are disabled by default.
- The current Mac already has AnythingLLM and Ollama.
- Build a provider adapter supporting Ollama and AnythingLLM locally.
- Claude API may be an optional external fallback later.
- Require explicit confirmation before sending any attachment or content to an external AI provider.
- Arabic OCR runs on demand and always requires human review before saving extracted fields.
- Suggested AI functions:
  - meeting summaries;
  - draft decisions and actions;
  - evidence completeness review;
  - performance summaries without changing ratings;
  - field extraction from documents;
  - draft executive reports;
  - local retrieval over guides and templates with source references.
- AI must never approve, lock, rate, delete, or silently change official records.

---

# 11. Security, hosting, and backups

- First test deployment: current Mac mini M2, 8 GB.
- Final planned deployment: Ubuntu Server.
- Access through Tailscale and strong passwords.
- Support optional TOTP and recovery codes.
- Do not expose the application to the public internet in the first release.
- If public hosting is later selected, require a separate security review before enabling it.
- Use private attachment paths, host filesystem permissions, authenticated routes, and Tailscale.
- Do not add application-level attachment encryption in the first release, per the approved decision.
- Always encrypt backups.
- Daily database backup.
- Weekly complete encrypted backup containing database, attachments, and required configuration.
- Keep at least one backup copy off the host device.
- Implement configurable retention.
- Perform a real restore rehearsal before release.
- Audit login, approval, reopening, sensitive downloads, administrative changes, and signature/stamp use.
- Protect against CSRF, XSS, SQL injection, path traversal, unsafe uploads, broken authorization, and abuse/rate spikes.
- Never place credentials in source control.

---

# 12. Safe imports and annual rollover

Every import must have this workflow:

1. Upload source.
2. Create an import batch.
3. Parse without writing business records.
4. Show preview.
5. Validate fields, types, dates, duplicates, and conflicts.
6. Mark ready rows and rows needing review.
7. Let the principal correct mappings and values.
8. Require explicit approval.
9. Commit in a transaction.
10. Preserve source summary and error log.
11. Allow complete batch rollback when safe.

Annual rollover:

- People, rooms, generic templates, and inspection templates persist.
- Programs, cycles, committees, meetings, inspections, and reports receive new annual records.
- Committees are recreated from templates without old memberships.
- Closed years are read-only.
- Historical calculations and documents remain tied to their original calendar, model, and issued snapshot.

---

# 13. Reference files and handling rules

Create a precise mapping in `docs/DATA_MAPPING.md` for these files:

1. `الخطة_التشغيلية_المتكاملة_لمجمع_الخشعة_1448_1449.xlsx`
   - Source for 26 operational programs, domains, measurements, risks, calendar, and roadmap.

2. `سجل_مخرجات_وشواهد_مجمع_الخشعة_1448_1449.xlsx`
   - Source for deliverable matrix, evidence register, readiness, and dashboard logic.

3. `حزمة_نماذج_مخرجات_وشواهد_مجمع_الخشعة_1448_1449.docx`
   - Visual reference for internal templates. Do not implement attendance/absence forms.

4. `الدليل الارشادي لادارة الاداء الوظيفي.pdf`
   - Official performance guidance. Review visually if Arabic extraction is corrupted.

5. `نماذج تقيم اداء شاغلي الوظائف التعليمية1.pdf`
   - Source for eight official performance models. Verify indicators and weights visually.

6. `بيانات الموظفين في فارس.xlsx`
   - Employee source. Apply data minimization and preview review. Never copy into Git fixtures.

7. `اللجان الرسمية 47.pdf`
   - Source for six committee templates. Do not copy 1447 membership.

8. `مخطط المبنى.pptx`
   - Source for four floors, names, and dimensions. Raster backgrounds require manual tracing.

9. `أبو فهد_041337.pdf`
   - External site, aerial background, and reference measurements.

10. `WhatsApp Image 2026-07-15 at 9.23.26 PM.jpeg`
    - Principal signature. Sensitive; import into private runtime storage only.

11. `WhatsApp Image 2026-07-15 at 9.23.25 PM.jpeg`
    - School stamp. Sensitive; import into private runtime storage only.

12. `Pasted markdown.md`
    - Workflow reference only. Ignore claims that old code/app work is complete.

Rules:

- Never modify original reference files.
- Keep originals outside Git or in an ignored local directory.
- Create anonymized synthetic fixtures for automated tests.
- When PDF Arabic extraction is unreliable, render pages and inspect visually.
- Do not invent unclear official values.
- Do not invent external inventory, staff performance models, or unprovided emails.

---

# 14. Build phases and acceptance gates

## Phase 0: Discovery and foundation plan

- Inspect environment and all reference files.
- Create required documentation.
- Select and pin the stack.
- Design data model, migrations, storage abstraction, RBAC, audit model, and import framework.
- Create project skeleton, Git repository, Docker setup, and test framework.

Do not remain in planning indefinitely. Proceed directly into Phase 1 when the plan is documented and tests can run.

## Phase 1: Shared foundation and operational plan

Deliver:

- application shell and Arabic RTL design system;
- authentication and initial roles;
- school and stages;
- dual calendars and date display;
- people register and safe import;
- private files, evidence, tasks, approvals, notifications, and audit;
- operational-plan import, 26 programs, milestones, deliverables, progress, evidence, change requests, and reports.

Acceptance gate:

- Principal can preview/import data, operate a program, link deliverables and evidence, calculate progress, issue a report, and approve the package.
- No English appears in critical user flows.

## Phase 2: Councils, committees, and learning communities

Deliver templates, formation, meetings, minutes, outcomes, actions, recurrence, reminders, learning communities, reports, and annual archive.

Acceptance gate:

- A meeting cannot complete without signed minutes.
- A decision creates a mandatory action.
- No attendance, absence, or quorum features exist.

## Phase 3: Performance management

Deliver visually verified official models, teacher and employee cycles, sessions, visits, calculations, evidence, improvement plans, signed reports, reopening/versioning, and staff-model designer.

Acceptance gate:

- Calculations match official weights.
- Manual percentage override is impossible.
- Final evaluation cannot lock before indicators, evidence, and signed report requirements are met.

## Phase 4: Digital twin

Deliver four-floor and external-site tracing, editable dimensions/names/geometry, background calibration and versions, 2D and simple 3D, rooms, inventory, QR, inspection, readiness, maintenance, and offline PWA inspection.

Acceptance gate:

- Principal can edit a name and dimension in both directions, save/publish geometry, scan QR, perform an offline inspection, and synchronize without data loss.
- Replacing the aerial image does not alter geometry.
- The girls facility cannot receive managed rooms/assets/records.

## Phase 5: AI, integrations, deployment, and recovery

Deliver disabled-by-default AI adapters, OCR approval flow, optional Microsoft 365 draft integration, Docker/Ubuntu/Tailscale deployment guides, backup/restore automation, security checks, and Arabic operator documentation.

Acceptance gate:

- The full system works with AI and all external integrations disabled.
- Each optional integration can be enabled independently without exposing secrets.
- A real test backup can be restored successfully.

---

# 15. Non-negotiable automated or documented acceptance tests

Prove the following:

- No English appears in critical user workflows.
- A future role cannot access individual performance without explicit permission.
- A performance session cannot fully complete without its signed report.
- Calculated percentages cannot be manually changed.
- A meeting cannot complete without signed minutes.
- A decision creates a mandatory action.
- Evidence linked to an approved record cannot be deleted.
- The 52-person import can be previewed and reviewed without importing national ID, birth date, or mobile number by default.
- The operational plan imports without silently changing official source values.
- A test import batch can be rolled back.
- A room name and measurement can be edited bidirectionally and saved in a geometry version.
- Replacing the aerial background preserves vector geometry.
- Offline PWA inspection synchronizes once without duplication.
- Managed rooms/assets cannot be added to the girls-complex context area.
- Backup and restoration work in a test environment.
- The complete application works with AI disabled.
- Arabic reports render correctly in PDF and Word.
- Authorization checks exist on every private download and approval endpoint.

---

# 16. Required final deliverables

The first release is complete only when it includes:

- documented, version-pinned source code;
- Docker Compose and an example environment file without secrets;
- tested migrations;
- clean production seed and separate demo seed;
- Mac installation guide;
- Ubuntu Server and Tailscale deployment guide;
- tested backup and restore guide;
- Arabic principal and administrator guide;
- data mapping for every reference file;
- automated test suite and recorded test results;
- basic security review report;
- known limitations and deferred features list.

Clearly defer:

- additional user accounts and coordinators;
- individual student module;
- live Google Maps layer;
- vendor/procurement portal;
- electronic employee signature;
- public internet hosting.

## Begin now

Start with Phase 0 immediately: inspect the environment and reference files, create the required documentation, propose the database schema and migration plan, initialize the repository and test framework, and then continue directly into Phase 1.

Do not ask for confirmation again unless a genuine blocker from the mandatory stop conditions occurs. Keep working through the phases, tests, documentation, and Git checkpoints autonomously.
