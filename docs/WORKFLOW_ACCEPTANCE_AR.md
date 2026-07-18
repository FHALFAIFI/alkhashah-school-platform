# تقرير قبول سير العمل — مرحلة جودة العمليات (2026-07-17)

> **قرار مالك المنتج (D-018):** بوابة C5 (شهادات HTTPS عبر Tailscale، الكاميرا، PWA، دون اتصال) **مؤجلة بقرار مالك المنتج — خارج نطاق التحقق الحالي، ولم تُعتمد كناجحة**. الوصول يبقى عبر Tailscale HTTP الحالي، وكل خطوة كانت تعتمد على الكاميرا لها بديل يدوي (إدخال رمز الغرفة + رفع ملف عادي).
>
> **لا يُنشأ وسم `v1.0.0-pilot` قبل اعتماد هذا التقرير من المدير.**

---

## أولاً: مركز عمل مدير المدرسة «/dashboard»

لوحة موحدة بعنوان **«مركز عمل مدير المدرسة»** تجمع كل ما يحتاج إجراء عبر الوحدات، وكل بطاقة تفتح **السجل المحدد** الذي يحتاج الإجراء (لا صفحة الوحدة) مع نص «الإجراء التالي» بالعربية:

| القسم | مصدر البيانات | وجهة البطاقة |
|---|---|---|
| ما يحتاج إجراء الآن | العناصر العاجلة من كل الأقسام أدناه (بلا تكرار) | السجل المحدد |
| مهام متأخرة | المهام المفتوحة المتجاوزة موعدها + مصدر كل مهمة | صفحة الاجتماع/البرنامج/الجلسة المصدر |
| عناصر بانتظار المراجعة | صفوف استيراد «يحتاج مراجعة»، اجتماعات «بانتظار التوقيع»، شواهد «لم يراجع» | دفعة الاستيراد / الاجتماع / الشاهد |
| عناصر بانتظار الاعتماد | دفعات جاهزة للتنفيذ، طلبات تعديل «قيد الاعتماد»، حزم شواهد «جاهزة للاعتماد»، لجان «مسودة»، قوالب فحص «مسودة» | السجل المحدد بمرساة مباشرة |
| تنبيهات نقص الشواهد | البرامج المعتمدة التي تنقص حزمها أدوار شواهد إلزامية (تنفيذ/مخرج/أثر/خارجي) | البرنامج على قسم الشواهد |
| قرارات اللجان المفتوحة | المهام الإلزامية الناتجة عن قرارات الاجتماعات | صفحة الاجتماع |
| تقييمات الأداء القادمة | الدورات النشطة: الجلسة القائمة أو الجلسة الأساسية التالية | صفحة الدورة/الجلسة |
| بلاغات الصيانة | البلاغات المفتوحة وقيد الإصلاح وبانتظار التحقق | سجل الصيانة على البلاغ نفسه |

---

## ثانياً: سير العمل المعتمدة — المراحل وما أُصلح

### أ) استيراد الموظفين
**المراحل:** رفع الملف ← المعاينة والتصحيح ← الموافقة والتنفيذ ← عرض النتيجة (مع تراجع كامل).

**ما أُصلح:**
- مؤشر مراحل عربي على صفحتي الرفع والدفعة، مع لوحة كهرمانية تبين عدد الصفوف التي «تحتاج مراجعة» والإجراء المطلوب لكل صف (تعديل/تأكيد/استبعاد).
- الموافقة أصبحت **صريحة ومفصلة بنداً بنداً**: لوحة تأكيد تعرض اسم الملف وعدد الصفوف الجاهزة والمعلمين والموظفين والمستبعدين قبل زر «تأكيد التنفيذ».
- إغلاق ثغرة التنفيذ المزدوج من نافذتين: «ادعاء» حالة الدفعة يجري **داخل** المعاملة نفسها؛ محاولة ثانية تُرفض برسالة عربية.
- بعد التنفيذ: بطاقة نجاح + زر «عرض الموظفين المستوردين» يفتح سجل الموظفين **مصفى بالدفعة** (`/people?دفعة=…`)، وكل صف منفذ يرتبط بصفحة الموظف الذي أنشأه، والإشعار يقود للسجل المصفى.
- التنفيذ للخطة التشغيلية يستهدف **السنة التخطيطية النشطة** (أزيل التثبيت اليدوي للسنة).
- سجل الأخطاء يظهر قائمة عربية مفهومة بدل نص تقني.

**دفعة فارس الحقيقية:** باقية بحالة «معاينة» (52 صفاً، 10 تحتاج مراجعة). **لم تُمس ولن تُنفذ إلا بيدك.**

### ب) الخطة التشغيلية
**المراحل:** الإعداد (استيراد/معالم) ← الاعتماد ← التنفيذ والمتابعة (متابعة أسبوعية + شواهد) ← الإقفال، مع طلبات تعديل واعتماد وإعادة فتح موثقة.

