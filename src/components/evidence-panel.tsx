"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createEvidenceAction,
  linkEvidenceAction,
  searchEvidenceLibraryAction,
  unlinkEvidenceAction,
  type ActionState,
  type EvidenceCandidate,
} from "@/app/(app)/evidence/actions";
import { Card, Field, SubmitButton, Badge } from "@/components/ui";

const ROLES = ["خط أساس", "تنفيذ", "مخرج", "أثر", "خارجي"];

export function EvidencePanel({
  entityType,
  entityId,
  items,
  canWrite,
  subKeys,
  subKeyLabel = "الربط الفرعي",
  subKeyRequired = false,
}: {
  entityType: string;
  entityId: string;
  items: { id: string; title: string; kind: string; role: string | null; fileId: string | null; subKey?: string | null }[];
  canWrite: boolean;
  /** خيارات المفتاح الفرعي (مثل مؤشرات النموذج) — عند تمريرها يظهر حقل اختيار في نموذج الإضافة */
  subKeys?: { value: string; label: string }[];
  subKeyLabel?: string;
  subKeyRequired?: boolean;
}) {
  const subKeyName = new Map((subKeys ?? []).map((s) => [s.value, s.label]));
  const router = useRouter();
  const [state, formAction] = useActionState<ActionState, FormData>(createEvidenceAction, null);
  const [kind, setKind] = useState("file");
  const [showForm, setShowForm] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);
  const [, startTransition] = useTransition();

  // مكتبة الشواهد — ربط شاهد مرفوع سابقاً بدل رفع نسخة ثانية منه
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<EvidenceCandidate[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [librarySubKey, setLibrarySubKey] = useState("");

  // بعد نجاح الحفظ: حدّث بيانات الخادم (العدّاد والقائمة والعبارة الفعلية) فوراً دون مغادرة الصفحة
  // (revalidatePath وحده لا يضمن انعكاساً فورياً في كل الحالات — router.refresh يعيد جلب مكوّن الخادم).
  useEffect(() => {
    if (state?.success) router.refresh();
  }, [state, router]);

  function runSearch(q: string) {
    startTransition(async () => {
      setSearching(true);
      try {
        setCandidates(await searchEvidenceLibraryAction(entityType, entityId, q));
      } finally {
        setSearching(false);
      }
    });
  }

  function linkExisting(evidenceId: string) {
    startTransition(async () => {
      setNotice(null);
      const fd = new FormData();
      fd.set("evidenceId", evidenceId);
      fd.set("entityType", entityType);
      fd.set("entityId", entityId);
      fd.set("subKey", librarySubKey);
      const res = await linkEvidenceAction(null, fd);
      if (res?.error) setNotice({ kind: "error", text: res.error });
      else {
        setNotice({ kind: "ok", text: res?.success ?? "تم الربط" });
        runSearch(query);
        router.refresh(); // تحديث العدّاد والقائمة بعد الربط
      }
    });
  }

  function unlink(evidenceId: string, subKey: string | null | undefined) {
    startTransition(async () => {
      setNotice(null);
      const fd = new FormData();
      fd.set("evidenceId", evidenceId);
      fd.set("entityType", entityType);
      fd.set("entityId", entityId);
      fd.set("subKey", subKey ?? "");
      const res = await unlinkEvidenceAction(null, fd);
      if (res?.error) setNotice({ kind: "error", text: res.error });
      else {
        setNotice({ kind: "ok", text: res?.success ?? "فُك الربط" });
        router.refresh(); // تحديث العدّاد والقائمة بعد فك الربط
      }
    });
  }

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-bold text-brand-900">الشواهد المرتبطة ({items.length})</h2>
        {canWrite && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => {
                const next = !showLibrary;
                setShowLibrary(next);
                if (next && candidates === null) runSearch("");
              }}
              className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 lg:min-h-0"
            >
              {showLibrary ? "إغلاق المكتبة" : "ربط شاهد قائم"}
            </button>
            <button
              onClick={() => setShowForm(!showForm)}
              className="min-h-11 rounded-lg border border-sand-200 px-3 py-1.5 text-sm hover:bg-sand-100 lg:min-h-0"
            >
              {showForm ? "إغلاق" : "رفع شاهد جديد"}
            </button>
          </div>
        )}
      </div>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={`mb-2 rounded p-2 text-xs ${notice.kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}
        >
          {notice.text}
        </div>
      )}

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 rounded-lg border border-sand-100 px-3 py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{item.title}</span>
              {item.role && <Badge value={item.role} />}
              {item.subKey && subKeyName.has(item.subKey) && (
                <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">{subKeyName.get(item.subKey)}</span>
              )}
              <span className="text-xs text-gray-400">{item.kind === "file" ? "ملف" : item.kind === "link" ? "رابط" : "نص"}</span>
            </div>
            <div className="flex items-center gap-2">
              {item.fileId && (
                <a href={`/api/files/${item.fileId}`} className="text-xs text-brand-700 underline">تنزيل</a>
              )}
              {canWrite && (
                // فك الربط لا يحذف الشاهد: يبقى في المكتبة وتبقى بقية السجلات المرتبطة به سليمة
                <button
                  onClick={() => unlink(item.id, item.subKey)}
                  className="text-xs text-red-500 hover:underline"
                  title="يزيل ربط الشاهد بهذا السجل فقط — الشاهد يبقى في مكتبة الشواهد"
                >
                  فك الربط
                </button>
              )}
            </div>
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-gray-400">لا شواهد بعد</li>}
      </ul>

      {showLibrary && canWrite && (
        <div className="mt-4 space-y-3 rounded-lg bg-brand-50/60 p-3">
          <p className="text-xs text-brand-900">
            ابحث في مكتبة الشواهد واربط شاهداً مرفوعاً سابقاً بهذا السجل — لا حاجة لرفع الملف مرة أخرى.
          </p>
          {subKeys && subKeys.length > 0 && (
            <div>
              <label htmlFor="librarySubKey" className="mb-1 block text-sm font-medium text-gray-700">{subKeyLabel}</label>
              <select
                id="librarySubKey"
                value={librarySubKey}
                onChange={(e) => setLibrarySubKey(e.target.value)}
                className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
              >
                {!subKeyRequired && <option value="">— عام (بلا ربط فرعي) —</option>}
                {subKeys.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runSearch(query);
                }
              }}
              placeholder="ابحث بعنوان الشاهد"
              aria-label="ابحث في مكتبة الشواهد"
              className="min-h-11 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm lg:min-h-0"
            />
            <button
              onClick={() => runSearch(query)}
              className="min-h-11 rounded-lg border border-sand-200 bg-white px-3 py-2 text-sm hover:bg-sand-100 lg:min-h-0"
            >
              بحث
            </button>
          </div>
          {searching && <p className="text-xs text-gray-500">جارٍ البحث…</p>}
          {!searching && candidates?.length === 0 && (
            <p className="text-xs text-gray-500">لا شواهد مطابقة في المكتبة — ارفع شاهداً جديداً.</p>
          )}
          <ul className="space-y-2">
            {(candidates ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sand-100 bg-white px-3 py-2 text-sm">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{c.title}</span>
                  {c.role && <Badge value={c.role} />}
                  {c.linkCount > 0 && (
                    <span className="rounded bg-sand-100 px-1.5 py-0.5 text-xs text-gray-600">
                      مستخدم في {c.linkCount} سجلاً
                    </span>
                  )}
                </span>
                {c.alreadyLinked ? (
                  <span className="text-xs text-emerald-700">مرتبط بهذا السجل</span>
                ) : (
                  <button onClick={() => linkExisting(c.id)} className="text-xs text-brand-700 underline">
                    ربط بهذا السجل
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {showForm && canWrite && (
        // إعادة تركيب النموذج بعد كل إضافة: تصفير النموذج التلقائي في React يلغي تحديد
        // أزرار «نوع الشاهد» في DOM رغم بقاء الحالة، فيرسل الحفظ التالي «ملف» خطأً
        <form key={items.length} action={formAction} className="mt-4 space-y-3 rounded-lg bg-sand-50 p-3">
          {state?.error && <div role="alert" className="rounded bg-red-50 p-2 text-xs text-red-700">{state.error}</div>}
          {state?.success && <div role="status" className="rounded bg-emerald-50 p-2 text-xs text-emerald-700">{state.success}</div>}
          <input type="hidden" name="entityType" value={entityType} />
          <input type="hidden" name="entityId" value={entityId} />
          {subKeys && subKeys.length > 0 && (
            <div>
              <label htmlFor="subKey" className="mb-1 block text-sm font-medium text-gray-700">
                {subKeyLabel}
                {subKeyRequired && <span className="text-red-500"> *</span>}
              </label>
              <select
                id="subKey"
                name="subKey"
                required={subKeyRequired}
                className="min-h-11 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm lg:min-h-0"
              >
                {!subKeyRequired && <option value="">— عام (بلا ربط فرعي) —</option>}
                {subKeys.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="عنوان الشاهد" name="title" required />
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">دور الشاهد</label>
              <select name="role" className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">— بدون —</option>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">نوع الشاهد</label>
            <div className="flex gap-3 text-sm">
              {[["file", "ملف"], ["link", "رابط"], ["text", "نص"]].map(([v, l]) => (
                <label key={v} className="flex items-center gap-1">
                  <input type="radio" name="kind" value={v} checked={kind === v} onChange={() => setKind(v)} />
                  {l}
                </label>
              ))}
            </div>
          </div>
          {kind === "file" && (
            <input name="file" type="file" className="w-full rounded-lg border border-dashed border-gray-300 p-3 text-sm" />
          )}
          {kind === "link" && <Field label="الرابط" name="url" dir="ltr" placeholder="https://..." />}
          {kind === "text" && (
            <textarea name="textContent" rows={3} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="نص الشاهد" />
          )}
          <Field label="وصف مختصر" name="description" />
          <SubmitButton>حفظ الشاهد</SubmitButton>
        </form>
      )}
    </Card>
  );
}
