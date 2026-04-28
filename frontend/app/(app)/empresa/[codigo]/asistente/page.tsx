"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useMe } from "@/hooks/use-me";
import { useChatStream } from "@/hooks/use-chat-stream";
import type { ChatCitation, ChatMessage } from "@/hooks/use-chat-stream";
import {
  ConversationList,
  type ConversationSummary,
} from "@/components/ai/ConversationList";
import { ChatMessages } from "@/components/ai/ChatMessages";
import { ChatInput } from "@/components/ai/ChatInput";
import { IndexStatus, type IndexStatusInfo } from "@/components/ai/IndexStatus";

/**
 * AI Asistente · {codigo} (V3 fase 3).
 *
 * Layout:
 *   ┌──────────────────────┬───────────────────────────────────┐
 *   │  Conversaciones      │  Chat principal                   │
 *   │  + Index status      │  (mensajes + input)               │
 *   └──────────────────────┴───────────────────────────────────┘
 *
 * Streaming via SSE — `useChatStream` mantiene los deltas en local state
 * y refrescamos los mensajes server-side post-`done` para verificar IDs.
 */
export default function EmpresaAsistentePage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const empresaCodigo = codigo.toUpperCase();
  const { session } = useSession();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const isAdmin =
    me?.app_role === "admin" || (me?.allowed_actions ?? []).includes("ai:index");

  const [activeId, setActiveId] = useState<number | null>(null);
  const [streamMessages, setStreamMessages] = useState<ChatMessage[]>([]);

  // ─── Conversations ────────────────────────────────────────────────────
  const conversationsQ = useQuery<ConversationSummary[]>({
    queryKey: ["ai", "conversations", empresaCodigo],
    queryFn: () =>
      apiClient.get<ConversationSummary[]>(
        `/ai/conversations?empresa_codigo=${encodeURIComponent(empresaCodigo)}`,
        session,
      ),
    enabled: !!session,
  });

  // Auto-select primera conversación cuando cargan.
  useEffect(() => {
    const first = conversationsQ.data?.[0];
    if (activeId == null && first) {
      setActiveId(first.conversation_id);
    }
  }, [conversationsQ.data, activeId]);

  // ─── Messages of active conversation ──────────────────────────────────
  const messagesQ = useQuery<ChatMessage[]>({
    queryKey: ["ai", "messages", activeId],
    queryFn: () =>
      apiClient.get<ChatMessage[]>(
        `/ai/conversations/${activeId}/messages`,
        session,
      ),
    enabled: !!session && !!activeId,
  });

  // Sincronizar streamMessages con la query cuando cambia la conversación
  // o llegan nuevos mensajes desde el server.
  useEffect(() => {
    if (messagesQ.data) {
      setStreamMessages(messagesQ.data);
    }
  }, [messagesQ.data, activeId]);

  // ─── Mutations ────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.post<ConversationSummary>(
        "/ai/conversations",
        { empresa_codigo: empresaCodigo },
        session,
      ),
    onSuccess: (conv) => {
      queryClient.invalidateQueries({
        queryKey: ["ai", "conversations", empresaCodigo],
      });
      setActiveId(conv.conversation_id);
      setStreamMessages([]);
    },
    onError: (e: Error) => toast.error(`No se pudo crear conversación: ${e.message}`),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient.delete<void>(`/ai/conversations/${id}`, session),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({
        queryKey: ["ai", "conversations", empresaCodigo],
      });
      if (activeId === id) {
        setActiveId(null);
        setStreamMessages([]);
      }
    },
    onError: (e: Error) => toast.error(`Error al borrar: ${e.message}`),
  });

  // ─── Index status + reindex ────────────────────────────────────────────
  const indexQ = useQuery<IndexStatusInfo>({
    queryKey: ["ai", "index", empresaCodigo],
    queryFn: () =>
      apiClient.get<IndexStatusInfo>(
        `/ai/index/${encodeURIComponent(empresaCodigo)}/status`,
        session,
      ),
    enabled: !!session,
  });

  const reindexMutation = useMutation({
    mutationFn: () =>
      apiClient.post<{ chunks_created: number; files_processed: number }>(
        `/ai/index/${encodeURIComponent(empresaCodigo)}`,
        {},
        session,
      ),
    onSuccess: (data) => {
      toast.success(
        `Reindexación OK: ${data.files_processed} archivos, ${data.chunks_created} chunks.`,
      );
      queryClient.invalidateQueries({ queryKey: ["ai", "index", empresaCodigo] });
    },
    onError: (e: Error) => toast.error(`Error reindexando: ${e.message}`),
  });

  // ─── Streaming ────────────────────────────────────────────────────────
  const { send, streaming, error: streamError } = useChatStream(activeId);

  useEffect(() => {
    if (streamError) toast.error(streamError);
  }, [streamError]);

  const handleSend = useCallback(
    async (text: string) => {
      let convId = activeId;
      if (!convId) {
        // Crear conversación on-the-fly
        const created = await createMutation.mutateAsync();
        convId = created.conversation_id;
      }
      if (!convId) return;
      await send(text, {
        onUserMessage: (msg) =>
          setStreamMessages((prev) => [...prev, msg]),
        onAssistantStart: (msg) =>
          setStreamMessages((prev) => [...prev, msg]),
        onAssistantDelta: (delta) =>
          setStreamMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, content: last.content + delta };
            }
            return next;
          }),
        onCitations: (cits: ChatCitation[]) =>
          setStreamMessages((prev) => {
            const next = [...prev];
            const last = next[next.length - 1];
            if (last && last.role === "assistant") {
              next[next.length - 1] = { ...last, citations: cits };
            }
            return next;
          }),
        onAssistantDone: () => {
          // Refetch para cerrar la transacción con IDs correctos.
          queryClient.invalidateQueries({
            queryKey: ["ai", "messages", convId],
          });
          queryClient.invalidateQueries({
            queryKey: ["ai", "conversations", empresaCodigo],
          });
        },
      });
    },
    [activeId, createMutation, send, queryClient, empresaCodigo],
  );

  const conversations = useMemo(() => conversationsQ.data ?? [], [conversationsQ.data]);

  return (
    <div className="-mx-6 lg:-mx-10 grid h-[calc(100vh-160px)] min-h-[600px] grid-cols-[240px_1fr] overflow-hidden border border-hairline bg-white shadow-card sm:rounded-2xl">
      {/* Sidebar */}
      <div className="flex h-full flex-col">
        <ConversationList
          conversations={conversations}
          activeId={activeId}
          onSelect={(id) => {
            setActiveId(id);
            setStreamMessages([]);
          }}
          onCreate={() => createMutation.mutate()}
          onDelete={(id) => deleteMutation.mutate(id)}
        />
        <IndexStatus
          status={indexQ.data ?? null}
          isAdmin={isAdmin}
          reindexing={reindexMutation.isPending}
          onReindex={() => reindexMutation.mutate()}
        />
      </div>
      {/* Chat area */}
      <div className="flex h-full flex-col">
        <div className="flex-1 overflow-y-auto">
          <ChatMessages messages={streamMessages} empresa={empresaCodigo} />
        </div>
        <div className="border-t border-hairline bg-surface-muted p-3">
          <ChatInput onSend={handleSend} disabled={streaming} />
          <p className="mt-2 text-center text-[11px] text-ink-500">
            Las respuestas se generan a partir de la knowledge base de{" "}
            <span className="font-medium">{empresaCodigo}</span>. Verifica decisiones
            financieras antes de actuar.
          </p>
        </div>
      </div>
    </div>
  );
}
