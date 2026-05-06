"use client";

/**
 * /admin/mailbox — Inbox de contactocehta@gmail.com
 *
 * Vista Apple-tier del email inbox procesado:
 *   1. Botones "Refrescar IMAP" + "Clasificar pendientes"
 *   2. Lista filtrable por status / categoría
 *   3. Click en un item → drawer lateral con:
 *      - Asunto + From + Body
 *      - Categoría AI + summary + sugerencia
 *      - Draft response editable
 *      - Botones Enviar / Archivar / Linkear con voucher
 *
 * El IMAP poll real corre vía cron Fly cada 15min en producción. Este
 * panel es el control manual + la UI de revisión de drafts.
 */
import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  Mail,
  RefreshCw,
  Sparkles,
  Inbox,
  Archive,
  Send,
  Tag,
  Paperclip,
  Loader2,
  Link as LinkIcon,
  Receipt,
  FileText,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";

interface MailboxItem {
  inbox_id: number;
  message_id: string;
  from_email: string;
  from_name: string | null;
  subject: string;
  received_at: string;
  has_attachments: boolean;
  category: string | null;
  ai_confidence: number | null;
  ai_summary: string | null;
  ai_suggested_action: string | null;
  status: string;
  classified_at: string | null;
  replied_at: string | null;
}

interface MailboxDetail extends MailboxItem {
  body_text: string | null;
  body_html: string | null;
  attachments_meta: Array<{
    filename: string;
    content_type: string;
    size_bytes: number;
    dropbox_path: string | null;
    extracted_text: string | null;
  }>;
  draft_response_html: string | null;
  linked_voucher_id: number | null;
  linked_oc_id: number | null;
}

const CATEGORY_LABELS: Record<string, string> = {
  factura_proveedor: "Factura proveedor",
  boleta_honorarios: "Boleta honorarios",
  pago_confirmado: "Pago confirmado",
  consulta_lp: "Consulta LP",
  consulta_cliente: "Consulta cliente",
  spam: "Spam",
  notif_banco: "Notif banco",
  notif_sii: "Notif SII",
  otro: "Otro",
};

const STATUS_LABELS: Record<string, string> = {
  received: "Recibido",
  classified: "Clasificado",
  reviewed: "Revisado",
  replied: "Respondido",
  archived: "Archivado",
  failed: "Falló",
};

function statusTone(s: string): string {
  switch (s) {
    case "replied":
      return "bg-cehta-green/10 text-cehta-green";
    case "archived":
      return "bg-ink-100 text-ink-500";
    case "failed":
      return "bg-red-50 text-red-600";
    case "classified":
      return "bg-blue-50 text-blue-700";
    default:
      return "bg-amber-50 text-amber-700";
  }
}

