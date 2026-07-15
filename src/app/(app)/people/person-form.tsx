"use client";

import { useActionState } from "react";
import { createPersonAction, updatePersonAction, type ActionState } from "./actions";
import { Field, Select, SubmitButton } from "@/components/ui";

type Person = {
  id?: string;
  fullName?: string;
  category?: string;
  jobTitle?: string | null;
  cadre?: string | null;
  employmentStatus?: string | null;
  orgUnit?: string | null;
  jobNumber?: string | null;
  email?: string | null;
};

export function PersonForm({ person }: { person?: Person }) {
  const action = person?.id ? updatePersonAction.bind(null, person.id) : createPersonAction;
  const [state, formAction] = useActionState<ActionState, FormData>(action, null);

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <div role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{state.error}</div>}
      {state?.success && <div role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{state.success}</div>}
      <Field label="الاسم الكامل" name="fullName" defaultValue={person?.fullName} required />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="الفئة"
          name="category"
          required
          defaultValue={person?.category ?? "معلم"}
          options={[
            { value: "معلم", label: "معلم — يتبع التقويم الدراسي" },
            { value: "موظف", label: "موظف — يتبع السنة الميلادية" },
          ]}
        />
        <Field label="الوظيفة" name="jobTitle" defaultValue={person?.jobTitle} />
        <Field label="السلك / الكادر" name="cadre" defaultValue={person?.cadre} />
        <Field label="الحالة الوظيفية" name="employmentStatus" defaultValue={person?.employmentStatus} />
        <Field label="المرحلة / الوحدة التنظيمية" name="orgUnit" defaultValue={person?.orgUnit} />
        <Field label="رقم الوظيفة" name="jobNumber" defaultValue={person?.jobNumber} dir="ltr" />
      </div>
      <Field label="البريد الإلكتروني (اختياري)" name="email" type="email" defaultValue={person?.email} dir="ltr" hint="ملف فارس لا يتضمن بريداً — يضاف يدوياً عند توفره" />
      <SubmitButton>{person?.id ? "حفظ التعديلات" : "إضافة"}</SubmitButton>
    </form>
  );
}
