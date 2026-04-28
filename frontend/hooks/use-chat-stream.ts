"use client";

/**
 * useChatStream — manejo de Server-Sent Events del endpoint
 * `POST /ai/conversations/:id/chat`.
 *
 * Protocolo SSE (frames `data: {...}\n\n`):
 *   - `{"type": "citations", "citations": [...]}` — al inicio.
 *   - `{"type": "content_delta", "text": "..."}` — N veces.
 *   - `{"type": "done", "message_id": N, "citations": [...], "tokens_used": N}`.
 *   - `{"type": "error", "detail": "..."}` — en caso de fallo.
 *
 * El hook mantiene `messages` localmente y los actualiza incrementalmente.
 * No usa TanStack Query para la lista de mensajes durante el streaming porque
 * los deltas vienen demasiado rápido — invalidación full sería costosa. Tras
 * `done` se invalida la query para refetch limpio (citations finales, IDs).
 */
import { useCallback, useState } from "react";
import { useSession } from "@/hooks/use-session";

export interface ChatCitation {
  chunk_id: number;
  source_path?: string | null;
  snippet?: string | null;
}

export interface ChatMessage {
  message_id: number | null; // null mientras se streamea
  role: "user" | "assistant" | "system";
  content: string;
  citations?: ChatCitation[];
  pending?: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

export function useChatStream(conversationId: number | null) {
  const { session } = useSession();
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(
    async (
      text: string,
      callbacks: {
        onUserMessage: (msg: ChatMessage) => void;
        onAssistantStart: (msg: ChatMessage) => void;
        onAssistantDelta: (deltaText: string) => void;
        onAssistantDone: (final: ChatMessage) => void;
        onCitations: (citations: ChatCitation[]) => void;
      },
    ) => {
      if (!conversationId || !session?.access_token) return;
      setError(null);
      setStreaming(true);

      // Optimista: aparece el msg user inmediatamente.
      callbacks.onUserMessage({
        message_id: null,
        role: "user",
        content: text,
      });
      callbacks.onAssistantStart({
        message_id: null,
        role: "assistant",
        content: "",
        pending: true,
      });

      try {
        const res = await fetch(`${API_BASE}/ai/conversations/${conversationId}/chat`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: text }),
        });
        if (!res.ok || !res.body) {
          const errBody = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let assistantText = "";
        let citations: ChatCitation[] = [];
        let assistantMessageId: number | null = null;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE: separar por doble newline
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const dataLine = frame
              .split("\n")
              .find((l) => l.startsWith("data: "));
            if (!dataLine) continue;
            const json = dataLine.slice(6).trim();
            if (!json) continue;
            let parsed: Record<string, unknown>;
            try {
              parsed = JSON.parse(json) as Record<string, unknown>;
            } catch {
              continue;
            }
            const type = parsed.type as string;
            if (type === "content_delta") {
              const delta = String(parsed.text ?? "");
              assistantText += delta;
              callbacks.onAssistantDelta(delta);
            } else if (type === "citations") {
              citations = (parsed.citations as ChatCitation[]) ?? [];
              callbacks.onCitations(citations);
            } else if (type === "done") {
              assistantMessageId = (parsed.message_id as number) ?? null;
              const finalCitations =
                (parsed.citations as ChatCitation[]) ?? citations;
              callbacks.onAssistantDone({
                message_id: assistantMessageId,
                role: "assistant",
                content: assistantText,
                citations: finalCitations,
              });
            } else if (type === "error") {
              throw new Error(String(parsed.detail ?? "Error LLM"));
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Error de red";
        setError(msg);
      } finally {
        setStreaming(false);
      }
    },
    [conversationId, session],
  );

  return { send, streaming, error };
}
