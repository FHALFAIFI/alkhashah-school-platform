"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * الفحص دون اتصال: IndexedDB لتخزين بيانات الغرف والقوالب وطابور العمليات،
 * ومزامنة idempotent عبر معرف عملية فريد لكل فحص (لا تكرار عند إعادة الإرسال).
 */

type OfflineData = {
  floors: { id: string; key: string; nameAr: string }[];
  rooms: { id: string; floorId: string; code: string; nameAr: string; roomType: string }[];
  templates: { id: string; nameAr: string; roomType: string | null; items: { key: string; label: string; required: boolean }[] }[];
  csrfToken: string;
};

type QueuedOp = {
  clientOpId: string;
  roomId: string;
  roomName: string;
  templateId: string;
  inspectedAt: string;
  results: { key: string; ok: boolean; note?: string }[];
  notes?: string;
  photosBase64: { name: string; mime: string; data: string }[];
};

const DB_NAME = "madrasa-offline";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("data")) db.createObjectStore("data");
      if (!db.objectStoreNames.contains("queue")) db.createObjectStore("queue", { keyPath: "clientOpId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(store: string, value: unknown, key?: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

async function idbAll<T>(store: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function OfflineInspection() {
  const [online, setOnline] = useState(() => (typeof navigator !== "undefined" ? navigator.onLine : true));
  const [data, setData] = useState<OfflineData | null>(null);
  const [queue, setQueue] = useState<QueuedOp[]>([]);
  const [roomId, setRoomId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // تسجيل عامل الخدمة
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const loadLocal = useCallback(async () => {
    const stored = await idbGet<OfflineData>("data", "offline-data");
    if (stored) setData(stored);
    setQueue(await idbAll<QueuedOp>("queue"));
  }, []);

  useEffect(() => {
    // قراءة IndexedDB غير متزامنة — التحديث يحدث بعد await وليس تزامنياً
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLocal();
  }, [loadLocal]);

  const download = async () => {
    setMessage(null);
    try {
      const res = await fetch("/api/sync/offline-data");
      if (!res.ok) throw new Error("فشل التحميل");
      const json: OfflineData = await res.json();
      await idbPut("data", json, "offline-data");
      setData(json);
      setMessage("حملت البيانات — يمكنك الآن الفحص دون اتصال");
    } catch {
      setMessage("تعذر تحميل البيانات — تأكد من الاتصال");
    }
  };

  const sync = useCallback(async () => {
    if (!data || queue.length === 0) return;
    setSyncing(true);
    setMessage(null);
    try {
      const res = await fetch("/api/sync/inspections", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": data.csrfToken },
        body: JSON.stringify({
          ops: queue.map((q) => ({
            clientOpId: q.clientOpId,
            roomId: q.roomId,
            templateId: q.templateId,
            inspectedAt: q.inspectedAt,
            results: q.results,
            notes: q.notes,
            photosBase64: q.photosBase64,
          })),
        }),
      });
      if (!res.ok) throw new Error("فشل");
      const result: { applied: string[]; skipped: string[]; failed: { clientOpId: string; error: string }[] } = await res.json();
      for (const id of [...result.applied, ...result.skipped]) {
        await idbDelete("queue", id);
      }
      setQueue(await idbAll<QueuedOp>("queue"));
      setMessage(
        `تمت المزامنة: ${result.applied.length} فحصاً جديداً` +
          (result.skipped.length ? `، ${result.skipped.length} كان مزامناً مسبقاً (لا تكرار)` : "") +
          (result.failed.length ? `، ${result.failed.length} فشل` : ""),
      );
    } catch {
      setMessage("تعذرت المزامنة — ستبقى الفحوصات في الطابور المحلي");
    } finally {
      setSyncing(false);
    }
  }, [data, queue]);

  const template = data?.templates.find((t) => t.id === templateId);
  const room = data?.rooms.find((r) => r.id === roomId);
  const availableTemplates = data?.templates.filter((t) => !t.roomType || t.roomType === room?.roomType) ?? [];

  const submitOffline = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!template || !room) return;
    const form = new FormData(e.currentTarget);
    const photosBase64: QueuedOp["photosBase64"] = [];
    const photo = form.get("photo") as File | null;
    if (photo && photo.size > 0 && photo.size < 4 * 1024 * 1024) {
      const buf = await photo.arrayBuffer();
      let binary = "";
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      photosBase64.push({ name: photo.name, mime: photo.type || "image/jpeg", data: btoa(binary) });
    }
    const op: QueuedOp = {
      clientOpId: crypto.randomUUID(),
      roomId: room.id,
      roomName: room.nameAr,
      templateId: template.id,
      inspectedAt: new Date().toISOString(),
      results: template.items.map((item) => ({
        key: item.key,
        ok: form.get(`item_${item.key}`) === "ok",
        note: String(form.get(`note_${item.key}`) ?? "") || undefined,
      })),
      notes: String(form.get("notes") ?? "") || undefined,
      photosBase64,
    };
    await idbPut("queue", op);
    setQueue(await idbAll<QueuedOp>("queue"));
    setMessage(`سجل فحص «${room.nameAr}» في الطابور المحلي${online ? " — يمكنك المزامنة الآن" : " — سيزامن عند عودة الاتصال"}`);
    e.currentTarget.reset();
  };

  return (
    <div className="space-y-4">
      <div className={`rounded-xl border p-3 text-sm ${online ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
        {online ? "متصل بالشبكة" : "دون اتصال — الفحص متاح والتغييرات تحفظ محلياً"}
      </div>

      {message && <div role="status" className="rounded-xl bg-brand-50 p-3 text-sm text-brand-900">{message}</div>}

      <div className="flex flex-wrap gap-2">
        <button onClick={download} disabled={!online} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          تحميل بيانات الغرف والقوالب (وأنت متصل)
        </button>
        <button onClick={sync} disabled={!online || queue.length === 0 || syncing} className="rounded-lg border border-brand-300 px-4 py-2 text-sm font-medium text-brand-800 disabled:opacity-50">
          {syncing ? "جارٍ المزامنة…" : `مزامنة الطابور (${queue.length})`}
        </button>
      </div>

      {queue.length > 0 && (
        <div className="rounded-xl border border-sand-200 bg-white p-3 text-sm">
          <h2 className="mb-2 font-bold text-gray-700">الطابور المحلي ({queue.length})</h2>
          <ul className="space-y-1 text-xs text-gray-500">
            {queue.map((q) => (
              <li key={q.clientOpId}>
                {q.roomName} — {new Date(q.inspectedAt).toLocaleString("ar-SA-u-nu-latn")}
                {q.photosBase64.length > 0 && ` — ${q.photosBase64.length} صورة`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!data ? (
        <p className="text-sm text-gray-400">حمل البيانات أولاً لبدء الفحص</p>
      ) : (
        <form onSubmit={submitOffline} className="space-y-3 rounded-xl border border-sand-200 bg-white p-4">
          <div className="flex flex-wrap gap-3">
            <div className="min-w-56 flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">الغرفة (أو امسح رمزها)</label>
              <select value={roomId} onChange={(e) => { setRoomId(e.target.value); setTemplateId(""); }} required className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">— اختر —</option>
                {data.rooms.map((r) => (
                  <option key={r.id} value={r.id}>{r.nameAr} ({r.code})</option>
                ))}
              </select>
            </div>
            <div className="min-w-56 flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">قالب الفحص</label>
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} required className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
                <option value="">— اختر —</option>
                {availableTemplates.map((t) => (
                  <option key={t.id} value={t.id}>{t.nameAr}</option>
                ))}
              </select>
            </div>
          </div>
          {template && (
            <div className="space-y-2">
              {template.items.map((item) => (
                <div key={item.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-sand-200 px-3 py-2 text-sm">
                  <span className="min-w-40 flex-1">{item.label}</span>
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`item_${item.key}`} value="ok" defaultChecked />
                    سليم
                  </label>
                  <label className="flex items-center gap-1">
                    <input type="radio" name={`item_${item.key}`} value="not_ok" />
                    يحتاج معالجة
                  </label>
                  <input name={`note_${item.key}`} placeholder="ملاحظة" className="w-36 rounded border border-gray-300 px-2 py-1 text-xs" />
                </div>
              ))}
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1">
                  <label className="mb-1 block text-sm font-medium text-gray-700">ملاحظات</label>
                  <input name="notes" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">صورة (اختياري)</label>
                  <input name="photo" type="file" accept="image/*" className="text-sm" />
                  <p className="mt-1 text-xs text-gray-400">التقط صورة أو اختر ملفاً من الجهاز</p>
                </div>
              </div>
              <button type="submit" className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">
                حفظ الفحص في الطابور المحلي
              </button>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
