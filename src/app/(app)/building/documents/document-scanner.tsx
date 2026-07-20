"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Page = { id: string; dataUrl: string; rotation: number };
type TargetOption = { value: string; label: string };

/**
 * ماسح المستندات (Phase 4): يفتح كاميرا الجوال (يتطلب سياقاً آمناً HTTPS عبر Tailscale)،
 * يلتقط عدة صفحات، يتيح إعادة الالتقاط والترتيب والتدوير وتحسين الوضوح، ثم يبني PDF واحداً
 * ويرفعه ليُرفَق بكيان المبنى. عند تعذّر الكاميرا يوفّر رفع ملف بديلاً. لا إرسال خارجي.
 */
export function DocumentScanner({
  csrfToken,
  targetTypes,
  floors,
  rooms,
  assets,
}: {
  csrfToken: string;
  targetTypes: { value: string; label: string }[];
  floors: TargetOption[];
  rooms: TargetOption[];
  assets: TargetOption[];
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [enhance, setEnhance] = useState(true);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [targetType, setTargetType] = useState(targetTypes[0]?.value ?? "building");
  const [entityId, setEntityId] = useState("");
  const [sensitive, setSensitive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const entityOptions = targetType === "floor" ? floors : targetType === "room" ? rooms : targetType === "asset" ? assets : [];
  const needsEntity = targetType !== "building";

  async function startCamera() {
    setCameraError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("الكاميرا غير متاحة في هذا المتصفح — استخدم رفع ملف. (تتطلب الكاميرا اتصالاً آمناً HTTPS عبر Tailscale)");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch {
      setCameraError("تعذّر فتح الكاميرا (قد يكون الإذن مرفوضاً أو الاتصال غير آمن). استخدم رفع ملف بدلاً من الكاميرا.");
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  function enhanceCanvas(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    const contrast = 1.25;
    for (let i = 0; i < d.length; i += 4) {
      const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const adj = Math.min(255, Math.max(0, (gray - 128) * contrast + 128));
      d[i] = d[i + 1] = d[i + 2] = adj;
    }
    ctx.putImageData(img, 0, 0);
  }

  function capturePage() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    if (enhance) enhanceCanvas(ctx, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    setPages((p) => [...p, { id: crypto.randomUUID(), dataUrl, rotation: 0 }]);
  }

  function rotatePage(id: string) {
    setPages((p) => p.map((pg) => (pg.id === id ? { ...pg, rotation: (pg.rotation + 90) % 360 } : pg)));
  }
  function removePage(id: string) {
    setPages((p) => p.filter((pg) => pg.id !== id));
  }
  function movePage(id: string, dir: -1 | 1) {
    setPages((p) => {
      const i = p.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= p.length) return p;
      const copy = [...p];
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  }

  // يطبّق التدوير وينتج data URL نهائية لكل صفحة
  async function renderPage(pg: Page): Promise<string> {
    if (pg.rotation === 0) return pg.dataUrl;
    return new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        const canvas = document.createElement("canvas");
        const swap = pg.rotation === 90 || pg.rotation === 270;
        canvas.width = swap ? im.height : im.width;
        canvas.height = swap ? im.width : im.height;
        const ctx = canvas.getContext("2d")!;
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((pg.rotation * Math.PI) / 180);
        ctx.drawImage(im, -im.width / 2, -im.height / 2);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      im.src = pg.dataUrl;
    });
  }

  function validate(): string | null {
    if (!title.trim()) return "أدخل عنوان المستند";
    if (needsEntity && !entityId) return "اختر الكيان الذي يُرفق به المستند";
    return null;
  }

  async function submitScanned() {
    const err = validate();
    if (err) return setMessage({ ok: false, text: err });
    if (pages.length === 0) return setMessage({ ok: false, text: "التقط صفحة واحدة على الأقل" });
    setBusy(true);
    setMessage(null);
    try {
      const rendered = await Promise.all(pages.map(renderPage));
      const res = await fetch("/api/building/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
        body: JSON.stringify({ pages: rendered, title, category, targetType, entityId: needsEntity ? entityId : "building", sensitive }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "فشل الحفظ");
      stopCamera();
      setPages([]);
      setTitle("");
      setMessage({ ok: true, text: `أُنشئ المستند «${json.title}» وأُرفق بنجاح` });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "تعذّر إنشاء الملف" });
    } finally {
      setBusy(false);
    }
  }

  async function submitUpload() {
    const err = validate();
    if (err) return setMessage({ ok: false, text: err });
    const file = fileInputRef.current?.files?.[0];
    if (!file) return setMessage({ ok: false, text: "اختر ملفاً" });
    setBusy(true);
    setMessage(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("title", title);
      fd.set("category", category);
      fd.set("targetType", targetType);
      fd.set("entityId", needsEntity ? entityId : "building");
      fd.set("sensitive", String(sensitive));
      const res = await fetch("/api/building/scan", { method: "POST", headers: { "x-csrf-token": csrfToken }, body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "فشل الرفع");
      if (fileInputRef.current) fileInputRef.current.value = "";
      setTitle("");
      setMessage({ ok: true, text: `أُرفق المستند «${json.title}» بنجاح` });
      router.refresh();
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : "تعذّر الرفع" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {message && (
        <div role={message.ok ? "status" : "alert"} className={`rounded-lg p-3 text-sm ${message.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {message.text}
        </div>
      )}

      {/* بيانات المستند والوجهة */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">عنوان المستند</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="مثال: شهادة صيانة المصعد" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">التصنيف (اختياري)</span>
          <input value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="عقد، شهادة، فاتورة…" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium text-gray-700">يُرفق بـ</span>
          <select value={targetType} onChange={(e) => { setTargetType(e.target.value); setEntityId(""); }} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
            {targetTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        {needsEntity && (
          <label className="text-sm">
            <span className="mb-1 block font-medium text-gray-700">اختر العنصر</span>
            <select value={entityId} onChange={(e) => setEntityId(e.target.value)} className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm">
              <option value="">— اختر —</option>
              {entityOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} />
        مستند حساس/خاص — التنزيل للمصرّح لهم فقط
      </label>

      {/* الكاميرا */}
      <div className="rounded-xl border border-sand-200 bg-white p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {!cameraOn ? (
            <button type="button" onClick={startCamera} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">مسح مستند (الكاميرا)</button>
          ) : (
            <>
              <button type="button" onClick={capturePage} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">التقاط صفحة</button>
              <button type="button" onClick={stopCamera} className="rounded-lg border border-sand-200 px-3 py-2 text-sm">إيقاف الكاميرا</button>
            </>
          )}
          <label className="flex items-center gap-1 text-xs text-gray-600">
            <input type="checkbox" checked={enhance} onChange={(e) => setEnhance(e.target.checked)} /> تحسين الوضوح (تدرّج رمادي وتباين)
          </label>
        </div>
        {cameraError && <p className="mb-2 text-xs text-amber-700">{cameraError}</p>}
        <video ref={videoRef} className={`w-full rounded-lg bg-black ${cameraOn ? "" : "hidden"}`} muted playsInline />
      </div>

      {/* الصفحات الملتقطة */}
      {pages.length > 0 && (
        <div className="rounded-xl border border-sand-200 bg-white p-3">
          <h3 className="mb-2 text-sm font-bold text-gray-700">الصفحات ({pages.length}) — رتّبها ودوّرها قبل الإنشاء</h3>
          <div className="flex flex-wrap gap-3">
            {pages.map((pg, i) => (
              <div key={pg.id} className="w-28">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pg.dataUrl} alt={`صفحة ${i + 1}`} style={{ transform: `rotate(${pg.rotation}deg)` }} className="h-32 w-28 rounded border border-sand-200 object-cover" />
                <div className="mt-1 flex flex-wrap gap-1 text-[11px]">
                  <button type="button" onClick={() => movePage(pg.id, -1)} className="rounded border px-1" aria-label="لليمين">◀</button>
                  <button type="button" onClick={() => movePage(pg.id, 1)} className="rounded border px-1" aria-label="لليسار">▶</button>
                  <button type="button" onClick={() => rotatePage(pg.id)} className="rounded border px-1">تدوير</button>
                  <button type="button" onClick={() => removePage(pg.id)} className="rounded border border-red-300 px-1 text-red-700">إعادة الالتقاط</button>
                </div>
              </div>
            ))}
          </div>
          <button type="button" onClick={submitScanned} disabled={busy} className="mt-3 rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "جارٍ الإنشاء…" : "إنشاء ملف PDF وحفظ وإرفاق"}
          </button>
        </div>
      )}

      {/* بديل الرفع */}
      <details className="rounded-xl border border-sand-200 bg-white p-3">
        <summary className="cursor-pointer text-sm font-medium text-brand-800">رفع ملف بدلاً من استخدام الكاميرا</summary>
        <div className="mt-3 space-y-2">
          <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="text-sm" />
          <p className="text-xs text-gray-500">ارفع صورة (تُحوَّل إلى PDF) أو ملف PDF جاهز.</p>
          <button type="button" onClick={submitUpload} disabled={busy} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {busy ? "جارٍ الرفع…" : "حفظ وإرفاق الملف المرفوع"}
          </button>
        </div>
      </details>
    </div>
  );
}
