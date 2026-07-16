# خريطة البيانات — Reference File Data Mapping

Every reference file in `reference_files/` (git-ignored), what was extracted, and where it lands in the system.

## 1. `الخطة_التشغيلية_المتكاملة_لمجمع_الخشعة_1448_1449.xlsx` ✅ present — PRIMARY plan source
25 sheets. Import-relevant:

| Sheet | Header row | Content | Target |
|---|---|---|---|
| `الخطة التشغيلية` | 3 | **26 programs** — columns: م، المجال، الهدف العام، الهدف الخاص، البرنامج أو المبادرة، مبررات التنفيذ، الفئة المستهدفة، آلية التنفيذ، فترة التنفيذ، مسؤول التنفيذ، المشاركون، مؤشر النجاح، المستهدف وشرحه، المخرج المطلوب، الشواهد، متابعة التنفيذ، علاقته بالتقويم الخارجي، الأثر المتوقع، الميزانية، ملاحظات المدير | `programs` |
| `تفاصيل البرامج التنفيذية` | 3 | Same 26 + خط الأساس، المستهدف، المؤشر، الأولوية، الميزانية التقديرية، مرحلة التنفيذ، **تاريخ البدء/الانتهاء (هجري)**، **المعالم ونقاط القياس**، فترات التوقف | `programs` (merge), `program_milestones` |
| `سجل المخرجات والشواهد` | 2 | 26 rows: المخرج المطلوب، الشواهد المقبولة، مسؤولا الإعداد والحفظ، موعد التسليم 5/1/1449هـ، مكان الحفظ، حالة الجاهزية | `program_deliverables` |
| `مؤشرات الأداء` | 2 | 15 indicators: مؤشر-01…، خط أساس، مستهدف، دورية، مالك، مصدر، اتجاه، مواعيد قياس | `program_kpis` |
| `سجل المخاطر` | 2 | 10 risks: خطر-01…، احتمالية، أثر، تصنيف، معالجة، مالك | `program_risks` |
| `الميزانية` | 2 | 8 items, school-funded amounts | `plan_budget_items` |
| `التقويم الدراسي 1448-1449` | 2 | **16 official events** with Hijri from/to + Gregorian, incl. عودة الهيئة الإدارية 1448/3/2=2026/8/16, **عودة المعلمين 1448/3/10=2026/8/23** (teacher-cycle anchor), بداية الدراسة 1448/3/17=2026/8/30, نهاية الخطة **1449/1/5**. **Revalidated 2026-07-16 against the source row**: sheet «التقويم الدراسي الرسمي 1448/1449هـ», row 6 = «عودة المعلمين الممارسين للتدريس — الأحد — 1448/3/10 — 2026/8/23», identical in this workbook and in `الخطة_التشغيلية_الرسمية_...xlsx`; 2026-08-23 is indeed a Sunday. The derived workbook `..._مرتبطة_بالتقويم_...` shows different prep dates (عودة المعلمين والمعلمات 1448/3/3) — it is a planning map, not the official sheet, and is not adopted (see `docs/PERFORMANCE_MODEL_VALIDATION.md` §6) | `calendars`, `calendar_events` |
| `خارطة التنفيذ السنوية` | 2 | 26 programs × 10 period-phase matrix (إعداد/تشغيل/متابعة/مراجعة/تكثيف/إغلاق/توقف) | `program_roadmap_cells` |
| Analysis sheets (نافس، القدرات والتحصيلي، الفجوات، الرباعي، الرؤية...) | — | context; not imported in first release | — |

**Domain distribution (verified):** الإدارة المدرسية 7، التعليم والتعلم 6، نواتج التعلم 8، البيئة المدرسية 5 = 26.
**Rule:** all official values stored verbatim; end date 5/1/1449هـ never altered.

