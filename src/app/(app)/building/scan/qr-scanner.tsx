"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { resolveScanAction, type ScanResolution } from "../scan-actions";

/**
 * ماسح رمز QP (Phase 5): يستخدم BarcodeDetector عند توفّره (سياق آمن HTTPS)، وإلا يعتمد على
 * الإدخال اليدوي. المسح قراءة فقط — لا كتابة. النتيجة تعرض إجراءات (فتح/بدء فحص/بلاغ صيانة)
 * كروابط، فلا يحدث أي تعديل بمجرد المسح.
 */

type BarcodeDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};
type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => BarcodeDetectorLike;

export function QrScanner() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const loopRef = useRef<number | null>(null);

  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResolution | null>(null);

  function stop() {
    if (loopRef.current) cancelAnimationFrame(loopRef.current);
    loopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setScanning(false);
  }

  async function resolve(raw: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await resolveScanAction(raw);
      setResult(res);
      if (!res.ok) setError(res.error);
      else stop();
    } catch {
      setError("تعذّر الاتصال — حاول مجدداً");
    } finally {
      setBusy(false);
    }
  }

  async function startCamera() {
    setError(null);
    setResult(null);
    const Ctor = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!Ctor) {
      setError("قارئ رموز QR غير مدعوم في هذا المتصفح — أدخل الرمز يدوياً. (يتطلب المسح اتصالاً آمناً HTTPS عبر Tailscale ومتصفحاً حديثاً)");
      return;
    }
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("الكاميرا غير متاحة — أدخل الرمز يدوياً.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      const detector = new Ctor({ formats: ["qr_code"] });
      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        try {
          const codes = await detector.detect(videoRef.current);
          if (codes.length > 0 && codes[0].rawValue) {
            await resolve(codes[0].rawValue);
            return;
          }
        } catch {
          // تجاهل إطاراً واحداً وواصل
        }
        loopRef.current = requestAnimationFrame(tick);
      };
      loopRef.current = requestAnimationFrame(tick);
    } catch {
      setError("تعذّر فتح الكاميرا (قد يكون الإذن مرفوضاً أو الاتصال غير آمن). أدخل الرمز يدوياً.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {!scanning ? (
          <>
            <button type="button" onClick={startCamera} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">مسح رمز غرفة</button>
            <button type="button" onClick={startCamera} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white">مسح رمز أصل</button>
          </>
        ) : (
          <button type="button" onClick={stop} className="rounded-lg border border-sand-200 px-4 py-2 text-sm">إيقاف المسح</button>
        )}
      </div>

      {error && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{error}</div>}

      <video ref={videoRef} className={`w-full max-w-sm rounded-lg bg-black ${scanning ? "" : "hidden"}`} muted playsInline />

      {/* إدخال يدوي */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) void resolve(manual.trim());
        }}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-sand-200 bg-white p-3"
      >
        <label className="flex-1 text-sm">
          <span className="mb-1 block font-medium text-gray-700">إدخال الرمز يدوياً</span>
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="KHS-RM-0001 أو KHS-AST-0001" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" dir="ltr" />
        </label>
        <button type="submit" disabled={busy} className="rounded-lg bg-brand-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">بحث</button>
      </form>

      {/* النتيجة */}
      {result?.ok && result.kind === "room" && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="font-bold text-emerald-900">غرفة: {result.nameAr} <span className="text-xs text-emerald-700" dir="ltr">({result.code})</span></p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/building/rooms/${result.id}`} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">فتح الغرفة</Link>
            {result.canInspect && <Link href={`/building/rooms/${result.id}#inspection`} className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm text-brand-800">بدء فحص</Link>}
            {result.canMaintain && <Link href={`/building/rooms/${result.id}#صيانة`} className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm text-brand-800">إنشاء بلاغ صيانة</Link>}
          </div>
        </div>
      )}
      {result?.ok && result.kind === "asset" && (
        <div className={`rounded-xl border p-4 ${result.archived ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
          <p className={`font-bold ${result.archived ? "text-amber-900" : "text-emerald-900"}`}>
            أصل: {result.nameAr} <span className="text-xs" dir="ltr">({result.code})</span>
            {result.archived && <span className="ms-2 rounded bg-amber-200 px-1.5 text-xs text-amber-900">مؤرشف</span>}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/building/assets?رمز=${encodeURIComponent(result.code)}${result.archived ? "&عرض=مؤرشف" : ""}`} className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white">فتح الأصل</Link>
            {!result.archived && result.canMaintain && result.roomId && (
              <Link href={`/building/rooms/${result.roomId}#صيانة`} className="rounded-lg border border-brand-300 px-3 py-1.5 text-sm text-brand-800">إنشاء بلاغ صيانة</Link>
            )}
            {result.archived && <span className="self-center text-xs text-amber-800">الأصل مؤرشف — استعِده أولاً لبدء إجراء عليه</span>}
          </div>
        </div>
      )}
    </div>
  );
}
