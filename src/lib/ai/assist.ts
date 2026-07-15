import "server-only";
import { getAiProvider } from "./provider";
import { audit } from "@/lib/audit";

/**
 * وظائف مساعدة مقترحة — مخرجاتها مسودات نصية يراجعها الإنسان دائماً،
 * ولا تمس السجلات الرسمية إطلاقاً.
 */

const SYSTEM_AR =
  "أنت مساعد إداري مدرسي. أجب بالعربية الفصحى فقط وبإيجاز مهني. مخرجاتك مسودات مقترحة يراجعها مدير المدرسة قبل أي استخدام، ولا تمثل قرارات رسمية.";

export async function draftMeetingSummary(opts: {
  committeeName: string;
  agenda: string[];
  discussion: string;
  actorId: string;
}): Promise<string> {
  const provider = getAiProvider();
  if (!provider) throw new Error("الذكاء الاصطناعي معطل");
  const result = await provider.chat([
    { role: "system", content: SYSTEM_AR },
    {
      role: "user",
      content: `لخص مناقشات هذا الاجتماع في نقاط، واقترح قرارات وتوصيات محتملة بصيغة واضحة.\nاللجنة: ${opts.committeeName}\nجدول الأعمال:\n${opts.agenda.map((a, i) => `${i + 1}. ${a}`).join("\n")}\nالمناقشات:\n${opts.discussion}`,
    },
  ]);
  await audit({ actorId: opts.actorId, action: "ai.meeting_summary_drafted", summary: `مسودة تلخيص اجتماع ${opts.committeeName} (مزود محلي)` });
  return result;
}

export async function reviewEvidenceCompleteness(opts: {
  programName: string;
  requiredEvidence: string;
  actualEvidence: { title: string; role: string | null }[];
  actorId: string;
}): Promise<string> {
  const provider = getAiProvider();
  if (!provider) throw new Error("الذكاء الاصطناعي معطل");
  const result = await provider.chat([
    { role: "system", content: SYSTEM_AR },
    {
      role: "user",
      content: `راجع اكتمال شواهد هذا البرنامج واذكر النواقص المحتملة فقط دون أحكام نهائية.\nالبرنامج: ${opts.programName}\nالشواهد المطلوبة حسب الخطة: ${opts.requiredEvidence}\nالشواهد المسجلة:\n${opts.actualEvidence.map((e) => `- ${e.title}${e.role ? ` (${e.role})` : ""}`).join("\n") || "لا شواهد"}`,
    },
  ]);
  await audit({ actorId: opts.actorId, action: "ai.evidence_reviewed", summary: `مراجعة اكتمال شواهد ${opts.programName} (مزود محلي)` });
  return result;
}

/** استخراج نص من صورة (OCR) — عند الطلب فقط، والمراجعة البشرية إلزامية قبل الحفظ */
export async function ocrImage(opts: { imageBase64: string; mime: string; actorId: string }): Promise<string> {
  const provider = getAiProvider();
  if (!provider) throw new Error("الذكاء الاصطناعي معطل");
  // Ollama يدعم الصور عبر واجهة chat بالحقل images
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
  const model = process.env.OLLAMA_VISION_MODEL ?? "qwen3-vl:8b";
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: [
        {
          role: "user",
          content: "استخرج النص العربي من هذه الصورة كما هو دون إضافة أو تفسير.",
          images: [opts.imageBase64],
        },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error("تعذر استخراج النص — تأكد من توفر نموذج رؤية محلي");
  const json = (await res.json()) as { message?: { content?: string } };
  await audit({ actorId: opts.actorId, action: "ai.ocr_performed", summary: "استخراج نص من صورة (مزود محلي) — بانتظار المراجعة البشرية" });
  return json.message?.content ?? "";
}
