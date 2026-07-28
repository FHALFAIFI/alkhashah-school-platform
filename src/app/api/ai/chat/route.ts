import { NextRequest } from "next/server";
import { z } from "zod";
import { getCurrentUser, requireCsrf, AuthError } from "@/lib/auth/session";
import { runChatTurn, type ChatEvent } from "@/lib/ai/orchestrator";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const bodySchema = z.object({
  conversationId: z.string().uuid().nullable().optional(),
  message: z.string().trim().min(1).max(8000),
  context: z
    .object({ type: z.string().max(40), id: z.string().uuid(), label: z.string().max(300).optional() })
    .nullable()
    .optional(),
});

/** محادثة المساعد — بث أحداث SSE (رموز نصية، أدوات، مقترحات، مصادر) */
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new Response("غير مصادق", { status: 401 });
  if (!user.permissions.has("ai.use")) return new Response("لا تملك صلاحية استخدام المساعد", { status: 403 });
  try {
    await requireCsrf(user);
  } catch (e) {
    return new Response(e instanceof AuthError ? e.message : "رمز الحماية غير صالح", { status: 403 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return new Response("مدخلات غير صالحة", { status: 400 });
  const { conversationId, message, context } = parsed.data;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // المتصفح أغلق الاتصال
        }
      };
      try {
        await runChatTurn({
          user,
          conversationId: conversationId ?? null,
          message,
          context: context ?? null,
          emit,
          signal: req.signal,
        });
      } catch (e) {
        // التفاصيل الفنية إلى سجل الخادم لا إلى المتصفّح — قد تحوي مساراً أو عنوان خدمة
        console.error("ai.chat stream error", e);
        emit({ type: "error", message: "تعذّرت معالجة الطلب — حاول مرة أخرى" });
      } finally {
        try {
          controller.close();
        } catch {
          // مغلق مسبقاً
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
