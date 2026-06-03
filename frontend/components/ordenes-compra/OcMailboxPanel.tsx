"use client";

/**
 * R152SSSS · OcMailboxPanel
 *
 * Tab "Bandeja mail" del módulo Órdenes de Compra.
 *
 * Pipeline operativo:
 *   1. Lee inbox_messages categoría = "oc" (clasificada por Claude).
 *   2. Botón "Correr cron ahora" → fuerza poll IMAP + clasificación.
 *   3. Por cada email pendiente: botón "Auto-crear OC" llama al backend
 *      que extrae datos con Claude y crea la OC + envía al GG.
 *   4. Si el email ya tiene una OC creada, muestra link directo a ella.
 *
 * Endpoints backend:
 *   - POST /admin/mailbox/run-now (R152PPPP)
 *   - GET  /admin/mailbox?category=oc
 *   - POST /admin/mailbox/{id}/auto-create-oc (R152HHHH)
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  Loader2,
  Mail,
  Paperclip,
  Sparkles,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";

interface MailboxItem {
  inbox_id: number;
  from_email: string;
  from_name: string | null;
  subject: string;
  received_at: string;
  has_attachments: boolean;
  category: string | null;
  ai_confidence: number | null;
  ai_summary: string | null;
  status: string;
  created_entity_type: string | null;
  created_entity_id: number | null;
  created_entity_numero: string | null;
  auto_create_error: string | null;
}

interface RunNowResponse {
  poll: { seen: number; inserted: number; errors: number };
  classify: { classified: number; errors: number };
  duration_ms: number;
}

// Claude clasifica usando 2 strings posibles para OC — filtramos por ambas.
const OC_CATEGORIES = new Set(["oc", "orden_compra"]);

export function OcMailboxPanel() {
  const { session } = useSession();
  const qc = useQueryClient();

  // Lista emails (todos) y filtramos client-side por categoría OC.
  // El endpoint backend acepta solo 1 valor de `category`, así que pedimos
  // todos los recientes y filtramos por ambas variantes acá.
  const list = useQuery<MailboxItem[]>({
    queryKey: ["mailbox", "oc"],
    queryFn: () =>
      apiClient.get<MailboxItem[]>("/admin/mailbox?limit=100", session),
    enabled: !!session,
    staleTime: 15_000,
  });

  // Correr cron ahora.
  const runNow = useMutation({
    mutationFn: () =>
      apiClient.post<RunNowResponse>("/admin/mailbox/run-now", {}, session),
    onSuccess: (data) => {
      const s = (data.duration_ms / 1000).toFixed(1);
      if (data.poll.inserted === 0 && data.classify.classified === 0) {
        toast.info(`Sin OCs nuevas · ${data.poll.seen} vistos · ${s}s`, {
          duration: 6000,
        });
      } else {
        toast.success(
          `Cron ${s}s · ${data.poll.inserted} mails nuevos · ${data.classify.classified} clasificados`,
          { duration: 8000 },
        );
      }
      qc.invalidateQueries({ queryKey: ["mailbox"] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : (e as Error).message;
      toast.error(`Cron falló: ${detail}`, { duration: 10000 });
    },
  });

  // Auto-crear OC desde un email puntual.
  const autoCreate = useMutation({
    mutationFn: (inboxId: number) =>
      apiClient.post<{
        ok: boolean;
        oc_id?: number;
        numero_oc?: string;
        error?: string;
      }>(`/admin/mailbox/${inboxId}/auto-create-oc`, {}, session),
    onSuccess: (data) => {
      if (data.ok && data.numero_oc) {
        toast.success(`OC creada: ${data.numero_oc}`);
      } else {
        toast.error(data.error || "No se pudo crear la OC");
      }
      qc.invalidateQueries({ queryKey: ["mailbox"] });
      qc.invalidateQueries({ queryKey: ["ordenes-compra"] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : (e as Error).message;
      toast.error(`Auto-crear falló: ${detail}`, { duration: 10000 });
    },
  });

  const items = (list.data ?? []).filter((it) =>
    OC_CATEGORIES.has(it.category ?? ""),
  );

  return (
    <div className="space-y-4">
      {/* Acción primaria: correr cron */}
      <div className="flex items-start justify-between gap-4 rounded-2xl border border-hairline bg-white p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-cehta-green/10 p-2">
            <Mail className="h-5 w-5 text-cehta-green" strokeWidth={1.5} />
          </div>
          <div>
            <h3 className="text-sm font-medium text-ink-900">
              Inbox · contactocehta@gmail.com
            </h3>
            <p className="mt-0.5 text-xs text-ink-500">
              Los mails que llegan a esta casilla se clasifican con IA. Los que
              son OC aparecen acá listos para auto-crear.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => runNow.mutate()}
          disabled={runNow.isPending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-cehta-green px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          title="Dispara IMAP poll + Claude classify ahora. Equivalente al cron horario de Fly."
        >
          {runNow.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" strokeWidth={1.75} />
          )}
          Correr cron ahora
        </button>
      </div>

      {/* Lista de emails */}
      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="rounded-2xl border border-negative/20 bg-negative/5 p-4 text-sm text-negative">
          Error cargando la bandeja. Reintenta o avisame.
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-hairline bg-white p-10 text-center">
          <Mail className="mx-auto h-10 w-10 text-ink-300" strokeWidth={1.25} />
          <p className="mt-3 text-sm text-ink-700">
            No hay correos con OCs pendientes
          </p>
          <p className="mt-1 text-xs text-ink-500">
            Pegá <strong>Correr cron ahora</strong> arriba para forzar lectura
            del IMAP.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((it) => (
            <EmailCard
              key={it.inbox_id}
              item={it}
              onAutoCreate={() => autoCreate.mutate(it.inbox_id)}
              isCreating={
                autoCreate.isPending && autoCreate.variables === it.inbox_id
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmailCard({
  item,
  onAutoCreate,
  isCreating,
}: {
  item: MailboxItem;
  onAutoCreate: () => void;
  isCreating: boolean;
}) {
  const fecha = new Date(item.received_at).toLocaleString("es-CL", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const yaCreada = item.created_entity_id && item.created_entity_type === "oc";

  return (
    <div className="rounded-2xl border border-hairline bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <span className="font-medium text-ink-700">
              {item.from_name || item.from_email}
            </span>
            <span>·</span>
            <span>{fecha}</span>
            {item.has_attachments && (
              <span className="inline-flex items-center gap-0.5 text-cehta-green">
                <Paperclip className="h-3 w-3" strokeWidth={2} />
                adjunto
              </span>
            )}
            {item.ai_confidence != null && (
              <span className="text-ink-400">
                · IA {Math.round(item.ai_confidence * 100)}%
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-ink-900 line-clamp-1">
            {item.subject || "(sin asunto)"}
          </p>
          {item.ai_summary && (
            <p className="mt-1 text-xs text-ink-500 line-clamp-2">
              {item.ai_summary}
            </p>
          )}
          {item.auto_create_error && (
            <div className="mt-2 inline-flex items-center gap-1 rounded bg-negative/10 px-2 py-0.5 text-xs text-negative">
              <AlertCircle className="h-3 w-3" />
              {item.auto_create_error.slice(0, 100)}
            </div>
          )}
        </div>

        <div className="shrink-0">
          {yaCreada ? (
            <Link
              href={`/ordenes-compra/${item.created_entity_id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green/10 px-3 py-1.5 text-xs font-medium text-cehta-green hover:bg-cehta-green/15"
            >
              <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
              Ver OC {item.created_entity_numero}
              <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} />
            </Link>
          ) : (
            <button
              type="button"
              onClick={onAutoCreate}
              disabled={isCreating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              title="Claude lee el mail, extrae proveedor + items + montos y crea una OC borrador."
            >
              {isCreating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" strokeWidth={2} />
              )}
              Auto-crear OC
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
