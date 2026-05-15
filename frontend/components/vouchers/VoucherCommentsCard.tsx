"use client";

/**
 * VoucherCommentsCard — Etapa M
 *
 * Thread de comentarios por voucher. Discusion operativa entre el operador
 * que crea el voucher y los aprobadores (GG / Director) o entre miembros
 * del equipo de Finance.
 *
 * Features:
 *   - Listar comments en orden DESC (mas reciente primero)
 *   - Crear nuevo comment (Cmd+Enter para enviar)
 *   - Editar comment propio (inline, click "Editar")
 *   - Borrar comment propio (con confirm)
 *   - Marcar como resuelto / re-abrir (cualquier user con scope)
 *   - Resolved comments con visual subdued (gris) + checkmark
 *   - Timestamps relativos con tooltip absoluto
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Edit3,
  MessageSquare,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { Surface } from "@/components/ui/surface";
import { toast } from "@/components/ui/toast";

interface Comment {
  comment_id: number;
  voucher_id: number;
  user_id: string;
  user_email: string;
  body: string;
  resolved: boolean;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
}

function formatRelative(ts: string): string {
  const d = new Date(ts);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMs / 3_600_000);
  const diffDays = Math.floor(diffMs / 86_400_000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin}m`;
  if (diffH < 24) return `hace ${diffH}h`;
  if (diffDays < 30) return `hace ${diffDays}d`;
  return d.toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatAbsolute(ts: string): string {
  return new Date(ts).toLocaleString("es-CL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function VoucherCommentsCard({ voucherId }: { voucherId: number }) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [newBody, setNewBody] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingBody, setEditingBody] = useState("");

  const queryKey = ["voucher-comments", voucherId];

  const { data: comments = [], isLoading } = useQuery<Comment[]>({
    queryKey,
    queryFn: () =>
      apiClient.get<Comment[]>(
        `/vouchers/${voucherId}/comments`,
        session,
      ),
    enabled: !!session && !!voucherId,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (body: string) =>
      apiClient.post<Comment>(
        `/vouchers/${voucherId}/comments`,
        { body },
        session,
      ),
    onSuccess: () => {
      setNewBody("");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo agregar el comment",
      );
    },
  });

  const patchMutation = useMutation({
    mutationFn: (vars: {
      id: number;
      body?: string;
      resolved?: boolean;
    }) =>
      apiClient.patch<Comment>(
        `/vouchers/${voucherId}/comments/${vars.id}`,
        { body: vars.body, resolved: vars.resolved },
        session,
      ),
    onSuccess: () => {
      setEditingId(null);
      setEditingBody("");
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo actualizar",
      );
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiClient.delete<void>(
        `/vouchers/${voucherId}/comments/${id}`,
        session,
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast.success("Comment eliminado");
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError ? err.detail : "No se pudo borrar",
      );
    },
  });

  const handleSubmitNew = () => {
    const trimmed = newBody.trim();
    if (!trimmed) return;
    if (trimmed.length > 2000) {
      toast.error("Máximo 2000 caracteres");
      return;
    }
    createMutation.mutate(trimmed);
  };

  const handleEditSubmit = (id: number) => {
    const trimmed = editingBody.trim();
    if (!trimmed) {
      toast.error("El comment no puede quedar vacío");
      return;
    }
    patchMutation.mutate({ id, body: trimmed });
  };

  return (
    <Surface className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-blue-600">
          <MessageSquare className="size-3.5" strokeWidth={2} />
        </div>
        <h3 className="text-sm font-semibold text-ink-900">
          Comentarios
        </h3>
        {comments.length > 0 && (
          <span className="ml-auto text-[10px] text-ink-500">
            {comments.filter((c) => !c.resolved).length} abierto
            {comments.filter((c) => !c.resolved).length === 1 ? "" : "s"}
            {" · "}
            {comments.length} total
          </span>
        )}
      </div>

      {/* Composer */}
      <div className="mb-4 rounded-xl border border-hairline bg-ink-50/50 p-3">
        <textarea
          value={newBody}
          onChange={(e) => setNewBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSubmitNew();
            }
          }}
          placeholder="Agregá un comentario… (Cmd/Ctrl+Enter para enviar)"
          rows={2}
          maxLength={2000}
          disabled={createMutation.isPending}
          className="w-full resize-none rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-hairline placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-cehta-green"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-ink-500">
            {newBody.length} / 2000
          </span>
          <button
            type="button"
            onClick={handleSubmitNew}
            disabled={createMutation.isPending || !newBody.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-50"
          >
            <Send className="size-3" />
            {createMutation.isPending ? "Enviando…" : "Comentar"}
          </button>
        </div>
      </div>

      {/* Lista de comments */}
      {isLoading && (
        <p className="text-xs text-ink-500">Cargando comentarios…</p>
      )}

      {!isLoading && comments.length === 0 && (
        <p className="text-xs text-ink-500 italic">
          Sin comentarios todavía. Sé el primero en agregar contexto.
        </p>
      )}

      {!isLoading && comments.length > 0 && (
        <ul className="space-y-3">
          {comments.map((c) => {
            const isEditing = editingId === c.comment_id;
            const isResolved = c.resolved;
            return (
              <li
                key={c.comment_id}
                className={`rounded-xl border p-3 ${
                  isResolved
                    ? "border-hairline bg-ink-50/30 opacity-75"
                    : "border-hairline bg-white"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-ink-900">
                    {c.user_email}
                  </span>
                  <span
                    className="text-[10px] text-ink-500 tabular-nums"
                    title={formatAbsolute(c.created_at)}
                  >
                    {formatRelative(c.created_at)}
                  </span>
                  {c.created_at !== c.updated_at && (
                    <span
                      className="text-[10px] text-ink-400 italic"
                      title={`Editado: ${formatAbsolute(c.updated_at)}`}
                    >
                      · editado
                    </span>
                  )}
                  {isResolved && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-cehta-green/10 px-1.5 py-0.5 text-[9px] font-semibold text-cehta-green">
                      <Check className="size-2.5" />
                      Resuelto
                    </span>
                  )}
                  <div className="ml-auto flex items-center gap-1">
                    {!isEditing && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            patchMutation.mutate({
                              id: c.comment_id,
                              resolved: !c.resolved,
                            })
                          }
                          disabled={patchMutation.isPending}
                          className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-cehta-green"
                          title={
                            isResolved
                              ? "Reabrir esta conversación"
                              : "Marcar como resuelta"
                          }
                          aria-label={
                            isResolved
                              ? "Reabrir comment"
                              : "Marcar resuelto"
                          }
                        >
                          <Check className="size-3" strokeWidth={2.5} />
                        </button>
                        {c.can_edit && (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingId(c.comment_id);
                                setEditingBody(c.body);
                              }}
                              className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-900"
                              title="Editar"
                              aria-label="Editar comment"
                            >
                              <Edit3 className="size-3" strokeWidth={2} />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (
                                  confirm(
                                    "¿Borrar este comentario? No se puede deshacer.",
                                  )
                                ) {
                                  deleteMutation.mutate(c.comment_id);
                                }
                              }}
                              disabled={deleteMutation.isPending}
                              className="rounded p-1 text-ink-400 hover:bg-red-50 hover:text-red-600"
                              title="Borrar"
                              aria-label="Borrar comment"
                            >
                              <Trash2 className="size-3" strokeWidth={2} />
                            </button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>

                {isEditing ? (
                  <div className="mt-2">
                    <textarea
                      value={editingBody}
                      onChange={(e) => setEditingBody(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault();
                          handleEditSubmit(c.comment_id);
                        } else if (e.key === "Escape") {
                          setEditingId(null);
                          setEditingBody("");
                        }
                      }}
                      rows={2}
                      maxLength={2000}
                      disabled={patchMutation.isPending}
                      className="w-full resize-none rounded-lg border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                      autoFocus
                    />
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(null);
                          setEditingBody("");
                        }}
                        disabled={patchMutation.isPending}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-ink-600 hover:bg-ink-100"
                      >
                        <X className="size-3" />
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleEditSubmit(c.comment_id)}
                        disabled={
                          patchMutation.isPending || !editingBody.trim()
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-cehta-green px-3 py-1 text-xs font-semibold text-white hover:bg-cehta-green-700 disabled:opacity-50"
                      >
                        <Check className="size-3" />
                        Guardar
                      </button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-700 leading-snug">
                    {c.body}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Surface>
  );
}