## 2. `سجل_مخرجات_وشواهد_مجمع_الخشعة_1448_1449.xlsx` ✅ present
| Sheet | Content | Target |
|---|---|---|
| `مصفوفة مخرجات البرامج` | 26 rows: نوع المخرج، المخرج الرئيس/المساند، الشاهد الخارجي المتوقع، الشواهد الأساسية، حزمة-01… , الحد الأدنى للحزمة (شاهد تنفيذ + مخرج + أثر + خارجي عند الانطباق) | `program_deliverables`, evidence-package rules |
| `سجل الشواهد` | empty register (300 template rows), 20 columns incl. دور الشاهد، نوع الشاهد، حالة المراجعة | schema for `evidence_items` + program links |
| `الشواهد الخارجية` | empty register (100 rows), 13 columns | external-evidence fields on `evidence_items` |
| `متابعة جاهزية البرامج` | 26 rows readiness counters + نسبة الجاهزية + قرار المدير | readiness computation logic (computed live, not imported) |
| `القوائم المرجعية` | value lists: مصدر الشاهد (المدرسة/خارجي…)، دور الشاهد (خط أساس/تنفيذ/مخرج/أثر/خارجي)، نوع الشاهد، أصل الشاهد (ورقي/رقمي)، حالة المراجعة، قرار الحزمة | enums/lookup seeds |
| `لوحة المتابعة` | dashboard formulas (26 programs, approved packages, evidence totals) | dashboard logic |

## 3. `حزمة_نماذج_مخرجات_وشواهد_مجمع_الخشعة_1448_1449.docx` ✅ present
Visual reference for internal document templates (minutes, follow-up records...). Attendance/absence forms are **not** implemented (excluded by prompt).

## 4. `الدليل الارشادي لادارة الاداء الوظيفي.pdf` ✅ present (delivered 2026-07-16) — visually inspected (68 pages)
«الدليل الإرشادي لإدارة الأداء الوظيفي لشاغلي الوظائف التعليمية — الإصدار الثاني». Used as **cross-check only** (no content imported): rating-scale names (5 مثالي … 1 غير مرضي, p.6/62), performance-cycle stages (pp.8–13), the in-school calculation mechanism «ضرب التقدير (1-5) في الوزن النسبي ثم الجمع، والاحتساب إلكتروني» (p.62), self-evaluation never counted (p.3), special cases (p.65). Model tables pp.14–45 matched against the models PDF — 3 weight cells differ and are **documented, not adopted** (guide totals would be 110%; see D-014 + `docs/PERFORMANCE_MODEL_VALIDATION.md` §3).

## 5. `نماذج تقيم اداء شاغلي الوظائف التعليمية1.pdf` ✅ present (delivered 2026-07-16) — visually inspected page-by-page (46 pages)
«نماذج تقييم أداء شاغلي الوظائف التعليمية — الإصدار الأول» — **the authoritative source of the 8 official models** (printed pp.4–11, داخل نطاق المدرسة). Transcribed verbatim into `src/db/seed-data/performance-models-official.ts`, seeded by `seedOfficialPerfModels()` as `official=true`, status «معتمد» (locked from normal editing), every model totals exactly 100%. The 9th form (التشكيلات الإشرافية, printed pp.12–13) is outside school scope and deliberately not entered. Calculation mechanism + overall levels (5=90–100% … 1=<60%) from printed p.45 match `src/lib/performance/scoring.ts`. Full page map and verification log: `docs/PERFORMANCE_MODEL_VALIDATION.md`. Pinned by `tests/integration/official-models.test.ts`.

## 6. `بيانات الموظفين في فارس.xlsx` ✅ present (delivered 2026-07-16) — parsed through the safe-import pipeline (preview only)
Single sheet «بيانات الموظفين في فارس», **52 rows detected**. Preview batch created via `npm run fares:preview` (mirrors `/imports` upload path; status «معاينة» — **commit deliberately left to the principal** in `/imports`). Detected sensitive columns excluded by default and never stored: الهوية الوطنية، تاريخ الميلاد، رقم الجوال، هوية المدير المباشر. Suggested classification: **42 معلم / 10 موظف**; all 10 non-teaching rows flagged «يحتاج مراجعة» (unconfirmed classification — مساعد إداري/عامل/حارس أمن/مراسل/مدخل بيانات). All 42 teachers suggested model `teacher`; no مدير/وكيل/موجه rows exist in the file, so any leadership model assignment is a manual principal decision. Detailed per-row review (names included) written **outside Git** to `storage/private/fares-import-preview.md`. Real-file tests (row count, minimization, editable classification) run when the file is present: `tests/integration/official-models.test.ts`.

