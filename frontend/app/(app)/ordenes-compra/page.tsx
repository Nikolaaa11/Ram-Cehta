"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowDownToLine,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit,
  ExternalLink,
  FileDown,
  FileText,
  LayoutGrid,
  ListIcon,
  Loader2,
  Mail,
  MessageSquare,
  Package,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
// R152SSSS — Tabs internos del módulo: bandeja mail + OCs firmadas →
// vouchers. Reemplaza el tab "Configuración" (sin valor operativo).
import { OcMailboxPanel } from "@/components/ordenes-compra/OcMailboxPanel";
import { OcFirmadasPanel } from "@/components/ordenes-compra/OcFirmadasPanel";
import { ocPdfFilename } from "@/lib/oc-filename";
import { useApiQuery } from "@/hooks/use-api-query";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ScopeIndicator } from "@/components/shared/ScopeIndicator";
import { Badge } from "@/components/ui/badge";
import { Combobox, type ComboboxItem } from "@/components/ui/combobox";
import { toCLP, toDate } from "@/lib/format";
import { ocStatusLabel } from "@/lib/voucher-status";
import { ExportExcelButton } from "@/components/shared/ExportExcelButton";
import { BulkActionBar } from "@/components/shared/BulkActionBar";
import { SavedViewsMenu } from "@/components/shared/SavedViewsMenu";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import { useMe } from "@/hooks/use-me";
import { useProveedoresCache } from "@/hooks/use-proveedores-cache";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";
import { handleSessionExpired } from "@/lib/api/session-handling";
import { toast } from "@/components/ui/toast";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { DuplicateOcDialog } from "@/components/ordenes-compra/DuplicateOcDialog";
import type { Page, OcListItem } from "@/lib/api/schema";

type BadgeVariant = "success" | "danger" | "warning" | "neutral" | "info";

const ESTADO_VARIANT: Record<string, BadgeVariant> = {
  borrador: "neutral",
  emitida: "info",
  pagada: "success",
  parcial: "warning",
  pendiente: "warning",
  aprobada: "info",
  anulada: "danger",
  rechazada: "danger",
};

function EstadoBadge({ estado }: { estado: string }) {
  // R152CCCCCC — Localizar con ocStatusLabel para soportar formato
  // backend uppercase inglés (DRAFT/PENDING/APPROVED).
  const variant = ESTADO_VARIANT[estado.toLowerCase()] ?? "neutral";
  return <Badge variant={variant}>{ocStatusLabel(estado)}</Badge>;
}

const ESTADOS = [
  "emitida",
  "pagada",
  "anulada",
  "pendiente",
  "aprobada",
  "rechazada",
];

// Biblioteca de OC — se agrega "Proveedor" porque el buscador filtra por
// proveedor: buscar por algo que no se ve en pantalla es desorientador.
// El nombre sale del cache de proveedores (1 sola query compartida), no
// de un fetch por fila.
//
// NO hay columna de firmas a propósito: `OrdenCompraListItem` (backend,
// app/schemas/orden_compra.py) sólo trae oc_id, numero_oc, empresa_codigo,
// proveedor_id, fecha_emision, moneda, neto, total, estado, pdf_url y
// allowed_actions. Para mostrar el avance de firmas haría falta que el
// backend agregue el conteo agregado (ej. firmas_total + firmas_firmadas
// con un LEFT JOIN a core.oc_firmas en el listado). Resolverlo desde el
// frontend sería un fetch por fila (N+1) y no se hace.
const COLUMNS = [
  "select",
  "N° OC",
  "Empresa",
  "Proveedor",
  "Fecha",
  "Moneda",
  "Total",
  "Estado",
  "",
];

const OC_BULK_OPTIONS = [
  { value: "pagada", label: "Marcar pagada" },
  { value: "anulada", label: "Anular" },
];

