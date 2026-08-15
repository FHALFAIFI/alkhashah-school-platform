-- v2.6 §B (D-055/D-060) — ثبات التقارير المعتمدة مفروضاً في القاعدة نفسها.
--
-- لماذا قادح لا فحص خدمة فقط: اشتراط النطاق أن «التقرير النهائي لقطة حقيقية لا تتغير
-- بتغيّر البيانات» يجب أن يصمد أمام شيفرة تطبيق لاحقة ومهام خلفية وتتاليات حذف وهجرات
-- قادمة — لا أمام مسار الخدمة الحالي وحده. القادح يرفض على مستوى Postgres أي تعديل
-- لمحتوى تقرير ليس «مسودة» وأي حذف له، فيتساوى أمامه كل من يصل إلى القاعدة.
--
-- المسموح بعد الاعتماد ثلاثة لا غير:
--   1. تحويل الأرشفة («نهائي» ⇄ «مؤرشف») مع عمودي الأرشفة — الأرشفة لا تغيّر المحتوى؛
--   2. مرجع النسخة الموقّعة (`signed_copy_file_id`) — تصل بعد التوقيع الخارجي (§B)؛
--   3. بيانات المحدِّث (`updated_at`/`updated_by`).
-- والعودة إلى «مسودة» ممنوعة بالبناء: التعديل الوحيد المقبول للحالة هو بين النهائي
-- والمؤرشف.
--
-- المخرجات المحفوظة كذلك: لا تعديل ولا حذف لمخرج تقرير معتمد — عدا صيغة `zip` وحدها،
-- لأنها تُعاد تجميعاً من الأجزاء المحفوظة عند وصول النسخة الموقّعة (D-060).
--
-- الهجرة **متكرّرة التنفيذ بأمان**: `CREATE OR REPLACE FUNCTION` و`DROP TRIGGER IF
-- EXISTS` قبل كل إنشاء، و`IF NOT EXISTS` للفهرس. لا صفّ يُكتب أو يُحذف.

CREATE OR REPLACE FUNCTION report_instance_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'مسودة' THEN
      RAISE EXCEPTION 'D-055: لا يُحذف تقرير ليس مسودة (%)', OLD.status
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.status = 'مسودة' THEN
    RETURN NEW;
  END IF;

  -- الحالة: الانتقال المسموح الوحيد بين «نهائي» و«مؤرشف»
  IF NEW.status NOT IN ('نهائي', 'مؤرشف') THEN
    RAISE EXCEPTION 'D-055: لا يعود تقرير معتمد إلى «%»', NEW.status
      USING ERRCODE = 'restrict_violation';
  END IF;

  -- أعمدة المحتوى المجمّدة — أي تغيير فيها مرفوض
  IF NEW.title IS DISTINCT FROM OLD.title
     OR NEW.type_key IS DISTINCT FROM OLD.type_key
     OR NEW.report_number IS DISTINCT FROM OLD.report_number
     OR NEW.version_of_id IS DISTINCT FROM OLD.version_of_id
     OR NEW.filters IS DISTINCT FROM OLD.filters
     OR NEW.options IS DISTINCT FROM OLD.options
     OR NEW.period_from IS DISTINCT FROM OLD.period_from
     OR NEW.period_to IS DISTINCT FROM OLD.period_to
     OR NEW.snapshot IS DISTINCT FROM OLD.snapshot
     OR NEW.sensitive IS DISTINCT FROM OLD.sensitive
     OR NEW.finalized_at IS DISTINCT FROM OLD.finalized_at
     OR NEW.finalized_by IS DISTINCT FROM OLD.finalized_by
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'D-055: محتوى التقرير المعتمد «%» مجمّد ولا يُعدَّل', OLD.report_number
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS report_instances_immutable ON "report_instances";--> statement-breakpoint
CREATE TRIGGER report_instances_immutable
  BEFORE UPDATE OR DELETE ON "report_instances"
  FOR EACH ROW EXECUTE FUNCTION report_instance_guard();--> statement-breakpoint

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
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'D-055/D-060: مخرجات التقرير المعتمد محفوظة — لا تعديل ولا حذف لصيغة «%»', OLD.format
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS report_outputs_immutable ON "report_outputs";--> statement-breakpoint
CREATE TRIGGER report_outputs_immutable
  BEFORE UPDATE OR DELETE ON "report_outputs"
  FOR EACH ROW EXECUTE FUNCTION report_output_guard();--> statement-breakpoint

-- مهمة توليد نشطة واحدة لكل تقرير (D-059) — التزامن يفشل مبكراً بدل أن يتسابق
CREATE UNIQUE INDEX IF NOT EXISTS "report_jobs_one_active_unique"
  ON "report_jobs" ("instance_id")
  WHERE "status" IN ('قيد الانتظار', 'قيد التنفيذ');