## 7. `اللجان الرسمية 47.pdf` ✅ present — visually inspected (7 pages)
Formation decision (منح الصلاحية بقرار وزير التعليم رقم 37617168 بتاريخ 1437/4/1؛ العمل من 1447/2/1؛ التكليف عام دراسي) + **6 entities → committee templates** (positions/duties/recurrence only — 1447 member names are NOT copied):
1. **اللجنة الإدارية للمدرسة** — رئيس: المدير؛ 10 مقاعد؛ اجتماع شهري؛ 12 مهمة؛ الهدف: إقرار الخطة التشغيلية ومتابعة سير العملية التربوية.
2. **لجنة التوجيه والإرشاد** — رئيس: وكيل المدرسة؛ 7 مقاعد (مقرر: الموجه الطلابي)؛ شهري؛ 13 مهمة.
3. **لجنة التحصيل الدراسي** — رئيس: مدير المدرسة؛ نائب: الوكيل؛ 11 مقعداً؛ دوري كل فصل دراسي (لا يقل عن اجتماعين)؛ 18 مهمة.
4. **لجنة التميز والجودة** — رئيس: المدير؛ 13 مقعداً؛ شهري؛ 14 مهمة.
5. **فريق الصندوق المدرسي** (يرتبط باللجنة الإدارية) — رئيس: الوكيل؛ 5 مقاعد؛ شهري؛ 9 مهام.
6. **فريق الأمن والسلامة** — رئيس: وكيل المدرسة؛ 8 مقاعد؛ مرة كل فصل دراسي على الأقل؛ 13 مهمة.

## 8. `مخطط المبنى.pptx` ✅ present — 4 slides = 4 floors
Raster architectural plans (image1-4.jpg, «نموذج ٢٩/٢٣», 39 rooms / 29 classrooms) + editable text-box overlays with current functional names and dimensions (meters):
- **الأرضي:** المستودع، غرفة الاجتماعات، مكتب الاداريين، غرفة البدنية (5×7 each)، فصول 5×7/5×5، حمام 2×2، 1.2×2؛ مدخل رئيسي، مكتب مدير المدرسة، معمل العلوم، معمل الحاسب، دورات مياه، سلم 1/2، ممر توزيع، مخارج طوارئ (من الصورة).
- **الأول:** قاعة اللغة العربية، 2ث1، 2ث2، 3ث1، 3ث2، معمل الصحة، وكيل الشؤون التعليمية، خدمات 3×3، غرفة معلمين، 5×5.
- **الثاني:** خدمات 3×3، غرفة معلمين، التوجيه الطلابي، 1ث1، 1ث2، 2م1، 1م2، 3م، النشاط الطلابي، متعددة الأغراض.
- **الثالث:** غرفة معلمين، خدمات 3×3، معمل علوم ابتدائي، 4ب، 5ب، 6ب، وكيل شؤون الطلاب، معمل حاسب 2، معمل الانجليزي، 1م1.
→ Manually traced polygons in `floor_geometry_versions`; source raster imported to private storage as toggleable background; side-by-side comparison before approval (Phase 4).

## 9. `أبو فهد_041337.pdf` ✅ present — visually inspected
Annotated aerial photo of the **boys complex**: football field **26م × 18م** (calibration reference), structures 9م/6م/11م/4م/3.5م، 5م/6م، 4م/4م، 3.5م/2م. → external-site geometry + replaceable aerial background. Girls complex (northern) shown faded, context only.

## 10. `WhatsApp Image 2026-07-15 at 9.23.26 PM.jpeg` ✅ — principal signature → `storage/private/branding/signature.jpeg` at seed; never Git.
## 11. `WhatsApp Image 2026-07-15 at 9.23.25 PM.jpeg` ✅ — school stamp → `storage/private/branding/stamp.jpeg` at seed; never Git.
## 12. `Pasted markdown.md` ❌ absent — workflow reference only; its claims were to be ignored anyway.

## Extra files present but unmapped by the prompt
See DECISIONS D-009 (earlier plan revisions + one unidentified image; not imported).
