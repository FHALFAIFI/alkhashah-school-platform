-- v2.6 مراجعة مستقلة (بلوكر §7) — تضييق قادح المخرجات على صفّ ZIP.
--
-- القادح في 0035 سمح لصفّ `zip` بالتعديل والحذف مطلقاً لأن الحزمة تُعاد تجميعاً عند وصول
-- النسخة الموقّعة (D-060). لكن «مطلقاً» أوسع من الحاجة: صفّ ZIP يجوز أن **يستبدل ملفه**
-- (`file_id`, `checksum`, `size`, `created_at`) ولا يجوز أن يتحوّل إلى صيغة أخرى ولا أن
-- ينتقل إلى تقرير آخر ولا أن يغيّر معرّفه. هذه الهجرة تحصر المسموح في تلك الأعمدة الأربعة.
--
-- الحذف يبقى مسموحاً لصفّ ZIP وحده: إزالة الحزمة القديمة لحظة ربط نسخة موقّعة جديدة هي
-- ما يمنع بقاء حزمة ناقصة قابلة للتنزيل (بلوكر §6) — وغيابها حالة صريحة تقول «لم تُجمَّع بعد».
--
-- متكرّرة التنفيذ بأمان: `CREATE OR REPLACE` وحدها، بلا كتابة صفّ ولا حذفه.

CREATE OR REPLACE FUNCTION report_output_guard() RETURNS trigger AS $$
DECLARE
  instance_status text;
BEGIN
  SELECT status INTO instance_status FROM report_instances WHERE id = OLD.instance_id;
  -- حذف التقرير المسودة نفسه يتتالى إلى مخرجاته — القادح على الأصل هو الحارس هناك،
  -- وصفّ الأصل يكون قد حُذف لحظة التتالي فلا حالة تُقرأ.
  IF instance_status IS NULL OR instance_status = 'مسودة' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF OLD.format = 'zip' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    -- الاستبدال المسموح: الملف وبصمته وحجمه ووقته فقط — لا الهوية ولا الصيغة ولا التقرير
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.instance_id IS DISTINCT FROM OLD.instance_id
       OR NEW.format IS DISTINCT FROM OLD.format THEN
      RAISE EXCEPTION 'D-060: صفّ الحزمة يستبدل ملفه فقط — لا هويته ولا صيغته ولا تقريره'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'D-055/D-060: مخرجات التقرير المعتمد محفوظة — لا تعديل ولا حذف لصيغة «%»', OLD.format
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
