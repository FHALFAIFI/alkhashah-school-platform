/**
 * Phase 5 — تحليل محتوى رمز QR أو الرمز المُدخل يدوياً (دالة نقية، بلا خادم، قابلة للاختبار).
 * رموز QP للغرف عناوين تحوي معرّف الغرفة الثابت؛ رموز الأصول تحوي رمز الأصل الثابت —
 * كلاهما لا يتغير عند تحريك العنصر على المخطط.
 */
export type ParsedScan = { kind: "room" | "asset"; by: "id" | "code"; value: string } | null;

export function parseScanInput(raw: string): ParsedScan {
  const s = (raw ?? "").trim();
  if (!s) return null;

  // رابط غرفة: .../building/rooms/<uuid>
  const roomUrl = s.match(/\/building\/rooms\/([0-9a-fA-F-]{36})/);
  if (roomUrl) return { kind: "room", by: "id", value: roomUrl[1] };

  // رابط أصل يحمل ?رمز=CODE (قد يكون مُرمّزاً)
  try {
    const u = new URL(s);
    const code = u.searchParams.get("رمز");
    if (code) return { kind: "asset", by: "code", value: code };
  } catch {
    // ليس رابطاً كاملاً — نكمل بالمطابقات النصية
  }
  const enc = s.match(/[?&](?:رمز|%D8%B1%D9%85%D8%B2)=([^&\s]+)/);
  if (enc) {
    try {
      return { kind: "asset", by: "code", value: decodeURIComponent(enc[1]) };
    } catch {
      return { kind: "asset", by: "code", value: enc[1] };
    }
  }

  // رموز خام (الإدخال اليدوي) — البادئات الافتراضية
  const up = s.toUpperCase();
  if (/^KHS-RM-/.test(up)) return { kind: "room", by: "code", value: s };
  if (/^KHS-AST-/.test(up)) return { kind: "asset", by: "code", value: s };

  return null;
}