export default function MailboxPage() {
  const { session } = useSession();
  const qc = useQueryClient();

  const [statusFilter, setStatusFilter] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [bulkSelected, setBulkSelected] = useState<Set<number>>(new Set());

  const toggleBulk = (id: number) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const { data: items, isLoading, refetch } = useQuery<MailboxItem[]>({
    queryKey: ["mailbox", statusFilter, categoryFilter],
    queryFn: () => {
      const qs = new URLSearchParams();
      if (statusFilter) qs.set("status", statusFilter);
      if (categoryFilter) qs.set("category", categoryFilter);
      return apiClient.get<MailboxItem[]>(
        `/admin/mailbox${qs.toString() ? `?${qs}` : ""}`,
        session,
      );
    },
    enabled: !!session,
  });

  const { data: detail } = useQuery<MailboxDetail>({
    queryKey: ["mailbox-detail", selectedId],
    queryFn: () =>
      apiClient.get<MailboxDetail>(
        `/admin/mailbox/${selectedId}`,
        session,
      ),
    enabled: !!session && !!selectedId,
  });

  // Sincroniza draft con el detalle cuando cambia
  if (detail && detail.inbox_id === selectedId && draft === "") {
    if (detail.draft_response_html) setDraft(detail.draft_response_html);
  }

  const pollMut = useMutation({
    mutationFn: () => apiClient.post("/admin/mailbox/poll", {}, session),
    onSuccess: (data: any) => {
      toast.success(
        `Poll OK · ${data.inserted ?? 0} nuevos · ${data.errors ?? 0} errores`,
      );
      qc.invalidateQueries({ queryKey: ["mailbox"] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`No se pudo hacer poll: ${detail}`);
    },
  });

  const classifyMut = useMutation({
    mutationFn: () => apiClient.post("/admin/mailbox/classify", {}, session),
    onSuccess: (data: any) => {
      toast.success(`Clasificación OK · ${data.classified ?? 0} mails`);
      qc.invalidateQueries({ queryKey: ["mailbox"] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`No se pudo clasificar: ${detail}`);
    },
  });

  const replyMut = useMutation({
    mutationFn: (body: { body_html: string }) =>
      apiClient.post(
        `/admin/mailbox/${selectedId}/reply`,
        body,
        session,
      ),
    onSuccess: () => {
      toast.success("Respuesta enviada");
      setSelectedId(null);
      setDraft("");
      qc.invalidateQueries({ queryKey: ["mailbox"] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`No se pudo enviar: ${detail}`);
    },
  });

  const archiveMut = useMutation({
    mutationFn: (id: number) =>
      apiClient.post(
        `/admin/mailbox/${id}/archive`,
        { reason: "archived_manual" },
        session,
      ),
    onSuccess: () => {
      toast.success("Email archivado");
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["mailbox"] });
    },
  });

  const restoreMut = useMutation({
    mutationFn: (id: number) =>
      apiClient.post(`/admin/mailbox/${id}/restore`, {}, session),
    onSuccess: () => {
      toast.success("Email restaurado");
      qc.invalidateQueries({ queryKey: ["mailbox"] });
      qc.invalidateQueries({ queryKey: ["mailbox-detail", selectedId] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`No se pudo restaurar: ${detail}`);
    },
  });

  const linkVoucherMut = useMutation({
    mutationFn: (vid: number) =>
      apiClient.post(
        `/admin/mailbox/${selectedId}/link-voucher`,
        { voucher_id: vid },
        session,
      ),
    onSuccess: () => {
      toast.success("Voucher linkeado");
      qc.invalidateQueries({ queryKey: ["mailbox"] });
      qc.invalidateQueries({ queryKey: ["mailbox-detail", selectedId] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`No se pudo linkear: ${detail}`);
    },
  });

  const linkOcMut = useMutation({
    mutationFn: (oid: number) =>
      apiClient.post(
        `/admin/mailbox/${selectedId}/link-oc`,
        { oc_id: oid },
        session,
      ),
    onSuccess: () => {
      toast.success("OC linkeada");
      qc.invalidateQueries({ queryKey: ["mailbox"] });
      qc.invalidateQueries({ queryKey: ["mailbox-detail", selectedId] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`No se pudo linkear: ${detail}`);
    },
  });

  const bulkArchiveMut = useMutation({
    mutationFn: (ids: number[]) =>
      apiClient.post(
        "/admin/mailbox/bulk-archive",
        { inbox_ids: ids, reason: "archived_bulk" },
        session,
      ),
    onSuccess: (data: any) => {
      toast.success(`${data.archived ?? 0} emails archivados`);
      setBulkSelected(new Set());
      qc.invalidateQueries({ queryKey: ["mailbox"] });
    },
    onError: (e: unknown) => {
      const detail = e instanceof ApiError ? e.detail : "Error desconocido";
      toast.error(`Bulk archive falló: ${detail}`);
    },
  });

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href={"/admin" as Route}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            Panel admin
          </Link>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
            Inbox · contactocehta@gmail.com
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            IMAP poll cada 15min (cron Fly). Claude clasifica y genera draft de
            respuesta — Nicolás revisa y aprueba antes de enviar.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => pollMut.mutate()}
            disabled={pollMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green disabled:opacity-50"
          >
            {pollMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Refrescar IMAP
          </button>
          <button
            type="button"
            onClick={() => classifyMut.mutate()}
            disabled={classifyMut.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {classifyMut.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            Clasificar pendientes
          </button>
        </div>
      </div>

      {/* Filtros + bulk bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-hairline bg-ink-50/30 px-4 py-3">
        <Tag className="h-3.5 w-3.5 text-ink-400" strokeWidth={1.75} />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border-0 bg-white px-3 py-1.5 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          <option value="">Todos los estados</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="rounded-lg border-0 bg-white px-3 py-1.5 text-xs ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          <option value="">Todas las categorías</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {bulkSelected.size > 0 && (
          <div className="ml-auto flex items-center gap-2 rounded-lg bg-cehta-green/10 px-3 py-1.5 text-xs text-cehta-green">
            <span className="font-semibold">
              {bulkSelected.size} seleccionados
            </span>
            <button
              type="button"
              onClick={() =>
                bulkArchiveMut.mutate(Array.from(bulkSelected))
              }
              disabled={bulkArchiveMut.isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-cehta-green px-2.5 py-1 font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {bulkArchiveMut.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Archive className="h-3 w-3" strokeWidth={1.75} />
              )}
              Archivar selección
            </button>
            <button
              type="button"
              onClick={() => setBulkSelected(new Set())}
              className="text-cehta-green/70 hover:text-cehta-green"
            >
              Limpiar
            </button>
          </div>
        )}
      </div>

      {/* Lista + drawer */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_minmax(0,420px)]">
        <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
          {isLoading ? (
            <p className="p-8 text-sm text-ink-500">Cargando inbox…</p>
          ) : !items || items.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 p-12 text-center">
              <Inbox
                className="h-10 w-10 text-ink-300"
                strokeWidth={1.25}
              />
              <p className="text-sm text-ink-500">
                Sin mails procesados. Tocá &ldquo;Refrescar IMAP&rdquo; para
                bajar lo nuevo.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-hairline">
              {items.map((it) => (
                <li
                  key={it.inbox_id}
                  className={`cursor-pointer p-4 transition-colors hover:bg-ink-50/40 ${
                    selectedId === it.inbox_id ? "bg-ink-50/60" : ""
                  } ${bulkSelected.has(it.inbox_id) ? "bg-cehta-green/5" : ""}`}
                  onClick={() => {
                    setSelectedId(it.inbox_id);
                    setDraft("");
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <input
                      type="checkbox"
                      checked={bulkSelected.has(it.inbox_id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleBulk(it.inbox_id)}
                      className="mt-1 h-3.5 w-3.5 shrink-0 rounded border-hairline text-cehta-green focus:ring-cehta-green"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Mail
                          className="h-3.5 w-3.5 shrink-0 text-ink-400"
                          strokeWidth={1.75}
                        />
                        <p className="truncate font-medium text-ink-900">
                          {it.subject || "(sin asunto)"}
                        </p>
                        {it.has_attachments && (
                          <Paperclip
                            className="h-3 w-3 shrink-0 text-ink-400"
                            strokeWidth={1.75}
                          />
                        )}
                      </div>
                      <p className="mt-1 truncate text-xs text-ink-500">
                        {it.from_name ?? it.from_email}
                        <span className="text-ink-400">
                          {" "}
                          · {it.from_email}
                        </span>
                      </p>
                      {it.ai_summary && (
                        <p className="mt-2 text-xs italic text-ink-600 line-clamp-2">
                          {it.ai_summary}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusTone(
                          it.status,
                        )}`}
                      >
                        {STATUS_LABELS[it.status] ?? it.status}
                      </span>
                      {it.category && (
                        <span className="rounded-full bg-ink-50 px-2 py-0.5 text-[10px] font-medium text-ink-600">
                          {CATEGORY_LABELS[it.category] ?? it.category}
                        </span>
                      )}
                      <p className="text-[10px] text-ink-400 tabular-nums">
                        {new Date(it.received_at).toLocaleString("es-CL", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Drawer detalle */}
        {selectedId && detail && (
          <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              {detail.category
                ? CATEGORY_LABELS[detail.category] ?? detail.category
                : "Sin clasificar"}
              {detail.ai_confidence !== null && (
                <span className="ml-1 text-ink-400">
                  · conf {(detail.ai_confidence * 100).toFixed(0)}%
                </span>
              )}
            </p>
            <h2 className="mt-1 font-display text-lg font-semibold text-ink-900">
              {detail.subject}
            </h2>
            <p className="mt-1 text-xs text-ink-500">
              De {detail.from_name ?? detail.from_email}{" "}
              <span className="text-ink-400">
                &lt;{detail.from_email}&gt;
              </span>
            </p>

            {detail.ai_summary && (
              <div className="mt-3 rounded-xl bg-ink-50/60 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  Resumen AI
                </p>
                <p className="mt-1 text-xs text-ink-700">{detail.ai_summary}</p>
                {detail.ai_suggested_action && (
                  <p className="mt-2 text-[11px] italic text-cehta-green">
                    → {detail.ai_suggested_action}
                  </p>
                )}
              </div>
            )}

            <details className="mt-3 group">
              <summary className="cursor-pointer text-xs font-medium text-ink-600 hover:text-cehta-green">
                Ver cuerpo original
              </summary>
              <div className="mt-2 max-h-60 overflow-auto rounded-xl bg-ink-50/40 p-3 text-[11px] text-ink-700 whitespace-pre-wrap">
                {detail.body_text ?? "(solo HTML — ver email cliente)"}
              </div>
            </details>

            {detail.attachments_meta.length > 0 && (
              <div className="mt-3 rounded-xl border border-hairline p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                  Adjuntos ({detail.attachments_meta.length})
                </p>
                <ul className="mt-1 space-y-1 text-xs">
                  {detail.attachments_meta.map((a, i) => (
                    <li key={i} className="text-ink-700">
                      <Paperclip
                        className="inline h-3 w-3 text-ink-400"
                        strokeWidth={1.75}
                      />{" "}
                      {a.filename}{" "}
                      <span className="text-ink-400">
                        ({Math.round(a.size_bytes / 1024)}KB)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Draft editor */}
            <div className="mt-4">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Draft de respuesta (editable)
              </label>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={10}
                placeholder="Esperando draft de Claude…"
                className="mt-1 w-full rounded-xl border-0 bg-ink-50/60 p-3 font-mono text-[11px] ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </div>

            {/* Sugerencias por categoría — atajos contextuales */}
            {detail.category &&
              ["factura_proveedor", "boleta_honorarios"].includes(
                detail.category,
              ) && (
                <div className="mt-3">
                  <Link
                    href={
                      `/vouchers/nuevo?tipo=COMPRA&from_email=${detail.inbox_id}&glosa=${encodeURIComponent(
                        detail.subject,
                      )}` as Route
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-cehta-green/40 bg-cehta-green/5 px-3 py-1.5 text-xs font-medium text-cehta-green hover:bg-cehta-green hover:text-white"
                  >
                    <Receipt className="h-3.5 w-3.5" strokeWidth={1.75} />
                    Crear voucher COMPRA desde este email →
                  </Link>
                </div>
              )}
            {detail.category === "pago_confirmado" && (
              <div className="mt-3">
                <Link
                  href={"/ordenes-compra?estado=aprobada" as Route}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100"
                >
                  <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Buscar OC para marcar como pagada →
                </Link>
              </div>
            )}

            {/* Linkeo con artefactos */}
            <div className="mt-4 rounded-xl border border-hairline p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
                Linkear con artefactos
              </p>
              {detail.linked_voucher_id || detail.linked_oc_id ? (
                <div className="mt-2 space-y-1 text-xs">
                  {detail.linked_voucher_id && (
                    <p className="flex items-center gap-1.5 text-ink-700">
                      <Receipt
                        className="h-3 w-3 text-cehta-green"
                        strokeWidth={1.75}
                      />
                      Voucher #{detail.linked_voucher_id}{" "}
                      <Link
                        href={
                          `/vouchers/${detail.linked_voucher_id}` as Route
                        }
                        className="text-cehta-green hover:underline"
                      >
                        Abrir →
                      </Link>
                    </p>
                  )}
                  {detail.linked_oc_id && (
                    <p className="flex items-center gap-1.5 text-ink-700">
                      <FileText
                        className="h-3 w-3 text-cehta-green"
                        strokeWidth={1.75}
                      />
                      OC #{detail.linked_oc_id}{" "}
                      <Link
                        href={
                          `/ordenes-compra/${detail.linked_oc_id}` as Route
                        }
                        className="text-cehta-green hover:underline"
                      >
                        Abrir →
                      </Link>
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-[11px] italic text-ink-500">
                  Sin artefactos linkeados.
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  placeholder="ID voucher"
                  min={1}
                  className="w-28 rounded-lg border-0 bg-ink-50 px-2 py-1 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = Number((e.target as HTMLInputElement).value);
                      if (v > 0) {
                        linkVoucherMut.mutate(v);
                        (e.target as HTMLInputElement).value = "";
                      }
                    }
                  }}
                />
                <input
                  type="number"
                  placeholder="ID OC"
                  min={1}
                  className="w-28 rounded-lg border-0 bg-ink-50 px-2 py-1 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const v = Number((e.target as HTMLInputElement).value);
                      if (v > 0) {
                        linkOcMut.mutate(v);
                        (e.target as HTMLInputElement).value = "";
                      }
                    }
                  }}
                />
                <span className="text-[10px] italic text-ink-400">
                  Enter para linkear
                </span>
              </div>
            </div>

            {/* Acciones */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => replyMut.mutate({ body_html: draft })}
                disabled={
                  replyMut.isPending ||
                  detail.status === "replied" ||
                  !draft.trim()
                }
                className="inline-flex items-center gap-1.5 rounded-lg bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {replyMut.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" strokeWidth={1.75} />
                )}
                Enviar respuesta
              </button>
              {detail.status === "archived" ? (
                <button
                  type="button"
                  onClick={() => restoreMut.mutate(detail.inbox_id)}
                  disabled={restoreMut.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-600 hover:border-cehta-green/40 hover:text-cehta-green disabled:opacity-50"
                >
                  {restoreMut.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
                  )}
                  Restaurar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => archiveMut.mutate(detail.inbox_id)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-600 hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                >
                  <Archive className="h-3.5 w-3.5" strokeWidth={1.75} />
                  Archivar
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelectedId(null);
                  setDraft("");
                }}
                className="ml-auto text-xs text-ink-500 hover:text-ink-700"
              >
                Cerrar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