function TableSkeleton() {
  return (
    <Surface padding="none">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-hairline text-sm">
          <thead className="bg-ink-100/40">
            <tr>
              {COLUMNS.map((h, idx) => (
                <th
                  key={`${h}-${idx}`}
                  className="px-4 py-3 text-left text-xs uppercase tracking-wide text-ink-500 font-medium"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {Array.from({ length: 6 }).map((_, i) => (
              <tr key={i}>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-4 rounded" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-24" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-32" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-20" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-4 w-12" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="ml-auto h-4 w-24" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="h-5 w-16 rounded-full" />
                </td>
                <td className="px-4 py-3">
                  <Skeleton className="ml-auto h-4 w-32" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Surface>
  );
}

// Botón-ícono de la fila. Compacto para que las 5 acciones entren sin
// empujar la tabla, pero con área de click de 32px (táctil aceptable).
const rowIconBtn =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green disabled:opacity-50";
const rowIconBtnDanger =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-negative/10 hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative disabled:opacity-50";

/**
 * Acciones por fila de la biblioteca de OC: Ver · Editar · Duplicar ·
 * Descargar PDF · Eliminar.
 *
 * El gating replica exactamente components/ordenes-compra/OcActions.tsx
 * (líneas 39-49). Puede hacerlo porque el backend calcula `allowed_actions`
 * con el MISMO `AuthorizationService.allowed_actions_for_oc(user, estado)`
 * tanto en el listado como en el detalle (ordenes_compra.py, _to_list_item
 * y _to_read) — los valores son "update" / "cancel" / "mark_paid" pelados,
 * NO los scopes globales con prefijo "oc:" que usa `me.allowed_actions`.
 *
 * Los diálogos van como botones directos y NO dentro de un menú "···":
 * Radix cierra el Popover cuando el Dialog le roba el foco, y al cerrarse
 * desmonta a sus hijos — el diálogo se cerraría solo apenas se abre. Con
 * íconos de 32px las 5 acciones entran cómodas en la fila y cada una queda
 * a un click, que es lo que se pidió.
 */
function OcRowActions({ oc }: { oc: OcListItem }) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [pdfPending, setPdfPending] = useState(false);

  const canEdit = oc.allowed_actions.includes("update");
  // Si puede editar esta OC asumimos que puede crear en la misma empresa —
  // el backend revalida con require_scope igual.
  const canDuplicate = canEdit;
  // Borrado físico: sólo 'emitida' (no pagada) o 'anulada'. El backend
  // (DELETE /ordenes-compra/{id}) valida estricto; esto sólo decide si
  // mostramos el botón.
  const canDelete = canEdit && (oc.estado === "emitida" || oc.estado === "anulada");

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiClient.delete<void>(`/ordenes-compra/${oc.oc_id}`, session),
    onSuccess: async () => {
      toast.success(`OC ${oc.numero_oc} eliminada`);
      // Prefijo: invalida todas las páginas/filtros del listado.
      await queryClient.invalidateQueries({ queryKey: ["ordenes-compra"] });
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "No se pudo eliminar la OC",
      );
    },
  });

  async function descargarPdf() {
    if (!session) {
      handleSessionExpired();
      return;
    }
    setPdfPending(true);
    const toastId = toast.loading(`Generando PDF de OC ${oc.numero_oc}…`);
    // Mismo timeout de 90s que OcActions (R152LLLL): el default del browser
    // no alcanza cuando la OC trae adjuntos y Fly arranca en frío.
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 90_000);
    try {
      const base =
        process.env.NEXT_PUBLIC_API_URL ??
        "https://cehta-backend.fly.dev/api/v1";
      const resp = await fetch(
        `${base}/ordenes-compra/${oc.oc_id}/pdf?include_attachments=true`,
        {
          headers: { Authorization: `Bearer ${session.access_token}` },
          signal: controller.signal,
          cache: "no-store",
        },
      );
      if (!resp.ok) {
        let detail = "";
        try {
          const body = await resp.json();
          detail = body?.detail || "";
        } catch {
          detail = resp.statusText;
        }
        throw new Error(`HTTP ${resp.status}${detail ? ": " + detail : ""}`);
      }
      const blob = await resp.blob();
      if (blob.size === 0) throw new Error("El servidor devolvió un PDF vacío");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      // OC-FILENAME — el helper compartido (espejo del backend). `a.download`
      // pisa el Content-Disposition, así que el nombre TIENE que salir de acá
      // y no armarse a mano, si no diverge del que manda el backend.
      a.download = ocPdfFilename(oc.numero_oc);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`OC ${oc.numero_oc} descargada`, { id: toastId });
    } catch (err) {
      let msg: string;
      if (err instanceof Error && err.name === "AbortError") {
        msg =
          "El PDF tardó más de 90s en generarse. Reintentá en unos " +
          "segundos (la primera vez es más lenta porque el servidor " +
          "está frío).";
      } else if (
        err instanceof TypeError &&
        err.message.toLowerCase().includes("fetch")
      ) {
        msg =
          "No se pudo conectar con el servidor. Verificá tu conexión y " +
          "reintentá en 30 segundos.";
      } else {
        msg =
          err instanceof Error
            ? `No pude generar el PDF: ${err.message}`
            : "Error desconocido generando el PDF";
      }
      toast.error(msg, { id: toastId, duration: 10_000 });
    } finally {
      window.clearTimeout(timeoutId);
      setPdfPending(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-0.5">
      <Link
        href={`/ordenes-compra/${oc.oc_id}`}
        // Round 10 — prefetch eager para nav instantánea.
        prefetch={true}
        className="mr-1 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-cehta-green transition-colors hover:bg-cehta-green/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
        title={`Ver el detalle de la OC ${oc.numero_oc}`}
      >
        Ver
        <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
      </Link>

      {canEdit && (
        <Link
          href={`/ordenes-compra/${oc.oc_id}/editar`}
          className={rowIconBtn}
          title="Editar esta OC"
          aria-label={`Editar OC ${oc.numero_oc}`}
        >
          <Edit className="h-4 w-4" strokeWidth={1.5} />
        </Link>
      )}

      {canDuplicate && (
        // Reusa el diálogo existente: ya invalida ["ordenes-compra"] y
        // redirige a la OC nueva al confirmar.
        <DuplicateOcDialog
          ocId={oc.oc_id}
          numeroOcOriginal={oc.numero_oc}
          trigger={
            <button
              type="button"
              className={rowIconBtn}
              title="Duplicar: crea una OC nueva copiando proveedor, ítems y montos"
              aria-label={`Duplicar OC ${oc.numero_oc}`}
            >
              <Copy className="h-4 w-4" strokeWidth={1.5} />
            </button>
          }
        />
      )}

      <button
        type="button"
        onClick={descargarPdf}
        disabled={pdfPending}
        className={rowIconBtn}
        title="Descargar el PDF con logo de la empresa y anexos (para mandar al proveedor)"
        aria-label={`Descargar PDF de la OC ${oc.numero_oc}`}
      >
        {pdfPending ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
        ) : (
          <FileDown className="h-4 w-4" strokeWidth={1.5} />
        )}
      </button>

      {oc.pdf_url && (
        <a
          href={oc.pdf_url}
          target="_blank"
          rel="noopener noreferrer"
          className={rowIconBtn}
          title="Abrir el PDF archivado de esta OC"
          aria-label={`Abrir el PDF archivado de la OC ${oc.numero_oc}`}
        >
          <FileText className="h-4 w-4" strokeWidth={1.5} />
        </a>
      )}

      {canDelete && (
        <>
          {/* Separador: la acción destructiva queda aislada del resto para
              que un click de más no borre una OC. */}
          <span className="mx-1 h-5 w-px bg-hairline" aria-hidden="true" />
          <ConfirmDeleteDialog
            trigger={
              <button
                type="button"
                disabled={deleteMutation.isPending}
                className={rowIconBtnDanger}
                title="Eliminar esta OC definitivamente"
                aria-label={`Eliminar OC ${oc.numero_oc}`}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              </button>
            }
            title={`¿Eliminar la OC ${oc.numero_oc}?`}
            description={
              <>
                La orden de compra se{" "}
                <span className="font-medium text-ink-900">borra para siempre</span>{" "}
                y no se puede recuperar. Sólo se permite si está{" "}
                <span className="font-mono text-xs">emitida</span> o{" "}
                <span className="font-mono text-xs">anulada</span>. Si lo que
                querés es frenar el pago sin perder el rastro, entrá a la OC y
                usá <em>Anular</em>.
              </>
            }
            confirmText="Eliminar definitivo"
            onConfirm={() => deleteMutation.mutateAsync()}
          />
        </>
      )}
    </div>
  );
}

export default function OrdenesCompraPage() {
  const { data: empresas = [] } = useCatalogoEmpresas();
  const { data: me } = useMe();
  // Round 10 — URL state para filtros (mismo pattern que /vouchers en R8).
  // Refresh no pierde el filtro, links shareables, browser back funciona
  // como saved view.
  const searchParams = useSearchParams();
  // R152SSSS — tabs: "list" (default) | "mailbox" | "firmadas".
  // URL: ?tab=mailbox o ?tab=firmadas (default sin param).
  const [tab, setTab] = useState<"list" | "mailbox" | "firmadas">(() => {
    const t = searchParams.get("tab");
    if (t === "mailbox" || t === "firmadas") return t;
    return "list";
  });
  const [page, setPage] = useState(() =>
    Math.max(1, parseInt(searchParams.get("page") ?? "1", 10)),
  );
  const [empresa, setEmpresa] = useState(
    () => searchParams.get("empresa") ?? "",
  );
  const [estado, setEstado] = useState(
    () => searchParams.get("estado") ?? "",
  );
  // Buscador de texto. OJO: GET /ordenes-compra sólo acepta page, size,
  // empresa_codigo y estado — NO tiene búsqueda de texto. Por eso filtra
  // client-side sobre la página ya cargada, y el placeholder + la ayuda
  // debajo lo dicen explícito para no prometer lo que no hace.
  const [busqueda, setBusqueda] = useState(() => searchParams.get("q") ?? "");
  const SIZE = 20;

  // Sync state → URL (replaceState, no rerender, no history pollution).
  useEffect(() => {
    const params = new URLSearchParams();
    if (tab !== "list") params.set("tab", tab);
    if (page > 1) params.set("page", String(page));
    if (empresa) params.set("empresa", empresa);
    if (estado) params.set("estado", estado);
    if (busqueda.trim()) params.set("q", busqueda.trim());
    const qs = params.toString();
    const url = qs ? `/ordenes-compra?${qs}` : "/ordenes-compra";
    window.history.replaceState(null, "", url);
  }, [tab, page, empresa, estado, busqueda]);

  // Round 10 — quick filter chips + clear helper.
  // `hasActiveFilters` = sólo los filtros que viajan al backend. Se usa para
  // el empty state de "el servidor no devolvió nada"; la búsqueda de texto
  // no entra acá porque no afecta la query.
  const hasActiveFilters = !!empresa || !!estado;
  const hasBusqueda = busqueda.trim().length > 0;
  const clearAllFilters = () => {
    setEmpresa("");
    setEstado("");
    setBusqueda("");
    setPage(1);
  };
  const applyPreset = (preset: "pendientes" | "emitidas" | "borradores") => {
    setEmpresa("");
    setPage(1);
    if (preset === "pendientes") setEstado("pendiente");
    else if (preset === "emitidas") setEstado("emitida");
    else if (preset === "borradores") setEstado("borrador");
  };

  const params = new URLSearchParams({
    page: String(page),
    size: String(SIZE),
  });
  if (empresa) params.set("empresa_codigo", empresa);
  if (estado) params.set("estado", estado);

  const { data, isLoading, isError, error } = useApiQuery<Page<OcListItem>>(
    ["ordenes-compra", String(page), empresa, estado],
    `/ordenes-compra?${params.toString()}`,
  );

  // Bulk select — admin/finance pueden pagar/anular en masa.
  const canBulk =
    (me?.allowed_actions.includes("oc:mark_paid") ?? false) ||
    (me?.allowed_actions.includes("oc:cancel") ?? false);
  const items = useMemo(() => data?.items ?? [], [data]);

  // Catálogo completo de proveedores en UNA query compartida y cacheada
  // (5 min). Sirve para mostrar el nombre en la tabla y para que el
  // buscador pueda filtrar por proveedor: el listado de OCs sólo trae
  // `proveedor_id`, no la razón social.
  const { data: proveedoresCache = [] } = useProveedoresCache();
  const proveedorPorId = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of proveedoresCache) map.set(p.proveedor_id, p.razon_social);
    return map;
  }, [proveedoresCache]);

  // Filtro de texto client-side sobre la página cargada (el backend no
  // soporta búsqueda; ver comentario en el state `busqueda`).
  const filteredItems = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return items;
    return items.filter((oc) => {
      if (oc.numero_oc.toLowerCase().includes(q)) return true;
      const prov =
        oc.proveedor_id != null ? proveedorPorId.get(oc.proveedor_id) : undefined;
      return prov ? prov.toLowerCase().includes(q) : false;
    });
  }, [items, busqueda, proveedorPorId]);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const toggleId = (id: number) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // La selección efectiva se recorta SIEMPRE a lo que está visible ahora
  // mismo (página actual + búsqueda aplicada). Sin esto, seleccionar 10
  // OCs, escribir en el buscador y apretar "Anular" en la BulkActionBar
  // anulaba también las que ya no se ven — inaceptable en un módulo que
  // mueve plata. El estado crudo se conserva, así que volver atrás en la
  // paginación recupera la selección.
  const visibleIds = useMemo(
    () => new Set(filteredItems.map((i) => i.oc_id)),
    [filteredItems],
  );
  const selectedVisibleIds = useMemo(
    () => Array.from(selectedIds).filter((id) => visibleIds.has(id)),
    [selectedIds, visibleIds],
  );
  const toggleAll = () => {
    if (selectedVisibleIds.length === filteredItems.length)
      setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredItems.map((i) => i.oc_id)));
  };
  const allSelected =
    filteredItems.length > 0 &&
    selectedVisibleIds.length === filteredItems.length;
  const someSelected = selectedVisibleIds.length > 0 && !allSelected;

  const empresaItems = useMemo<ComboboxItem[]>(
    () => [
      { value: "", label: "Todas las empresas" },
      ...empresas.map((e) => ({
        value: e.codigo,
        label: `${e.codigo} — ${e.razon_social}`,
      })),
    ],
    [empresas],
  );

  const estadoItems = useMemo<ComboboxItem[]>(
    () => [
      { value: "", label: "Todos los estados" },
      ...ESTADOS.map((s) => ({
        value: s,
        label: s.charAt(0).toUpperCase() + s.slice(1),
      })),
    ],
    [],
  );

  // R152SSSS — Tab bar interna: Órdenes | Bandeja mail | Firmadas → Vouchers.
  const TABS: { id: "list" | "mailbox" | "firmadas"; label: string; icon: typeof ListIcon; title: string }[] = [
    { id: "list", label: "Órdenes", icon: ListIcon, title: "Todas las OCs creadas, con filtros." },
    { id: "mailbox", label: "Bandeja mail", icon: Mail, title: "Mails con OCs llegados a contactocehta@gmail.com." },
    { id: "firmadas", label: "Firmadas → Vouchers", icon: CheckCircle2, title: "OCs emitidas, generar vouchers y reenviar al GG." },
  ];
  const renderTabBar = () => (
    <div className="border-b border-hairline">
      <div className="flex items-center gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            title={t.title}
            className={
              "inline-flex items-center gap-1.5 px-4 py-2 -mb-px text-sm font-medium border-b-2 transition-colors " +
              (tab === t.id
                ? "border-cehta-green text-cehta-green"
                : "border-transparent text-ink-500 hover:text-ink-900")
            }
          >
            <t.icon className="h-4 w-4" strokeWidth={1.75} />
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (tab === "mailbox" || tab === "firmadas") {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
                Órdenes de Compra
              </h1>
              <ScopeIndicator />
            </div>
            <p className="mt-1 text-sm text-ink-500">
              {tab === "mailbox"
                ? "Mails con OCs llegados al correo institucional. Auto-crear desde aquí o correr el cron."
                : "OCs firmadas: enviar al GG por mail y generar los vouchers correspondientes."}
            </p>
          </div>
        </div>
        {renderTabBar()}
        {tab === "mailbox" ? <OcMailboxPanel /> : <OcFirmadasPanel />}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
              Órdenes de Compra
            </h1>
            <ScopeIndicator />
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {!data
              ? "Cargando órdenes…"
              : hasBusqueda
                ? `${filteredItems.length} de las ${items.length} órdenes de esta página coinciden con “${busqueda.trim()}” · ${data.total} en total`
                : `${data.total} orden${data.total !== 1 ? "es" : ""} en total`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle: Lista (current) | Kanban (sub-route) */}
          <div className="inline-flex rounded-xl bg-ink-100/50 p-0.5 ring-1 ring-hairline">
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-sm font-medium text-ink-900 shadow-card">
              <ListIcon className="h-4 w-4" strokeWidth={1.5} />
              Lista
            </span>
            <Link
              href={`/ordenes-compra/kanban${empresa ? `?empresa=${empresa}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors hover:bg-white/60"
            >
              <LayoutGrid className="h-4 w-4" strokeWidth={1.5} />
              Kanban
            </Link>
          </div>
          <ExportExcelButton
            entity="ordenes_compra"
            empresaCodigo={empresa || null}
            estado={estado || null}
          />
          <Link
            href="/ordenes-compra/import"
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green"
            title="Importar OCs desde CSV (Excel chileno)"
          >
            <ArrowDownToLine className="h-4 w-4" strokeWidth={1.75} />
            Importar CSV
          </Link>
          <Link
            href="/ordenes-compra/importar"
            className="inline-flex items-center gap-1.5 rounded-xl border border-cehta-green/30 bg-gradient-to-r from-cehta-green/10 to-cehta-green/5 px-3 py-2 text-sm font-medium text-cehta-green hover:from-cehta-green/15 hover:to-cehta-green/10"
            title="Sube una cotización (PDF/imagen/Excel/email) y la IA precarga la OC"
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            Importar con IA
          </Link>
          <Link
            href="/ordenes-compra/desde-mensaje"
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green"
            title="Pegá un email, WhatsApp o texto y la IA arma la OC"
          >
            <MessageSquare className="h-4 w-4" strokeWidth={1.75} />
            Desde mensaje
          </Link>
          <Link
            href="/ordenes-compra/nueva"
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60"
          >
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Nueva OC
          </Link>
        </div>
      </div>

      {/* R152RRRR — Tab bar (Órdenes | Configuración) */}
      {renderTabBar()}

      {/* Round 10 — Quick filter chips (mismo pattern que /vouchers R9).
          Presets de uso diario aplicables en 1 click. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Vistas rápidas:
        </span>
        <button
          type="button"
          onClick={() => applyPreset("pendientes")}
          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
            estado === "pendiente"
              ? "bg-amber-50 text-amber-700 ring-amber-200"
              : "bg-white text-ink-600 ring-hairline hover:bg-ink-50"
          }`}
        >
          ⏳ Pendientes
        </button>
        <button
          type="button"
          onClick={() => applyPreset("emitidas")}
          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
            estado === "emitida"
              ? "bg-blue-50 text-blue-700 ring-blue-200"
              : "bg-white text-ink-600 ring-hairline hover:bg-ink-50"
          }`}
        >
          📤 Emitidas
        </button>
        <button
          type="button"
          onClick={() => applyPreset("borradores")}
          className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
            estado === "borrador"
              ? "bg-ink-100 text-ink-700 ring-ink-200"
              : "bg-white text-ink-600 ring-hairline hover:bg-ink-50"
          }`}
        >
          ✏️ Borradores
        </button>
        {(hasActiveFilters || hasBusqueda) && (
          <button
            type="button"
            onClick={clearAllFilters}
            className="ml-1 rounded-full bg-white px-3 py-1 text-xs font-medium text-ink-500 ring-1 ring-hairline hover:bg-negative/5 hover:text-negative hover:ring-negative/20"
            title="Quitar todos los filtros y la búsqueda"
          >
            ✕ Limpiar filtros
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        {/* Buscador — filtra SOLO lo que ya está en pantalla. El backend no
            tiene búsqueda de texto en GET /ordenes-compra, así que el texto
            de ayuda es explícito para que nadie crea que busca en toda la
            base. */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="oc-busqueda"
            className="text-xs uppercase tracking-wide text-ink-500 font-medium"
          >
            Buscar
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
              strokeWidth={1.75}
            />
            <input
              id="oc-busqueda"
              type="search"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="N° de OC o proveedor (en esta página)"
              className="w-full min-w-[18rem] rounded-xl border border-hairline bg-white py-2 pl-9 pr-9 text-sm text-ink-900 placeholder:text-ink-400 focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
            {hasBusqueda && (
              <button
                type="button"
                onClick={() => setBusqueda("")}
                className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-900"
                title="Borrar la búsqueda"
                aria-label="Borrar la búsqueda"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-ink-500 font-medium">
            Empresa
          </label>
          <Combobox
            items={empresaItems}
            value={empresa}
            onValueChange={(v) => {
              setEmpresa(v);
              setPage(1);
            }}
            placeholder="Todas las empresas"
            triggerClassName="min-w-[14rem]"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs uppercase tracking-wide text-ink-500 font-medium">
            Estado
          </label>
          <Combobox
            items={estadoItems}
            value={estado}
            onValueChange={(v) => {
              setEstado(v);
              setPage(1);
            }}
            placeholder="Todos los estados"
            triggerClassName="min-w-[12rem]"
          />
        </div>

        <div className="ml-auto flex items-end">
          <SavedViewsMenu
            page="oc"
            currentFilters={{ empresa_codigo: empresa, estado }}
            onApply={(filters) => {
              setEmpresa(
                typeof filters.empresa_codigo === "string"
                  ? filters.empresa_codigo
                  : "",
              );
              setEstado(
                typeof filters.estado === "string" ? filters.estado : "",
              );
              setPage(1);
            }}
          />
        </div>
      </div>

      {/* Error state */}
      {isError && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            Error al cargar órdenes
          </p>
          <p className="mt-1 text-xs text-negative/80">{error?.message}</p>
        </Surface>
      )}

      {/* Loading state */}
      {isLoading && <TableSkeleton />}

      {/* Bulk action bar — sticky cuando hay selección. Opera SÓLO sobre las
          OCs visibles ahora (ver `selectedVisibleIds`). */}
      {canBulk && selectedVisibleIds.length > 0 && (
        <BulkActionBar
          count={selectedVisibleIds.length}
          ids={selectedVisibleIds}
          endpoint="/ordenes-compra/bulk-update-estado"
          estados={OC_BULK_OPTIONS}
          invalidateKeys={[["ordenes-compra", String(page), empresa, estado]]}
          onClear={() => setSelectedIds(new Set())}
          entityLabel={{ singular: "OC", plural: "OCs" }}
        />
      )}

      {/* Table / empty state */}
      {data && !isLoading && (
        <>
          {data.items.length === 0 ? (
            <Surface padding="none" className="overflow-hidden">
              {/* Round 10 — smart empty con CTA segun contexto.
                  Si hay filtros activos: ofrece limpiarlos (caso comun).
                  Si la lista esta realmente vacia: ofrece crear primera OC. */}
              {hasActiveFilters ? (
                <div className="p-10 text-center">
                  <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-400">
                    <Package className="size-5" strokeWidth={1.5} />
                  </div>
                  <p className="text-sm font-medium text-ink-700">
                    Sin órdenes que matcheen
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-xs text-ink-500">
                    Probaste{" "}
                    {[
                      empresa && `empresa=${empresa}`,
                      estado && `estado=${estado}`,
                    ]
                      .filter(Boolean)
                      .join(", ")}
                    . Ajustá los filtros o limpiá todo para ver la lista completa.
                  </p>
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-xs font-semibold text-white hover:bg-cehta-green-700"
                  >
                    Limpiar todos los filtros
                  </button>
                </div>
              ) : (
                <EmptyState
                  icon={Package}
                  title="Sin órdenes de compra todavía"
                  description="Creá tu primera OC para empezar a registrar compromisos de pago con proveedores."
                  action={{
                    label: "Nueva OC",
                    href: "/ordenes-compra/nueva",
                  }}
                  compact
                />
              )}
            </Surface>
          ) : filteredItems.length === 0 ? (
            /* El servidor SÍ devolvió OCs, pero ninguna matchea el texto
               buscado dentro de esta página. Caso distinto al de arriba. */
            <Surface padding="none" className="overflow-hidden">
              <div className="p-10 text-center">
                <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-full bg-ink-100 text-ink-400">
                  <Search className="size-5" strokeWidth={1.5} />
                </div>
                <p className="text-sm font-medium text-ink-700">
                  Ninguna OC de esta página dice “{busqueda.trim()}”
                </p>
                <p className="mx-auto mt-1 max-w-md text-xs text-ink-500">
                  La búsqueda mira sólo las {items.length} órdenes que están
                  cargadas en pantalla, no las {data.total} del total. Si la OC
                  que buscás no aparece, probá pasar de página o filtrar por
                  empresa y estado.
                </p>
                <button
                  type="button"
                  onClick={() => setBusqueda("")}
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-4 py-2 text-xs font-semibold text-white hover:bg-cehta-green-700"
                >
                  Borrar la búsqueda
                </button>
              </div>
            </Surface>
          ) : (
            <Surface padding="none" className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-hairline text-sm">
                  {/* Round 10 — sticky header en lista de OCs (mismo pattern
                      que /vouchers R9). z-10 evita que se tape con badges. */}
                  <thead className="sticky top-0 z-10 bg-ink-100/90 backdrop-blur-sm">
                    <tr>
                      {COLUMNS.map((h, idx) => (
                        <th
                          key={`${h}-${idx}`}
                          className={`px-4 py-3 text-xs uppercase tracking-wide text-ink-500 font-medium ${
                            h === "Total" ? "text-right" : "text-left"
                          }`}
                        >
                          {h === "select" ? (
                            canBulk ? (
                              <input
                                type="checkbox"
                                aria-label="Seleccionar todas"
                                checked={allSelected}
                                ref={(el) => {
                                  if (el) el.indeterminate = someSelected;
                                }}
                                onChange={toggleAll}
                                className="h-4 w-4 cursor-pointer rounded border-hairline text-cehta-green focus:ring-cehta-green focus:ring-offset-0"
                              />
                            ) : null
                          ) : (
                            h
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {filteredItems.map((oc) => {
                      const checked = selectedIds.has(oc.oc_id);
                      const proveedor =
                        oc.proveedor_id != null
                          ? proveedorPorId.get(oc.proveedor_id)
                          : undefined;
                      return (
                      <tr
                        key={oc.oc_id}
                        className={`group transition-colors duration-150 ${
                          checked
                            ? "bg-cehta-green/5 hover:bg-cehta-green/10"
                            : "hover:bg-ink-100/30"
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3">
                          {canBulk && (
                            <input
                              type="checkbox"
                              aria-label={`Seleccionar OC ${oc.numero_oc}`}
                              checked={checked}
                              onChange={() => toggleId(oc.oc_id)}
                              className="h-4 w-4 cursor-pointer rounded border-hairline text-cehta-green focus:ring-cehta-green focus:ring-offset-0"
                            />
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono font-medium text-ink-900">
                          {oc.numero_oc}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                          <div className="flex items-center gap-2">
                            <EmpresaLogo
                              empresaCodigo={oc.empresa_codigo}
                              size={22}
                            />
                            <span>{oc.empresa_codigo}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-ink-700">
                          {/* max-w + truncate van en el span, no en el <td>:
                              con table-layout auto el browser ignora el
                              max-width de la celda y la razón social larga
                              estiraría la tabla. */}
                          {proveedor ? (
                            <span
                              className="block max-w-[16rem] truncate"
                              title={proveedor}
                            >
                              {proveedor}
                            </span>
                          ) : (
                            <span className="text-ink-400">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-700 tabular-nums">
                          {toDate(oc.fecha_emision)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink-700">
                          {oc.moneda}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-medium text-ink-900 tabular-nums">
                          {oc.moneda === "CLP" ? toCLP(oc.total) : oc.total}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <EstadoBadge estado={oc.estado} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <OcRowActions oc={oc} />
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Surface>
          )}
        </>
      )}

      {/* Pagination */}
      {data && data.pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-ink-500 tabular-nums">
            Página {data.page} de {data.pages} · {data.total} resultados
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={data.page <= 1}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-50 disabled:hover:bg-white"
            >
              <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
              Anterior
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => p + 1)}
              disabled={data.page >= data.pages}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-50 disabled:hover:bg-white"
            >
              Siguiente
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
