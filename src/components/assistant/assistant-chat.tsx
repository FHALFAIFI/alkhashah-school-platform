"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** واجهة محادثة «مساعد المدير الذكي» — عربية RTL، بث متدفق، إيقاف وإعادة محاولة، ومقترحات إجراءات تتطلب تأكيداً */

type Source = { title: string; href: string };
type PreviewItem = { label: string; value: string };
type Proposal = { proposalId: string; toolName: string; preview: PreviewItem[]; status: "pending" | "executing" | "done" | "cancelled" | "failed"; resultMessage?: string; resultLinks?: Source[] };
type Msg = {
  role: "user" | "assistant" | "error";
  content: string;
  sources?: Source[];
  proposal?: Proposal;
  providerName?: string;
  local?: boolean;
};

const TOOL_LABELS: Record<string, string> = {
  search_records: "البحث في السجلات",
  overdue_programs: "البرامج المتأخرة",
  overdue_tasks: "المهام المتأخرة",
  missing_evidence: "الشواهد الناقصة",
  upcoming_performance_sessions: "جلسات الأداء القادمة",
  rooms_needing_inspection: "الغرف التي تحتاج فحصاً",
  open_maintenance_issues: "بلاغات الصيانة المفتوحة",
  dashboard_summary: "ملخص لوحة المتابعة",
  program_brief: "ملخص حالة البرنامج",
  meeting_brief: "مادة الاجتماع",
  person_performance_brief: "ملخص متابعة الأداء",
  room_brief: "ملخص حالة الغرفة",
  attachment_text: "استخراج نص المرفق",
  save_draft: "حفظ مسودة",
  create_task: "إنشاء مهمة",
  create_maintenance_issue: "بلاغ صيانة",
  create_email_draft: "مسودة بريد",
};

const GENERAL_SUGGESTIONS = [
  "لخّص حالة الخطة التشغيلية",
  "اعرض البرامج المتأخرة واقترح إجراءات",
  "ما الشواهد الناقصة؟",
  "اشرح أرقام لوحة المتابعة",
  "جهز مسودة التقرير التنفيذي الشهري",
];

const CONTEXT_SUGGESTIONS: Record<string, string[]> = {
  program: ["لخّص حالة هذا البرنامج", "افحص اكتمال شواهد هذا البرنامج", "اقترح إجراءات للتأخر"],
  meeting: ["أنشئ مسودة محضر لهذا الاجتماع", "استخرج القرارات والمهام من المرفق", "أنشئ مسودة جدول أعمال لهذا الاجتماع"],
  committee: ["أنشئ مسودة جدول أعمال للجنة", "ما اجتماعات هذه اللجنة؟", "أنشئ مسودة أثر لعمل اللجنة"],
  performance: ["جهز ملخص أداء هذا الموظف (دون درجات)", "أنشئ مسودة خطة تحسين", "ما الجلسات غير المكتملة؟"],
  room: ["أنشئ مسودة طلب صيانة لهذه الغرفة", "لخّص حالة هذه الغرفة"],
  inspection: ["أنشئ ملخصاً لنتائج الفحص", "ما الغرف التي تحتاج إلى فحص؟"],
  report: ["جهز مسودة التقرير التنفيذي الشهري", "اشرح أرقام لوحة المتابعة"],
};

