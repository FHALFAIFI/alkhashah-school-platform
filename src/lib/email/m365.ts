import "server-only";
import { audit } from "@/lib/audit";

/**
 * تكامل Microsoft 365 الاختياري — إنشاء مسودة بريد (لا إرسال نهائي أبداً):
 * ينشئ مسودة بموضوع ونص عربيين ومرفق PDF ثم يفتحها المدير في بريده للمراجعة والإرسال.
 * معطل افتراضياً؛ يتطلب تسجيل تطبيق لدى المؤسسة وتزويد البيئة بالاعتمادات.
 * البديل دون تكامل: تنزيل PDF وفتح مسودة بريد (mailto) مع توضيح أن الإرفاق يدوي.
 */

export function m365Enabled(): boolean {
  return (
    process.env.M365_ENABLED === "true" &&
    !!process.env.M365_TENANT_ID &&
    !!process.env.M365_CLIENT_ID &&
    !!process.env.M365_CLIENT_SECRET &&
    !!process.env.M365_SENDER_UPN
  );
}

async function getToken(): Promise<string> {
  const res = await fetch(
    `https://login.microsoftonline.com/${process.env.M365_TENANT_ID}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.M365_CLIENT_ID!,
        client_secret: process.env.M365_CLIENT_SECRET!,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );
  if (!res.ok) throw new Error("تعذر الحصول على رمز الوصول من Microsoft 365");
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

/** ينشئ مسودة في صندوق المدير ويعيد رابط فتحها — لا يرسل */
export async function createDraftEmail(opts: {
  to?: string;
  subject: string;
  bodyHtml: string;
  attachment?: { name: string; mime: string; data: Buffer };
  actorId: string;
}): Promise<{ webLink: string | null }> {
  if (!m365Enabled()) throw new Error("تكامل Microsoft 365 غير مفعل");
  const token = await getToken();
  const upn = process.env.M365_SENDER_UPN!;

  const message: Record<string, unknown> = {
    subject: opts.subject,
    body: { contentType: "HTML", content: opts.bodyHtml },
    toRecipients: opts.to ? [{ emailAddress: { address: opts.to } }] : [],
  };
  if (opts.attachment) {
    message.attachments = [
      {
        "@odata.type": "#microsoft.graph.fileAttachment",
        name: opts.attachment.name,
        contentType: opts.attachment.mime,
        contentBytes: opts.attachment.data.toString("base64"),
      },
    ];
  }

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(message),
  });
  if (!res.ok) throw new Error(`تعذر إنشاء المسودة (${res.status})`);
  const json = (await res.json()) as { webLink?: string };
  await audit({
    actorId: opts.actorId,
    action: "email.draft_created",
    summary: `مسودة بريد: ${opts.subject} — تفتح للمراجعة والإرسال اليدوي`,
  });
  return { webLink: json.webLink ?? null };
}
