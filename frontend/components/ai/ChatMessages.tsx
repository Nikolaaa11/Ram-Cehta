"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Sparkles, User2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CitationChip } from "./CitationChip";
import type { ChatMessage } from "@/hooks/use-chat-stream";

/**
 * Renderiza el feed de mensajes con markdown + citations.
 *
 * Apple polish:
 * - User messages: bg ink-100, ring-hairline, rounded-2xl, alineados a la derecha.
 * - Assistant: bg cehta-green/5, ring cehta-green/15, alineados a la izquierda.
 * - Cursor blink durante streaming (cuadrito sólido).
 */
export function ChatMessages({
  messages,
  empresa,
}: {
  messages: ChatMessage[];
  empresa: string;
}) {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cehta-green/10 ring-1 ring-cehta-green/20">
          <Sparkles className="h-6 w-6 text-cehta-green" strokeWidth={1.5} />
        </div>
        <h3 className="text-base font-semibold text-ink-900">
          Sin conversaciones aún
        </h3>
        <p className="max-w-sm text-sm text-ink-500">
          Hacé tu primera pregunta sobre <span className="font-medium">{empresa}</span>.
          Tengo acceso a contratos, F29, movimientos y la knowledge base de la empresa.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-6">
      {messages.map((m, idx) => (
        <MessageBubble key={`${m.message_id ?? "pending"}-${idx}`} message={m} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
      <div
        className={cn(
          "mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1",
          isUser
            ? "bg-ink-100 text-ink-700 ring-hairline"
            : "bg-cehta-green/10 text-cehta-green-700 ring-cehta-green/20",
        )}
      >
        {isUser ? (
          <User2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        ) : (
          <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
        )}
      </div>
      <div className={cn("max-w-[80%] flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 ring-1 ring-hairline shadow-card",
            isUser
              ? "bg-ink-100 text-ink-900"
              : "bg-cehta-green/5 text-ink-900 ring-cehta-green/15",
          )}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
          ) : (
            <div className="prose prose-sm max-w-none text-sm leading-relaxed [&_p]:my-1 [&_pre]:bg-ink-900 [&_pre]:text-white [&_pre]:rounded-lg [&_pre]:px-3 [&_pre]:py-2 [&_code]:font-mono [&_table]:text-xs [&_th]:font-semibold [&_th]:border-b [&_th]:border-hairline [&_td]:border-b [&_td]:border-hairline">
              {message.content ? (
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              ) : message.pending ? (
                <span className="inline-block h-4 w-1.5 animate-pulse-dot bg-cehta-green" />
              ) : (
                <span className="italic text-ink-500">(respuesta vacía)</span>
              )}
              {message.pending && message.content ? (
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse-dot bg-cehta-green align-middle" />
              ) : null}
            </div>
          )}
        </div>
        {!isUser && message.citations && message.citations.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {message.citations.slice(0, 6).map((c, i) => (
              <CitationChip key={c.chunk_id ?? i} citation={c} index={i} />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
