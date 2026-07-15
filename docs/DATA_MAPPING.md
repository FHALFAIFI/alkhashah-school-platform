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
| `التقويم الدراسي 1448-1449` | 2 | **16 official events** with Hijri from/to + Gregorian, incl. عودة الهيئة الإدارية 1448/3/2=2026/8/16, **عودة المعلمين 1448/3/10=2026/8/23** (teacher-cycle anchor), بداية الدراسة 1448/3/17=2026/8/30, نهاية الخطة **1449/1/5** | `calendars`, `calendar_events` |
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

## 4. `الدليل الارشادي لادارة الاداء الوظيفي.pdf` ❌ MISSING
Not in `reference_files/`. Guidance content not invented. Logged in DECISIONS D-006.

## 5. `نماذج تقيم اداء شاغلي الوظائف التعليمية1.pdf` ❌ MISSING
Source of the 8 official performance models. Infrastructure built; official model content **pending file delivery** (D-006). The UI marks official models as «بانتظار الاعتماد الرسمي».

## 6. `بيانات الموظفين في فارس.xlsx` ❌ MISSING
52-employee source. Import pipeline + data-minimization rules (default-import: name, job title, cadre, status, unit, job number; excluded by default: national ID, birth date, manager ID, mobile) implemented and tested against synthetic fixtures at `tests/fixtures/fares-synthetic.xlsx` (fabricated names/numbers, clearly marked). Real import runs through UI when file arrives.

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