**ما أُصلح:**
- **مرحلة المتابعة الأسبوعية كانت غائبة كلياً وأُنشئت**: صفحة `/plan/followup` تعرض البرامج المعتمدة وعمر آخر متابعة، مع نموذج أسبوعي (ملاحظة + حالة: في المسار/متأخر/متوقف مؤقتاً/مكتمل). التسجيل يحدّث «آخر مراجعة» و«حالة التنفيذ» — فتنبيهات «البرنامج المتأخر» في المركز والمساعد أصبحت حية بعد أن كانت معطلة بنيوياً.
- شارة «متابعة مستحقة» لأي برنامج معتمد بلا متابعة لأكثر من 14 يوماً.
- مؤشر مراحل على صفحة البرنامج مع إجراء تالٍ واحد واضح لكل حالة، وسجل متابعات، ومراسٍ مباشرة للأقسام (#الشواهد، #طلبات-التعديل).
- طلبات التعديل: منع التكرار للحقل نفسه، وإشعار للمعتمدين عند الطلب وللطالب عند القرار.
- مرحلة **مراجعة الشواهد** فُعّلت: قبول/رفض مع سبب من سجل الشواهد (كانت حقلاً في القاعدة بلا أي واجهة).
- إصلاحات عرض 390px لنماذج البرنامج، وملاحظة صادقة أن «فترة» التقرير التنفيذي عنوان لا مرشّح.

### ج) اللجان والفرق
**المراحل:** تشكيل سنوي من قالب رسمي (بلا أعضاء قدامى) ← اختيار الأعضاء من السجل ← اعتماد ← اجتماعات ← نتائج (قرار→مهمة إلزامية تلقائياً) ← محضر رسمي ← رفع المحضر الموقع (الرئيس والمقرر فقط) ← اكتمال ← إقفال. **لا حضور ولا نصاب إطلاقاً** (يحرسه اختبار يفحص قاعدة البيانات).

**ما أُصلح:**
- مؤشر مراحل على صفحتي اللجنة والاجتماع مع إجراء تالٍ واحد بارز لكل حالة.
- منع تسجيل النتيجة نفسها مرتين (كانت تنشئ مهمتين إلزاميتين).
- الإقفال يُمنع أيضاً عند وجود اجتماع «بانتظار التوقيع» (كان يقفل فوقه).
- ربط متبادل: القرار في الاجتماع يقود لمهمته في سجل المهام، والمهمة تقود لاجتماعها.
- الأفعال الصامتة (حذف عضو، رفض إلغاء مهمة إلزامية) تعيد الآن رسائل عربية واضحة.

### د) الأداء الوظيفي
**المراحل:** اختيار الموظف ← النموذج الرسمي (8 نماذج وزارية معتمدة حرفياً) ← دورة بمواعيد مجمدة (معلم: التقويم الدراسي الرسمي؛ موظف: السنة الميلادية كاملة) ← جلسات (تخطيط/منتصف/نهائي مرة واحدة + زيارات) ← تقديرات 1..5 ← **حساب موزون في الخادم فقط** ← تقرير موقّع ← إقفال، مع إعادة فتح موثقة.

**ما أُصلح:**
- **أخطر خلل في المنصة:** بوابة الإكمال النهائي تشترط شاهداً لكل مؤشر، لكن الواجهة لم تكن تستطيع ربط شاهد بمؤشر — فكان إكمال أي تقييم نهائي **مستحيلاً**. أضيف حقل «المؤشر المرتبط» في لوحة الشواهد وقائمة تحقق ✓/✗ لكل مؤشر على الجلسة النهائية.
- إقفال الجلسة النهائية يجعل الدورة «مكتملة» (وإعادة فتحها تعيدها «نشطة») — الدورات كانت لا تكتمل أبداً.
- مؤشر مراحل الدورة (تخطيط ← منتصف ← نهائي ← الاكتمال) مع إجراء تالٍ واحد، وعرض مواعيد دورة الموظف مع تنبيه «متأخر عن الموعد».
- حالة D-014 (أمين مصادر وأمثاله بلا نموذج رسمي): عند غياب نموذج مطابق للفئة يتاح **اختيار يدوي صريح** من النماذج المعتمدة مع تحذير «لا يُخترع نموذج» — كان إنشاء دورة موظف مستحيلاً.
- بطاقة «دورات الأداء» على صفحة الموظف. خطط التحسين تتقدم حالتها وتُمنع من التكرار.
- بوابات منع الإكمال كما هي دون أي تخفيف: لا اكتمال دون تقرير صادر + نسخة موقعة، ولا نهائي دون تقييم كل المؤشرات + شواهدها.

### هـ) التوأم الرقمي للمبنى
**المراحل:** المبنى/المنطقة ← الدور ← الغرفة ← تعديل الاسم والأبعاد بالمتر ← مسودة ← معاينة ← نشر نسخة ← سجل الغرف والأصول ← فحص ← بلاغ صيانة ← إغلاق وتحقق.

**ما أُصلح:**
- **إنهاء ازدواجية مصدر الحقيقة:** تعديل بيانات الغرفة يكتب الآن في سجل الغرف **وفي مسودة هندسة الدور معاً** ضمن معاملة واحدة — النشر لم يعد يمحو تعديلاتك، والاسم الجديد يظهر على المخطط بعد النشر.
- محرر المخطط: مساران واضحان «حفظ مسودة» و«نشر النسخة» (أزيل زر النشر الزائف).
- **بديل الكاميرا تحت HTTP (D-018):** «فتح غرفة بالرمز» على صفحة المبنى (اكتب KHS-RM-… بدل مسح QR)، ورفع الصور بملف عادي مع إزالة تلميح الكاميرا الإجباري.
- رابط QR للأصول أصبح يعمل (`?رمز=` يصفي ويبرز الأصل).
- الصيانة: حقل «المكلف بالإصلاح» من سجل الموظفين، ملاحظة إصلاح عند «تم الإصلاح»، وتأكيد صريح عند «مغلق ومتحقق».
- شريط إجراءات أعلى صفحة الغرفة: الجاهزية + «سجل فحصاً / أبلغ عن عطل / حدّث البيانات».

### و) المساعد الذكي داخل سير العمل
**المبدأ:** المساعد يعمل **داخل** كل سير عمل بسياق السجل المفتوح، لا كدردشة عامة.

**ما أُصلح/أُضيف:**
- ربط سياق الصفحة (نوع السجل ومعرفه) **في الخادم** بأدوات المساعد بعد التحقق من صحة السجل — «هذا البرنامج/هذا الاجتماع/هذه الغرفة» تعمل الآن حتماً لا تخميناً. الزر العائم يلتقط السياق من الصفحة الحالية تلقائياً.
- 5 أدوات قراءة جديدة مرتبطة بالسياق: ملخص برنامج، موجز اجتماع، موجز أداء موظف (**بلا أي درجات — قاعدة D-016**)، موجز غرفة، و**استخراج نص المرفقات** (PDF عبر poppler، صور عبر OCR المحلي) لاستخراج القرارات والمهام.
- اقتراحات عربية سياقية جاهزة على كل شاشة (انظر «أوامر جرّبها» أدناه).
- الضمانات كما هي: القراءة تنفذ فوراً بصلاحياتك؛ **كل كتابة تُعرض معاينة مفصلة وتنتظر تأكيدك الصريح**؛ ولا وجود لأي أداة اعتماد/إقفال/توقيع/درجات/تنفيذ استيراد/حذف/إرسال نهائي/صلاحيات (يحرسها اختبار يفحص أسماء الأدوات كلها)؛ وكل شيء مسجل في سجل التدقيق.

---

## ثالثاً: متطلبات الاستخدام (مطبقة عبر كل سير العمل)

- مؤشر مراحل عربي موحد (المنجز ✓ / الحالي / المتبقي) على: دفعة الاستيراد، البرنامج، اللجنة، الاجتماع، دورة الأداء.
- زر/تلميح «الإجراء التالي» واحد وواضح لكل حالة.
- أسماء حالات عربية ثابتة بألوان موحدة في كل الوحدات.
- رسائل تحقق عربية مفهومة، وأخطاء الأفعال لم تعد صامتة.
- منع الإرسال المزدوج: زر الإرسال الموحد يتعطل أثناء التنفيذ في كل المنصة + حواجز خادمية (تنفيذ الاستيراد، النتائج المكررة، طلبات التعديل، خطط التحسين، المعالم).
- المسودات: مسودات الهندسة مرقمة ومحفوظة؛ جلسات الأداء تحفظ جزئياً؛ الاستئناف من نفس الخطوة عبر بطاقات مركز العمل التي تفتح السجل على موضع الإجراء (مراسٍ مباشرة).
- سطح المكتب و390×844: كل المسارات الرئيسية بلا تمرير أفقي على مستوى الصفحة (الجداول العريضة تتمرر داخل حاوياتها فقط)، أهداف لمس ≥44px، خطوط إدخال ≥16px.
- لا معرفات قاعدة بيانات في النصوص الظاهرة: الرموز البشرية هي الظاهرة (KHS-RM-…, KHS-MNT-…, أرقام الوثائق). (تبقى المعرفات في عناوين URL فقط — انظر «حدود معروفة».)

## رابعاً: الاختبارات

- **Vitest: ‏84 اختباراً في 14 ملفاً — كلها خضراء**، منها الجديد: سباق التنفيذ المزدوج للاستيراد، آلة حالات الخطة كاملة (اعتماد/إعادة فتح/طلب تعديل/متابعة/إقفال سنة)، مسار الإكمال النهائي للأداء عبر الأفعال الحقيقية، مزامنة هندسة الغرف مع النشر، دورة الصيانة كاملة، قائمة أدوات المساعد المسموحة (17 أداة) وربط السياق وحجب الدرجات.
- **Playwright: ‏16 اختباراً خضراء + 1 مؤجل (C5)** على الأجنحة القائمة (عربية/مصادقة، جوال 390px لكل المسارات، مساعد).
- **سيناريوهات الأعمال الكاملة (tests/e2e/workflows.spec.ts): ‏15/15 خضراء** — 7 سيناريوهات كاملة على سطح المكتب (استيراد بتراجع، خطة من الاستيراد حتى التقرير التنفيذي، لجنة من القالب حتى الاكتمال بالمحضر الموقع، دورة أداء حتى إقفال النهائي واكتمال الدورة بربط شاهد لكل مؤشر، توأم رقمي من النشر حتى إغلاق بلاغ الصيانة، الدخول السياقي للمساعد، **وحرمة دفعة فارس**) + 8 إعادات على 390×844 مع تأكيد صفر تمرير أفقي في كل صفحة. ثلاث دورات تشغيل متتالية خضراء بالكامل.
- **ثلاثة أخطاء حقيقية كشفتها السيناروهات وأُصلحت:**
  1. توليد رمز الغرفة كان يقرأ خارج معاملة النشر، فكان **أول نشر لأي دور بأكثر من غرفة يفشل دائماً** بتضارب رموز KHS-RM (أخطر ما كشف).
  2. نموذج إضافة الشواهد كان بعد كل حفظ يفقد اختيار «نوع الشاهد» في الصفحة، فيفشل الحفظ التالي المتتابع بغموض.
  3. إعادة تشكيل لجنة من قالب لجنتها «مقفلة» كانت تُرفض رغم أن الواجهة تعرضها — وحّد السلوك (المقفلة لا تمنع تشكيل عام جديد).
- **الحصيلة النهائية لكل الفحوص:** ‏84 vitest + ‏30 Playwright خضراء (+1 مؤجل = C5)، وفحص الأنواع والجودة والبناء الإنتاجي نظيفة كلها.

## خامساً: ما يلزم أن تختبره بنفسك (بالترتيب)

> ملاحظة: قاعدة البيانات التشغيلية شبه فارغة عمداً (لا موظفين ولا خطة معتمدة بعد) — السيناروهات الآلية تنشئ سجلات اصطناعية موسومة «تجريبي آلي» يمكنك الاسترشاد بها ثم حذف ما يزعجك، وقرارات البيانات الحقيقية كلها بيدك.

1. **مركز العمل:** افتح `/dashboard` — تحقق أن كل بطاقة تنقلك للسجل المحدد نفسه.
2. **الاستيراد الحقيقي (قرارك):** `/imports` ← افتح دفعة فارس «معاينة» ← راجع الصفوف العشرة الموسومة «يحتاج مراجعة» (عدّل التصنيف أو أكد أو استبعد) ← ستظهر لوحة الموافقة المفصلة ← **التنفيذ قرارك وحدك** ← بعده «عرض الموظفين المستوردين».
3. **الخطة:** `/imports/new?type=operational_plan` ارفع مصنف الخطة الرسمي ← نفّذ ← `/plan` اعتمد برنامجاً (لاحظ شرط أوزان 100) ← `/plan/followup` سجّل متابعة الأسبوع ← أرفق شواهد بأدوارها ← جرّب طلب تعديل واعتمده ← `/reports/executive` أصدر التقرير.
4. **اللجان:** `/committees` شكّل لجنة العام من قالب ← أضف رئيساً ومقرراً ← اعتمد ← اجتماع ← سجّل قراراً (لاحظ المهمة الإلزامية في `/tasks`) ← أصدر المحضر ← ارفع الموقع ← أكمل.
5. **الأداء:** `/performance` أنشئ دورة لمعلم ← جلسة تخطيط ← قدّر واحفظ ← أصدر التقرير واطبعه ← ارفع الموقع ← أكمل ← جلسة نهائي: قدّر الكل واربط شاهداً لكل مؤشر (قائمة ✓/✗ سترشدك) ← أكمل وأقفل — الدورة تصبح «مكتملة». جرّب أيضاً دورة لموظف إداري لترى مسار الاختيار اليدوي للنموذج (D-014).
6. **المبنى:** الدور الأرضي منشور الآن بفعل السيناروهات الآلية (سجل الغرف KHS-RM-0001..0017 قائم، وقالب «فحص السلامة العام» معتمد) — جرّب: «فتح غرفة بالرمز» ← عدّل اسم غرفة وأبعادها ← لاحظ تلميح المسودة ← انشر من المحرر ← سجّل فحصاً من صفحة الغرفة ← أبلغ عن عطل بمكلف ← قدّمه حتى «مغلق ومتحقق». وانشر بقية الأدوار من محرراتها متى شئت.
7. **المساعد:** من صفحة برنامج/اجتماع/غرفة اضغط «مساعد المدير الذكي» وجرّب الأوامر أدناه؛ لاحظ أن أي إنشاء (مهمة/بلاغ/مسودة) يعرض معاينة ويطلب تأكيدك.

## سادساً: أوامر عربية جرّب بها المساعد

- من أي مكان: **«لخّص حالة الخطة التشغيلية»**، **«اعرض البرامج المتأخرة واقترح إجراءات»**
- من صفحة برنامج: **«افحص اكتمال شواهد هذا البرنامج»**، «لخّص حالة هذا البرنامج»
- من صفحة اجتماع: **«أنشئ مسودة محضر لهذا الاجتماع»**، **«استخرج القرارات والمهام من المرفق»**
- من دورة أداء: **«جهز ملخص أداء هذا الموظف»** (بلا درجات — تُعرض لك وحدك في المنصة)
- من صفحة غرفة: **«أنشئ مسودة طلب صيانة لهذه الغرفة»**

## سابعاً: حدود معروفة وقرارات مؤجلة

- **C5 مؤجلة بقرار مالك المنتج (D-018)** — الكاميرا المباشرة ومسح QR والتثبيت كتطبيق ووضع عدم الاتصال الكامل تتطلب HTTPS ولن تُلمس حتى تعيد فتحها؛ البدائل اليدوية تعمل.
- معرفات UUID تبقى في عناوين URL (لا في النصوص الظاهرة) — طبقة أرقام مختصرة للعناوين تحسين مستقبلي اختياري.
- «فترة» التقرير التنفيذي عنوان وصفي لا مرشّح زمني (موثقة في الواجهة).
- مقارنة خلايا الأوزان الثلاث (D-014) مع نظام فارس تبقى على عاتقك عند أول دورة حقيقية.
- مسودات النماذج النصية الطويلة لا تُحفظ تلقائياً قبل الإرسال (الحفظ عند الإرسال فقط).

## ثامناً: مراجع الالتزامات (Git)

| Commit | المحتوى |
|---|---|
| `6ff3581` | تسجيل تأجيل C5 بقرار مالك المنتج (D-018) وتحويل الأولوية لجودة سير العمل |
| `9908f19` | مركز عمل مدير المدرسة + مكتبة قوائم العمل + منع الإرسال المزدوج + مؤشر المراحل + روابط مصادر المهام |
| `06463fb` | مرحلة مراجعة الشواهد + الربط بمؤشر محدد (subKey) |
| `8e1b6da` | استيراد الموظفين: موافقة مفصلة آمنة من السباق + مراحل موجهة + روابط ما بعد التنفيذ |
| `a7b80a9` | اللجان: مؤشرات مراحل + منع تكرار النتائج + إحكام بوابة الإقفال |
| `ab63afa` | الخطة: مرحلة المتابعة الأسبوعية (هجرة 0003) + إشعارات طلبات التعديل + مؤشر مراحل البرنامج |
| `08d9382` | الأداء: إكمال التقييم النهائي أصبح ممكناً + دورة حياة الدورة + مسار D-014 اليدوي |
| `acf45f2` | التوأم الرقمي: تعديل الغرفة عبر مسودة←نشر + إدخال الرمز يدوياً + مكلف الصيانة |
| `a420767` | المساعد: أدوات مرتبطة بالسياق + استخراج المرفقات + الاقتراحات السياقية |
| `32aa6e3` | سيناريوهات الأعمال الكاملة (سطح المكتب + 390×844) + إصلاح 3 أخطاء كشفتها + هذا التقرير |
| `fea14bc` | توثيق البنود الثلاثة الراسبة من جلسة قبول الجوال على دفعة فارس (القسم تاسعاً) |
| `983d3d9` | إصلاح البنود الثلاثة: بطاقات جوال رأسية + قرارات قابلة للتراجع الكامل بسجل + «تمت مراجعة التصنيف» |
| `945d209` | سجل التدقيق: قيم قبل/بعد كاملة لكل قرار وتراجع + عرضها العربي في /admin/audit |
| `5e38685` | اعتماد سير عمل استيراد الموظفين (PASS) — دفعة فارس تبقى معاينة، D-014 قضية منفصلة |
| `f455862` | توثيق البند الراسب: تعذر قراءة مصنف الخطة الرسمي (القسم عاشراً) |
| `59650cf` | استيراد الخطة: قراءة المصنفات الرسمية + إصلاح البرنامج الشبح والتمرير + منع التكرار والإلغاء + معاينة غنية |

## عاشراً: بند قبول راسب — استيراد الخطة التشغيلية الرسمية (جلسة 2026-07-17 مساءً)

بدأ اختبار قبول استيراد الخطة التشغيلية عبر الواجهة عند 390×844 بالمسار: لوحة المعلومات ← الاستيراد ← استيراد الخطة التشغيلية ← رفع `الخطة_التشغيلية_المتكاملة_لمجمع_الخشعة_1448_1449.xlsx`. فحص التكرار عبر قائمة `/imports` سبق الرفع: لا دفعة سابقة للملف الرسمي (كل دفعات الخطة الموجودة اصطناعية «تجريبي آلي») — الرفع مشروع.

### البند الراسب 4 — تعذر قراءة المصنف الرسمي + رسالة خطأ إنجليزية خام ❌
**المطلوب:** رفع المصنف الرسمي يصل بالمستخدم إلى معاينة كاملة قبل أي كتابة.
**الواقع المرصود:** «تحليل ومعاينة» فشل برسالة إنجليزية تقنية خام «Cannot read properties of undefined (reading 'sheets')» — لا معاينة ولا دفعة، ومخالفة إضافية لقاعدة الرسائل العربية.
**السبب الجذري (شُخّص بفحص الملف نفسه لا التطبيق):** مكتبة exceljs لا تفهم مصنفات OOXML المكتوبة ببادئة نطاق أسماء (`<x:workbook>` — نمط أدوات ‎.NET/OpenXML التي أنتجت الملفين الرسميين كليهما)، فتنهار قبل قراءة أي ورقة. مصنف «المتكاملة» سليم محتوىً ويضم كل الأوراق السبع المطلوبة للمحلل ضمن 25 ورقة؛ العيب في طبقة القراءة حصراً. ملفات منتِجات أخرى (فارس) تُقرأ بلا مشكلة — لذا نجح استيراد الأشخاص سابقاً.
**ملاحظة مسجلة إضافية:** خطوة الرفع لا تتضمن فحص تكرار مدمجاً (أُجري الفحص يدوياً من قائمة الدفعات).
**الحكم: راسب — يُصلح ثم يعاد الاختبار من الرفع حتى المعاينة.**

### نتيجة المعالجة (نفس اليوم — الالتزام `59650cf`) ✅

أُصلح البند وأربعة عيوب كشفها إكمال الاختبار، ثم أُعيد الاختبار كاملاً عبر الواجهة عند 390×844 على الملف الرسمي:

1. **قراءة المصنف الرسمي:** أضيف تطبيع بادئات نطاق الأسماء (‏`normalizeWorkbookNamespaces` عبر adm-zip: إزالة بادئة `<x:…>` وحذف نطاقات الدمج المكررة) مع إعادة محاولة القراءة، ورسائل خطأ **عربية** بدل النص الإنجليزي الخام. الملف الرسمي يُقرأ الآن ويصل للمعاينة.
2. **برنامج شبح (27 مقابل 26):** كانت `cellNumber` تُرجع 0 للنص غير الرقمي، فيتسرب صف «إجمالي الميزانية المدرسية المباشرة» كبرنامج seq=0. صُحّحت لتُرجع null → المعاينة تعرض **26 برنامجاً = المصدر تماماً**.
3. **التمرير الأفقي:** أسماء الملفات الطويلة الموصولة بشرطات سفلية لم تكن تلتف (‏143px في معاينة الخطة عبر `PageHeader`، و3px في بطاقة الاستيراد بمركز العمل). أُضيف `min-w-0/break-words` في الموضعين — صفر تمرير أفقي (فحص مركز العمل بـ3px كان قائماً قبل التغيير ومستحثاً بالبيانات، أُكّد بـgit-stash أنه ليس ارتداداً برمجياً).
4. **منع التكرار:** رفع ملف له دفعة حية (معاينة/منفذة) يُمنع الآن برسالة عربية توجه لفتح الدفعة القائمة أو إلغائها — وأُضيف زر **«إلغاء الدفعة»** يحوّل دفعة المعاينة إلى «ملغاة» (دون قاعدة بيانات) فيحرّر الملف لرفع جديد.
5. **معاينة غنية:** أُضيف ملخص (السنة الدراسية المشتقة من التواريخ + عدد المجالات والبرامج) وبطاقة قابلة للفتح لكل برنامج تُظهر الأهداف والمؤشر والمسؤول والتواريخ والمعالم والمستهدف والشواهد والمخرج والميزانية — تعمل على الجوال بلا تمرير أفقي.

**إعادة الاختبار الحية (الملف الرسمي، عبر الواجهة، دون تنفيذ):** فحص التكرار من `/imports` (لا دفعة سابقة) ← لوحة المعلومات ← الاستيراد ← رفع ← معاينة تعرض: **السنة 1448/1449هـ · 4 مجالات · 26 برنامجاً · 108 صفاً** (برامج 26 · مخرجات 26 · مؤشرات 15 · مخاطر 9 · ميزانية 6 · خارطة 26) بلا أي تحذير أو تعيين ناقص. قورنت السجلات الأول (م=1) والأوسط (م=14) والأخير (م=26) مع المصنف المصدر حقلاً بحقل — **تطابق تام**، والفرق الوحيد (البرنامج الشبح 27) زال بإصلاح `cellNumber`. تكرار المعالم عبر البرامج تحقق أنه **نص المصدر نفسه** (نقاط قياس موحدة)، لا خطأ تعيين. الدفعة تُركت «معاينة» ولم تُنفذ.

**الاختبارات:** ‏103 vitest (‏+6 جديدة: قراءة المصنف المبدوء، رسالة عربية، استبعاد صف الإجمالي، رصد الدفعة الحية، الإلغاء، `cellNumber`) + ‏38 Playwright (‏+4: بطاقات وملخص الخطة بلا تمرير، منع التكرار، الإلغاء وإعادة الرفع، اسم ملف طويل بلا تمرير في مركز العمل) + 1 مؤجل (C5) — كلها خضراء.

**قرار الاعتماد: بند استيراد الخطة أصبح جاهزاً للمعاينة والمقارنة؛ التنفيذ يبقى قرار المدير الصريح.**

## تاسعاً: بنود قبول راسبة — جلسة قبول الجوال على دفعة فارس الحقيقية (2026-07-17)

أجريت جلسة قبول فعلية على الجوال (390×844) عبر واجهة `/imports` وحدها على دفعة «بيانات الموظفين في فارس.xlsx» (52 صفاً)، وحُسمت خلالها الصفوف العشرة الموسومة «يحتاج مراجعة» واحداً واحداً بقرار المدير (قبول ×10) دون تنفيذ الدفعة. كشفت الجلسة ثلاثة بنود **راسبة**:

### البند الراسب 1 — لا بطاقات رأسية لصفوف المعاينة على الجوال ❌
**المطلوب:** عند 390×844 يعرض كل صف معاينة كبطاقة عربية رأسية حقيقية، دون أي تمرير أفقي، مع بقاء جدول سطح المكتب كما هو.
**الواقع المرصود:** صفوف الدفعة تُعرض جدولاً بعرض ~1400px يُمرر أفقياً داخل حاويته (`Table` بـ`overflow-x-auto`). قاعدة C1 (لا تمرير أفقي على مستوى الصفحة) محترمة شكلياً، لكن مراجعة صف واحد على الجوال تتطلب تمريراً أفقياً متكرراً — تجربة غير مقبولة لسير عمل قرارات.
**الحكم: راسب.**

### البند الراسب 2 — القرارات غير قابلة للتراجع الكامل ❌
**المطلوب:** «تراجع عن آخر قرار» يستعيد الحالة والتصنيف والقيم السابقة كاملة، و«إعادة إلى المراجعة» تعيد الصف إلى «يحتاج مراجعة»، مع دعم الحالات: جاهز / مستبعد / مؤجل / يحتاج مراجعة، وسجل قرارات كامل لكل صف.
**الواقع المرصود:** لا وجود لأي من الزرين؛ بعد أي قرار يمكن التنقل بين «جاهز»↔«مستبعد» فقط، ولا سبيل لاستعادة «يحتاج مراجعة» ولا لاسترجاع القيم قبل التصحيح، ولا يوجد سجل قرارات على مستوى الصف، ولا حالة «مؤجل» أصلاً (التأجيل كان يعني مجرد ترك الصف).
**الحكم: راسب.**

### البند الراسب 3 — تحذير التصنيف يبقى «نشطاً» بعد حسمه ❌
**المطلوب:** بعد حسم تحذير التصنيف يختفي التحذير النشط ويظهر مكانه «تمت مراجعة التصنيف»، ويبقى التحذير الأصلي في سجل القرارات فقط.
**الواقع المرصود:** «⚠ التصنيف (معلم/موظف) غير مؤكد — يحتاج تأكيد المدير» يظل معروضاً بنفس الهيئة الكهرمانية في عمود التحقق حتى بعد أن أصبح الصف «جاهز» بقرار المدير — يوحي زوراً بأن الصف ما زال معلقاً.
**الحكم: راسب.**

> **قرار المعالجة:** البنود الثلاثة تُصلح في التزام برمجي منفصل يلي هذا التوثيق مباشرة (مع اختبارات آلية وإعادة عرض حي على 390×844)، **مع الحفاظ على دفعة فارس الحقيقية وقراراتها العشرة كما هي، ودون تنفيذ الدفعة، ودون أي تعديل عبر قاعدة البيانات**. خلاف D-014 (خلايا الأوزان الثلاث بين ملف النماذج والدليل الإرشادي) يبقى كما هو: خلاف مصادر أداء منفصل غير محسوم، موثق في «سابعاً» و`docs/PERFORMANCE_MODEL_VALIDATION.md` §3 — لا علاقة له بهذه البنود.

### نتيجة المعالجة (نفس اليوم — الالتزام `983d3d9`) ✅

**البنود الثلاثة أُصلحت وأُعيد فحصها حياً على دفعة فارس الحقيقية عند 390×844:**

1. **البطاقات الرأسية:** دون 1024px يعرض كل صف معاينة بطاقة عربية رأسية كاملة (عرضها 366px داخل شاشة 390px، صفر تمرير أفقي في كل خطوة)، بأهداف لمس ≥44px، وجدول سطح المكتب باقٍ كما هو دون تغيير.
2. **التراجع الكامل:** خمسة قرارات على الصف («تأكيد كجاهز»، «تصحيح»، «استبعاد»، «تأجيل»، «إعادة إلى المراجعة») كلٌّ منها يحفظ لقطة الحالة والقيم والتصحيحات السابقة في «سجل القرارات» الظاهر على البطاقة، وزر «تراجع عن آخر قرار» يستعيدها بدقة. حالة «مؤجل» الجديدة تمنع التنفيذ في الواجهة والخادم ومركز العمل حتى تُحسم.
3. **التحذير المحسوم:** تحذير التصنيف نشط فقط ما دام الصف غير محسوم (يحتاج مراجعة/مؤجل)؛ بعد الحسم يظهر «✓ تمت مراجعة التصنيف» ويبقى النص الأصلي في سجل القرارات، ويعود نشطاً عند «إعادة إلى المراجعة».

**العرض الحي المنفذ على الصف 3 من دفعة فارس (عبر الواجهة فقط):** يحتاج مراجعة ← تأكيد ← تراجع ← تصحيح (تغيير الوظيفة) ← تأجيل (بوابة التنفيذ مُنعت) ← إعادة إلى المراجعة ← تأكيد، ثم خمسة تراجعات متتالية أعادت الصف تماماً لحالته المعتمدة: «جاهز» بالمسمى الأصلي «مساعد إداري ممارس» وسجل قرارات فارغ. الدفعة بقيت «معاينة» (جاهز 52 · مراجعة 0 · مؤجل 0) **ولم تُنفذ** — التوقف قبل التأكيد النهائي.

**ثلاثة أخطاء إضافية كشفها هذا الإصلاح وأُغلقت في الالتزام نفسه:** زر المساعد العائم كان يغطي أزرار آخر بطاقة في الصفحة نهائياً بلا إمكانية تمرير (حاشية سفلية للجوال في هيكل التطبيق)؛ نموذج «تصحيح» لم يكن يُغلق بعد «حفظ كجاهز» فتختفي بقية الأزرار؛ دفعة كل صفوفها المعلقة «مؤجل» كانت ستظهر في مركز العمل كجاهزة للاعتماد.

**الاختبارات بعد الإصلاح:** ‏92 vitest (منها 8 جديدة لقرارات الاستيراد وعرض التحذير) + ‏33 Playwright (منها 3 جديدة: البطاقات عند 390×844، الدورة الكاملة مع التراجع الكلي، بقاء جدول 1280px) + 1 مؤجل (C5) — **كلها خضراء دون أي تراجع في القديم**، بما فيها اختبار «حرمة دفعة فارس».

### قرار الاعتماد — سير عمل استيراد الموظفين: **ناجح (PASS)** ✅

**اعتمد المدير سير عمل استيراد الموظفين بتاريخ 2026-07-17** بعد: جلسة القبول على دفعة فارس الحقيقية (10 قرارات صف‑بصف عبر الجوال)، وإصلاح البنود الثلاثة الراسبة والتحقق الحي منها (`983d3d9`)، وتحقق سلامة سجل التدقيق بقيم قبل/بعد (`945d209`). حدود الاعتماد:

- **دفعة فارس الحقيقية باقية بحالة «معاينة» ولا تُنفذ إلا بيد المدير** — الاعتماد لسير العمل لا للتنفيذ.
- **D-014 يبقى قضية مصادر أداء منفصلة غير محسومة** (خلايا الأوزان الثلاث: ملف النماذج 5٪ مقابل الدليل ص30/44/45 ‏15٪) — لا علاقة لها باستيراد الموظفين، وتُحسم بمطابقة نظام فارس عند أول دورة تقييم فعلية كما هو موثق في «سابعاً» و`docs/PERFORMANCE_MODEL_VALIDATION.md` §3.

**تحقق سلامة سجل التدقيق (نفس اليوم — الالتزام `945d209`):** جرى التحقق عبر واجهة `/admin/audit` (لا عبر قاعدة البيانات) أن تسلسل العرض الكامل على الصف 3 محفوظ بلا أي حذف: 12 حدثاً إلحاقياً بترتيبها الزمني، وكل «تراجع» حدث مستقل `import.row_decision_undone` لا يمس الأحداث السابقة. سُدت فجوة واحدة: الأحداث كانت تحمل الحالة قبل/بعد دون **القيم** — الآن كل قرار وتراجع يسجل لقطة كاملة (الحالة + القيم + التصحيحات + التحذير المحسوم) وتعرضها الواجهة العربية في بند «قبل / بعد» قابل للفتح لكل حدث. أُثبت ذلك بدورة تحقق عبر الواجهة على الصف 3 (إعادة إلى المراجعة ← تصحيح ← تراجع ← تراجع) انتهت باستعادة تامة، والدفعة باقية «معاينة» دون تنفيذ. الحصيلة: ‏93 vitest + ‏34 Playwright (+1 C5) خضراء.

---

## Synthetic-data archive — 2026-07-18 — STATUS: NOT EXECUTED (DEFERRED by product owner)

**Decision (2026-07-18):** the synthetic-data archive/cleanup is **deferred** and recorded as
**NOT EXECUTED**. No further cleanup work is to be spent. The read-only verification below
confirms the archive is absent on the connected environment; it stands as the evidence for this
NOT-EXECUTED status. Synthetic residue therefore remains excluded only by the structural
classifier (toggle-based), not by an explicit archive — acceptable until the archive is run.

### Post-archive verification detail — RESULT: NOT CONFIRMED (archive not executed on the connected environment)

Read-only verification was requested after a report that the principal manually executed the
synthetic-data archive. Every check below is read-only: SELECT-only queries and unauthenticated
HTTP GETs. **No rollback/unarchive was performed and the Fares batch was not committed.**

**Environment verified:** app at `http://localhost:3080`; real DB
`postgresql://…@localhost:5544/madrasa` (the app's configured `DATABASE_URL`). Migration `0005`
(`archive_batches` + `archived_records`) is applied — the tables exist and are empty.

**Headline finding:** the archive is **not present** on this database. Every domain **and**
archive table is byte-for-byte identical to this session's pre-archive baseline (all 62 tables).
`audit_log` contains **no** archive/cleanup event; the latest audit entry is a `login.success`
at `2026-07-17 22:46` — there is no activity on `2026-07-18`.

| # | Expected (post-archive) | Observed | Verdict |
|---|---|---|---|
| 1 | `archive_batches` = 1, status «مؤرشف» | 0 rows | ✗ not executed |
| 2 | `archived_records` = 520 | 0 | ✗ not executed |
| 3 | `/plan` shows exactly 26 official programs | `programs` = 58 rows; no archive exclusion set applied | ✗ not verifiable as an archive outcome |
| 4 | Official plan batch `385c615a` committed, not approved/locked | «منفذة», 108 rows — intact | ✓ intact |
| 5 | Fares `12673bed` Preview, 52 rows, 0 materialized people | «معاينة», 52 rows, 0 people | ✓ intact |
| 6 | Synthetic absent from dashboards/follow-up/reports/exports/search/AI | archive exclusion set is empty; only the structural classifier (toggle-based) is active | ✗ not an archive outcome |
| 7 | Rollback/unarchive available | no «مؤرشف» batch exists → nothing to roll back | ✗ N/A |
| 8 | No domain rows deleted or modified | identical to baseline across all 62 tables | ✓ |
| 9 | `/login`, `/dashboard` return normally on :3080 | `/login` → HTTP 200; `/dashboard` → 307 → `/login` (healthy, protected) | ✓ |

**Conclusion.** On the connected local environment the synthetic-data archive **has not been
executed**: there is no «مؤرشف» batch, no archived records, and no archive audit event. Items 4,
5, 8, 9 are intact (trivially — nothing changed). Items 1, 2, 7 fail; items 3, 6 cannot be
attributed to an archive that did not run. **No PASS is recorded.** If the archive was executed
on a different deployment (e.g., the Ubuntu server), it is outside the reach of this verification
and must be re-verified there against that database. Fares remains «معاينة» and uncommitted; no
rollback was attempted.

---

## Operational-plan workflow walkthrough — 2026-07-18 (official plan, 390×844, read-only/draft)

Guided acceptance pass over the operational-plan lifecycle on an official program, driven through
the real Arabic UI at 390×844 (iPhone). **No fake records, no approve/lock/reopen/rollback, no
form submitted.** The only writes were auth artifacts (one login session + login audit); every
plan table is byte-identical to baseline and the walked program stays «مسودة». Representative
program: **seq 1 «متابعة الأداء المبنية على البيانات»** (`e58e4f1e`, domain «الإدارة المدرسية»),
one of the 26 official programs from committed batch `385c615a`. Every screen measured **0 px**
horizontal overflow at 390 px.

| Stage | Screen (Arabic) | Result |
|---|---|---|
| 1 Program details | `/plan/{id}` «بطاقة البرنامج (القيم الرسمية من المصدر)» | ✓ all official fields render (goal/domain/owner «المدير»/dates 1448/3/2هـ–1449/1/5هـ/target «إغلاق ≥85٪…»/KPI «نسبة القرارات المغلقة في موعدها») |
| 2 Milestones + weighted progress | «المعالم الموزونة — أساس حساب التقدم» | ✓ 5 milestones × 20٪ = «مجموع الأوزان: 100٪»; progress = Σ(weight×%)/100 = 0٪; per-milestone «تحديث الإنجاز» present |
| 3 Weekly follow-up | program «المتابعة الأسبوعية» + `/plan/followup` | ✓ (fixed) draft now renders a **disabled labeled preview** «معاينة نموذج المتابعة الأسبوعية — يُفعَّل بعد اعتماد البرنامج» (note + status select), so the principal sees the form without approving; live form still opens post-approval at `/plan/followup` |
| 4 Evidence package (تنفيذ/مخرج/أثر/خارجي) | «الشواهد المرتبطة» → «إضافة شاهد» | ✓ draft form opens; role options «خط أساس/تنفيذ/مخرج/أثر/خارجي», kinds ملف/رابط/نص. Not submitted |
| 5 Completeness + missing warnings | «المخرجات وحزمة الشواهد» | ✓ readiness 0٪ «غير مكتملة»; «ينقص الحزمة: شاهد تنفيذ، شاهد مخرج، شاهد أثر» (external not required for this deliverable) |
| 6 Correction request | «طلبات التغيير» | ✓ (fixed) draft now renders a **disabled labeled preview** «معاينة نموذج طلب التغيير — يُفعَّل بعد الاعتماد» (field/newValue/reason); live documented-request form still activates only for «معتمد» |
| 7 Reports | `/plan/{id}/report` + `/reports/executive` | ✓ program report (PDF issue + snapshot/doc-number/verification-code) and executive report «التقرير التنفيذي الشامل» (monthly/term/annual) both present. PDF issue not triggered (write) |
| 8 Print / Word / Excel / email | report screen + `/documents` | ✓ «تصدير Word قابل للتحرير» + «تصدير Excel تحليلي للخطة كاملة» on report screen; email «بريد»/«إنشاء مسودة» (M365-off fallback = download PDF) on the documents register; print = browser print / issued PDF |

**Findings logged (no code changed — see reasoning):**
1. **Approval gates stages 3 & 6 — FIXED (disabled preview added).** All 26 official programs are
   «مسودة»; the live weekly-follow-up and change-request forms only open after «اعتماد» (correct
   business logic — you follow up on / formally amend an *approved* program). The gap was that a
   draft program showed **nothing** of these forms, so the workflow was invisible before approval.
   **Fix (`src/app/(app)/plan/[id]/page.tsx`):** draft programs now render a static, **disabled,
   clearly-labeled preview** of both forms («معاينة … يُفعَّل بعد الاعتماد»). No `<form>`/server
   action is attached and every field is `disabled`, so nothing can be submitted or written and no
   program is approved. Verified: preview inputs report `disabled`, previews are not wrapped in any
   form, 0 px overflow at 390 px, program stays «مسودة», plan tables unchanged. The actual approve
   step remains the principal's manual action.
2. **Terminology ambiguity: «إقفال».** The approve button reads «اعتماد وإقفال» while the stepper's
   step 4 is also «الإقفال» (year lock → read-only «مقفل»). Same word, two meanings on one screen.
   **Not changed:** «اعتماد وإقفال» is a deliberate platform-wide convention (the permission is
   named «اعتماد وإقفال البرامج»; committees use «اعتماد التشكيل وإقفاله»; performance «اعتماد وإقفال
   التقييم النهائي»), and renaming one instance would break consistency and the acceptance e2e.
   **Recommend** the product owner decide whether to disambiguate the approve action (e.g. «اعتماد
   البرنامج (نهائي)») platform-wide.
3. **Email-draft placement.** Email lives on `/documents` per issued document, not on the plan
   report screen. Minor: a principal on the report screen may expect an email option there.
4. **Synthetic-visibility — CLARIFIED/CORRECTED (2026-07-18).** The earlier line "16 synthetic
   programs still visible" was **wrong wording**. Verified read-only against the real DB:
   - **`/plan` shows exactly 26 official programs.** The active year (`1448-1449`) holds 58 programs;
     32 are structurally synthetic (all from «تجريبي» import batches) and excluded, leaving exactly
     **26** on `/plan` — no archive execution required. `SELECT`-only proof recorded below.
   - **No synthetic program is visible in any customer route.** `/plan`, the `/reports/executive`
     content, and `/documents` all apply `notSynthetic(...)` via the central `getExcludedIdSets()`.
     Entity-linked synthetic docs are hidden too: all 25 `performance_report` (→ synthetic
     `perf_session`) and 14 `meeting_minutes` (→ synthetic `meeting`) are excluded.
   - **What is actually visible** in `/documents` and the `/reports/executive` «الإصدارات السابقة»
     list is **16 `executive_report` documents** (KHS-DOC-…) with **`entity_type = NULL`**, all
     issued by the real `principal` against the real active year. They are **not programs** and are
     **not structurally synthetic** (no entity/batch/demo-year anchor; the classifier never flags by
     name/type alone). They are plan-wide report artifacts left over from earlier test runs and are
     out of scope for the structural classifier — only the **manual archive** (deferred by the
     owner) removes them. This is **not** a failure of the centralized program-exclusion guarantee.

   Read-only SQL proof (real DB, no writes):
   ```
   active_year=1448-1449 | programs_in_year=58 | synthetic_in_year=32 | visible_on_/plan=26
   executive_report docs: 16 (entity_type NULL, issued_by principal) — not synthetic, visible
   performance_report docs: 25/25 synthetic → excluded ; meeting_minutes: entity-linked → excluded
   ```
5. **Pre-existing:** Hijri-date header hydration warning (comma placement) — non-failing, noted.

No workflow step was broken; all screens render correctly at 390×844 with zero horizontal
overflow. The walkthrough is read-only/draft; nothing in the official plan was modified.

---

## Operational-plan workflow — FINALIZATION — 2026-07-18

**PASS — workflow validated; the real approval gate is intentionally reserved for the principal.**
The official plan (batch `385c615a`, 26 programs) stays «مسودة»; no program was approved, locked,
reopened, rolled back, or modified. Real DB unchanged (only auth artifacts — login sessions/audit —
from read-only UI verification; every domain table byte-identical to baseline; archive tables 0/0).

Changes landed in this finalization (all covered by tests; `npm test` 127 green, `npm run test:e2e`
39 passed / 1 skipped=C5 on `madrasa_test`; typecheck/lint clean):

1. **Terminology decision applied** (visible copy only; stored status values and permission keys
   unchanged). For an action that both approves and locks: action «اعتماد وإقفال», **status shown
   «معتمد ومقفل» / «معتمدة ومقفلة»**, reopen **«إعادة فتح بسبب موثق»** — standardized across plans
   (`programStatusLabel`), committees (`committeeStatusLabel`), and performance (reopen; models were
   already «معتمدة ومقفلة»). No standalone «إقفال» is used for a combined approve-and-lock action;
   genuine standalone closes (committee «إقفال وأرشفة», year «مقفل») are left as-is. Display helpers:
   `src/lib/plan/status-labels.ts`; unit test `tests/unit/status-labels.test.ts`.
2. **Report actions grouped** on `/plan/[id]/report`: **«طباعة» · «تنزيل Word» · «تنزيل Excel» ·
   «فتح مسودة بريد»** (`report-actions.tsx`). Email reuses the existing **draft-only** workflow
   (M365 draft or `mailto` fallback) on the latest issued report — never sends automatically; if no
   report is issued yet it shows a hint to issue first.
3. **Draft-preview fix** (from the prior turn) committed: draft programs show disabled, labeled
   previews of the weekly-follow-up and change-request forms so the workflow is visible before
   approval — no `<form>`/action, nothing writable.
4. **Synthetic-visibility corrected** (see the section above): `/plan` proven to show exactly the 26
   official programs with no archive execution; the 16 visible items are entity-less
   `executive_report` documents, not programs, and not structurally synthetic.

Tests added (desktop + mobile 390×844): follow-up/change-request previews on the draft program; the
four grouped report actions; and the terminology labels («معتمد ومقفل», «معتمدة ومقفلة», «إعادة فتح
بسبب موثق») after approving a **synthetic test** program in `madrasa_test` (never the official plan).

---

## Committees & Learning Communities — acceptance — 2026-07-18 — STATUS: PASS

**PASS (2026-07-18).** The previously-CONDITIONAL requirements are now implemented, migrated, and
verified (desktop + 390×844), with **all pre-existing domain data proven unchanged** by content
hash. Delivered via migration `0006` (additive/backward-compatible) after an **encrypted,
restore-verified backup** (`restore:rehearsal` passed: 62 tables restored). No real committee was
formed and Fares was not committed.

**New requirements delivered:**
1. **Meeting types (required, Arabic, admin-managed).** New `meeting_types` table seeded with
   «دوري/طارئ/متابعة/ختامي/مجتمع تعلم مهني»; `meetings.type_id` (nullable → existing meetings stay
   valid). New meetings **require** an active type (server-validated). Admin page
   `/committees/meeting-types` to **add / activate / deactivate**; a **used type cannot be deleted**
   (delete blocked when referenced; disable only).
2. **Meeting attachments (multiple, private, categorized).** New `meeting_attachments` table:
   Arabic title, description, **category** (مادة جدول أعمال / مستندات داعمة / مراسلات خارجية / أخرى),
   file (stored `sensitive`, served only via the authenticated files route), and upload date. Listed
   on the meeting page and in the minutes + committee reports.
3. **Results («النتيجة») vs impact («الأثر») — separated.** New `committee_impacts` table: result,
   impact, measurement/indicator, observation date, supporting evidence; **multiple records**,
   optionally linked to a decision (outcome) or action (task). **Meeting completion still requires
   only signed minutes**; **annual closure now requires** at least one documented result+impact.
4. **Integration.** Meeting type, attachments, and results/impact flow into the minutes PDF, the
   committee report (PDF), the committee **Word** and **Excel** exports, print, email-draft, and the
   **AI meeting brief** context. AI may draft impact text via the contextual suggestion
   «أنشئ مسودة أثر لعمل اللجنة» — **draft-only, preview + confirm** through `save_draft` (never writes
   an official record). The **no-attendance / no-quorum** rule is preserved everywhere (schema, UI,
   reports, and the new exports state «لا حضور ولا غياب ولا نصاب»).

**Safety & verification:** encrypted backup + `restore:rehearsal` before migration; migration applied
to **madrasa_test first, then the real dev schema**; new columns nullable/backward-compatible; every
pre-existing domain table's content hash is **identical** pre/post-migration (the only change is the
appended null `type_id`, proven via an existing-columns hash); on the real DB the new tables hold only
the 5 seeded reference types (attachments/impacts = 0, committees = 15 unchanged). `npm test` 131
green (incl. new meeting-type-required + closure-gate integration tests); `npm run test:e2e` 39 passed
/ 1 skipped (C5) — s3 now exercises type + attachment + results/impact; typecheck/lint clean.

---

### First-pass items (delivered earlier the same day)

Real DB used **read-only at 390×844** (Fares not committed, no real committee created or approved —
formation is server-guarded and the buttons are hidden when no employees exist). Full live lifecycle
run in `madrasa_test`. Real DB after: templates 6/6 active, committees=15 (unchanged), 0 committee
report docs, Fares «معاينة», archive 0/0 — only auth artifacts (sessions/audit) changed.

**Business workflow.** Committees are re-formed **annually from official templates** (never copying
prior-year members); members are drawn **only from committed school-employee data**. A committee is
formed → members (chair/secretary/…) added → formation approved-and-locked → meetings held → each
meeting records decisions/recommendations/notes, where **every «قرار» automatically spawns a
mandatory action** and a «توصية» an optional one → official minutes are issued, **signed by chair and
secretary only**, and uploaded; a meeting **cannot complete without the signed minutes** (server-side
hard gate) → the committee report aggregates it all. There is **no attendance, absence, or quorum**
anywhere by design.

**Verified (madrasa_test live + integration):** create-from-template with **no prior-year member
copy** (new committee starts «الأعضاء (0)»); chair/secretary/members; formation approval; meeting with
date/agenda; decision→**mandatory** action (owner+deadline, overdue badge, appears in /tasks +
worklist); the AI action «أنشئ مسودة محضر لهذا الاجتماع» exists and is **draft-only** (`save_draft`,
never writes an official record); issue minutes PDF; upload signed minutes; **hard gate** proven —
«اعتماد الاكتمال» is disabled with «يتطلب رفع المحضر الموقع أولاً» until the signed minutes are up;
chair+secretary-only signature text; **committee report** issued (PDF) with grouped **طباعة / تنزيل
Word / تنزيل Excel / فتح مسودة بريد** (draft-only email). **No attendance/quorum** confirmed in
schema, UI, minutes report, and the new committee Word/Excel exports.

**Genuine gaps fixed (schema-free — real DB untouched):**
1. **Employee-dependency prerequisite.** `/committees` now shows a prerequisite banner «متطلَّب سابق:
   بيانات منسوبي المدرسة» with a link «فتح معاينة دفعة فارس» (→ the real Fares preview `12673bed`) when
   no committed employees exist, and **hides/guards formation** (server guard in
   `createCommitteeFromTemplateAction`/`createPlcAction`; member picker filtered to non-synthetic
   committed people). On the real DB this correctly blocks all formation (0 committed employees).
2. **Official templates enable/disable, never delete.** `/committees/templates` gained a per-template
   «تعطيل/تفعيل القالب» toggle (`committees.approve`) using the existing `active` flag, plus an explicit
   «القوالب الرسمية لا تُحذف نهائياً» note. No delete path exists anywhere.
3. **Committee report.** New `/committees/[id]/report` (+ `committee-report.ts`, `committee-docx`,
   `committee-xlsx` exports) with the grouped report actions; report link added to the committee page.
   `ReportActions` was generalized (`src/components/report-actions.tsx`) and reused by plan + committee.

**Deferred to honor "real DB unchanged" (need an additive migration):** meeting **type** and
**attachments** (step 5) and a per-committee **impact** field (step 13) require new columns; a schema
migration would alter the real DB (the dev server runs on it), so these are **not** applied here.
Recommend running the migration when the principal is ready; the rest of the workflow is validated.

**Gates:** `npm test` 129 green (incl. new committee-prerequisites integration test);
`npm run test:e2e` 39 passed / 1 skipped (C5); typecheck/lint clean.