export function AssistantChat({
  csrfToken,
  context,
  compact = false,
  initialConversationId,
}: {
  csrfToken: string;
  context?: { type: string; id: string; label: string } | null;
  compact?: boolean;
  initialConversationId?: string | null;
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(initialConversationId ?? null);
  const [providerName, setProviderName] = useState<string | null>(null);
  const [providerLocal, setProviderLocal] = useState<boolean | null>(null);
  const [toolActivity, setToolActivity] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastPromptRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, toolActivity]);

  // تحميل محادثة سابقة
  useEffect(() => {
    if (!initialConversationId) return;
    (async () => {
      const res = await fetch(`/api/ai/conversations/${initialConversationId}`);
      if (!res.ok) return;
      const data = (await res.json()) as { messages: { role: string; content: string; provider?: string; local?: boolean; sources: Source[] }[] };
      setMessages(
        data.messages.map((m) => ({
          role: m.role === "user" ? "user" : m.role === "error" ? "error" : "assistant",
          content: m.content,
          sources: m.sources,
          local: m.local ?? undefined,
        })),
      );
    })();
  }, [initialConversationId]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      lastPromptRef.current = message;
      setInput("");
      setBusy(true);
      setToolActivity(null);
      setMessages((prev) => [...prev, { role: "user", content: message }]);

      const controller = new AbortController();
      abortRef.current = controller;
      let assistantStarted = false;

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-csrf-token": csrfToken },
          body: JSON.stringify({ conversationId, message, context: context ?? null }),
          signal: controller.signal,
        });
        if (!res.ok || !res.body) {
          const errText = await res.text().catch(() => "");
          setMessages((prev) => [...prev, { role: "error", content: errText || `تعذر الاتصال بالمساعد (${res.status})` }]);
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            let evt: { type: string; [k: string]: unknown };
            try {
              evt = JSON.parse(line.slice(5));
            } catch {
              continue;
            }
            if (evt.type === "meta") {
              setConversationId(evt.conversationId as string);
              setProviderName(evt.provider as string);
              setProviderLocal(evt.local as boolean);
            } else if (evt.type === "tool") {
              setToolActivity(TOOL_LABELS[evt.name as string] ?? (evt.name as string));
            } else if (evt.type === "token") {
              setToolActivity(null);
              const text = evt.text as string;
              setMessages((prev) => {
                if (assistantStarted && prev[prev.length - 1]?.role === "assistant") {
                  const copy = [...prev];
                  copy[copy.length - 1] = { ...copy[copy.length - 1], content: copy[copy.length - 1].content + text };
                  return copy;
                }
                return [...prev, { role: "assistant", content: text }];
              });
              assistantStarted = true;
            } else if (evt.type === "sources") {
              setMessages((prev) => {
                const copy = [...prev];
                const last = copy[copy.length - 1];
                if (last?.role === "assistant") copy[copy.length - 1] = { ...last, sources: evt.sources as Source[] };
                return copy;
              });
            } else if (evt.type === "proposal") {
              setToolActivity(null);
              setMessages((prev) => [
                ...prev,
                {
                  role: "assistant",
                  content: "",
                  proposal: {
                    proposalId: evt.proposalId as string,
                    toolName: evt.toolName as string,
                    preview: evt.preview as PreviewItem[],
                    status: "pending",
                  },
                },
              ]);
            } else if (evt.type === "error") {
              setToolActivity(null);
              setMessages((prev) => [...prev, { role: "error", content: evt.message as string }]);
            }
          }
        }
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "AbortError")) {
          setMessages((prev) => [...prev, { role: "error", content: "انقطع الاتصال بالمساعد — أعد المحاولة" }]);
        }
      } finally {
        setBusy(false);
        setToolActivity(null);
        abortRef.current = null;
      }
    },
    [busy, context, conversationId, csrfToken],
  );

  const stop = () => abortRef.current?.abort();

  const retry = () => {
    if (lastPromptRef.current) void send(lastPromptRef.current);
  };

  const decideProposal = async (proposalId: string, confirm: boolean) => {
    setMessages((prev) =>
      prev.map((m) => (m.proposal?.proposalId === proposalId ? { ...m, proposal: { ...m.proposal, status: "executing" } } : m)),
    );
    try {
      const res = await fetch(`/api/ai/proposals/${proposalId}`, {
        method: confirm ? "POST" : "DELETE",
        headers: { "x-csrf-token": csrfToken },
      });
      const data = (await res.json()) as { ok: boolean; message: string; links?: Source[] };
      setMessages((prev) =>
        prev.map((m) =>
          m.proposal?.proposalId === proposalId
            ? {
                ...m,
                proposal: {
                  ...m.proposal,
                  status: confirm ? (data.ok ? "done" : "failed") : "cancelled",
                  resultMessage: data.message,
                  resultLinks: data.links ?? [],
                },
              }
            : m,
        ),
      );
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.proposal?.proposalId === proposalId
            ? { ...m, proposal: { ...m.proposal, status: "failed", resultMessage: "تعذر الاتصال بالخادم" } }
            : m,
        ),
      );
    }
  };

  const suggestions = context ? (CONTEXT_SUGGESTIONS[context.type] ?? GENERAL_SUGGESTIONS) : GENERAL_SUGGESTIONS;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* شارة المزود: محلي أم خارجي */}
      {providerName && (
        <div className="flex items-center gap-2 border-b border-sand-100 px-3 py-1.5 text-xs text-gray-500">
          <span className={`inline-block h-2 w-2 rounded-full ${providerLocal ? "bg-emerald-500" : "bg-amber-500"}`} aria-hidden />
          {providerName} — {providerLocal ? "معالجة محلية داخل المدرسة" : "مزود خارجي"}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="py-6 text-center">
            <div className="text-3xl" aria-hidden>✦</div>
            <p className="mt-2 font-bold text-brand-900">مساعد المدير الذكي</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-gray-500">
              يجيب عن سجلات المدرسة وينشئ مسودات — كل إجراء كتابي يتطلب تأكيدك، والقرارات الرسمية تبقى بيدك.
            </p>
            {context && <p className="mt-2 text-xs text-brand-700">السياق: {context.label}</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => void send(s)}
                  className="min-h-11 rounded-full border border-sand-200 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-sand-100 lg:min-h-0"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i}>
            {m.role === "user" && (
              <div className="ms-8 rounded-2xl rounded-ee-sm bg-brand-600 p-3 text-sm text-white">{m.content}</div>
            )}
            {m.role === "error" && (
              <div role="alert" className="me-8 rounded-2xl bg-red-50 p-3 text-sm text-red-700">
                {m.content}
                <button onClick={retry} className="ms-2 font-medium underline">إعادة المحاولة</button>
              </div>
            )}
            {m.role === "assistant" && !m.proposal && (m.content || m.sources?.length) && (
              <div className="me-8 rounded-2xl rounded-es-sm border border-sand-200 bg-white p-3 text-sm">
                <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                {m.sources && m.sources.length > 0 && (
                  <div className="mt-2 border-t border-sand-100 pt-2">
                    <p className="mb-1 text-xs font-medium text-gray-500">المصادر من سجلات المنصة:</p>
                    <ul className="space-y-0.5">
                      {m.sources.slice(0, 8).map((s) => (
                        <li key={s.href + s.title}>
                          <a href={s.href} className="text-xs text-brand-700 underline">{s.title}</a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {m.proposal && (
              <div className="me-4 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm">
                <p className="font-bold text-amber-900">
                  إجراء مقترح: {TOOL_LABELS[m.proposal.toolName] ?? m.proposal.toolName} — يتطلب تأكيدك
                </p>
                <dl className="mt-2 space-y-1.5">
                  {m.proposal.preview.map((p, j) => (
                    <div key={j} className="rounded-lg bg-white/70 p-2">
                      <dt className="text-xs font-medium text-gray-500">{p.label}</dt>
                      <dd className="whitespace-pre-wrap text-sm text-gray-800">{p.value}</dd>
                    </div>
                  ))}
                </dl>
                {m.proposal.status === "pending" && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => void decideProposal(m.proposal!.proposalId, true)}
                      className="min-h-11 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 lg:min-h-0"
                    >
                      تأكيد التنفيذ
                    </button>
                    <button
                      onClick={() => void decideProposal(m.proposal!.proposalId, false)}
                      className="min-h-11 rounded-lg border border-sand-200 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-sand-100 lg:min-h-0"
                    >
                      إلغاء
                    </button>
                  </div>
                )}
                {m.proposal.status === "executing" && <p className="mt-2 text-xs text-gray-500">جارٍ التنفيذ…</p>}
                {m.proposal.status === "done" && (
                  <div role="status" className="mt-2 rounded-lg bg-emerald-50 p-2 text-emerald-800">
                    ✔ {m.proposal.resultMessage}
                    {m.proposal.resultLinks?.map((l) => (
                      <a key={l.href} href={l.href} className="ms-2 text-xs underline">{l.title}</a>
                    ))}
                  </div>
                )}
                {m.proposal.status === "cancelled" && <p className="mt-2 text-xs text-gray-500">أُلغي المقترح — لم ينفذ شيء.</p>}
                {m.proposal.status === "failed" && (
                  <p role="alert" className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{m.proposal.resultMessage}</p>
                )}
              </div>
            )}
          </div>
        ))}

        {toolActivity && (
          <div className="me-8 flex items-center gap-2 rounded-2xl border border-sand-200 bg-white p-3 text-sm text-gray-500">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sand-300 border-t-brand-600" aria-hidden />
            يستخدم: {toolActivity}
          </div>
        )}
        {busy && !toolActivity && messages[messages.length - 1]?.role === "user" && (
          <div className="me-8 flex items-center gap-2 rounded-2xl border border-sand-200 bg-white p-3 text-sm text-gray-400">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-sand-300 border-t-brand-600" aria-hidden />
            يفكر…
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
        className={`flex items-end gap-2 border-t border-sand-200 bg-white p-2 ${compact ? "" : "pb-[max(0.5rem,env(safe-area-inset-bottom))]"}`}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          rows={1}
          placeholder="اسأل عن سجلات المدرسة أو اطلب مسودة…"
          aria-label="رسالتك للمساعد"
          className="max-h-32 min-h-11 flex-1 resize-y rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
        />
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-600 text-white"
            aria-label="إيقاف التوليد"
          >
            ◼
          </button>
        ) : (
          <button
            type="submit"
            disabled={!input.trim()}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white disabled:opacity-40"
            aria-label="إرسال"
          >
            ↑
          </button>
        )}
      </form>
    </div>
  );
}
