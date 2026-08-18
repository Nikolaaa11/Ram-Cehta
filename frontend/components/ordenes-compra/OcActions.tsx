"use client";

/**
 * OcActions — botones de acción en el header del detalle de OC.
 *
 * Muestra Editar/Marcar pagada/Anular según `oc.allowed_actions` (computado
 * server-side combinando rbac.ROLE_SCOPES + estado de la OC).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle, Copy, Edit, FileDown, Trash2, XCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/components/ui/toast";
import { useSession } from "@/hooks/use-session";
import { useMe } from "@/hooks/use-me";
import { handleSessionExpired } from "@/lib/api/session-handling";
import { apiClient, ApiError } from "@/lib/api/client";
import { ocPdfFilename } from "@/lib/oc-filename";
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";
import { DuplicateOcDialog } from "@/components/ordenes-compra/DuplicateOcDialog";

interface Props {
  ocId: number;
  numeroOc: string;
  estado?: string;
  allowedActions: string[];
}

const linkBtn =
  "inline-flex items-center gap-2 rounded-xl bg-white px-3.5 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2";
const successBtn =
  "inline-flex items-center gap-2 rounded-xl bg-cehta-green px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2 disabled:opacity-60";
const dangerBtn =
  "inline-flex items-center gap-2 rounded-xl bg-negative/10 px-3.5 py-2 text-sm font-medium text-negative ring-1 ring-negative/20 transition-colors hover:bg-negative/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-negative focus-visible:ring-offset-2";

// Minimo de caracteres del motivo. Tiene que coincidir con
// MOTIVO_ELIMINACION_MIN del backend (app/schemas/orden_compra.py): si el
// front deja mandar menos, el usuario escribe, aprieta y recibe un 422.
const MOTIVO_MIN = 10;

export function OcActions({ ocId, numeroOc, estado, allowedActions }: Props) {
  const router = useRouter();
  const { session } = useSession();
  const { data: me } = useMe();
  const queryClient = useQueryClient();

  const canEdit = allowedActions.includes("update");
  const canCancel = allowedActions.includes("cancel");
  const canMarkPaid = allowedActions.includes("mark_paid");
  // Si el user puede editar esta OC, asumimos que tambien puede crear OCs en
  // esta empresa — el endpoint backend valida igualmente con require_scope.
  const canDuplicate = canEdit;
  // Eliminacion fisica. Dos condiciones:
  //  1. el usuario tiene el scope global `oc:update`, que es EXACTAMENTE lo
  //     que exige el backend en DELETE /ordenes-compra/{id}. Antes se usaba
  //     `allowedActions.includes("update")`, pero el backend nunca emite la
  //     accion "update" en allowed_actions (emite download_pdf / approve /
  //     cancel / mark_paid / send_to_firma), asi que el boton Eliminar no
  //     aparecia NUNCA, en ningun estado;
  //  2. (ya no hay condicion de estado). Nicolas pidio poder borrar SIEMPRE,
  //     incluso una OC firmada o pagada, dejando registro. El backend ya no
  //     bloquea por estado ni por firmas: guarda una copia completa de la OC
  //     en core.oc_eliminadas —con quien la borro y por que— en la misma
  //     transaccion que el DELETE.
  // El acceso a la empresa lo sigue chequeando el backend (403).
  const canDelete = me?.allowed_actions?.includes("oc:update") ?? false;

  const deleteMutation = useMutation({
    mutationFn: (motivo: string) =>
      apiClient.delete<void>(`/ordenes-compra/${ocId}`, session, { motivo }),
    onSuccess: async () => {
      toast.success(`OC ${numeroOc} eliminada`);
      await queryClient.invalidateQueries({ queryKey: ["ordenes-compra"] });
      router.push("/ordenes-compra");
    },
    onError: (err) => {
      // El backend devuelve 409 con una explicacion larga (ya la firmo
      // fulano / tiene vouchers pagados / anulala en vez de borrarla).
      // Duracion extendida para que se alcance a leer.
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error al eliminar la OC",
        { duration: 12_000 },
      );
    },
  });

  const estadoMutation = useMutation({
    mutationFn: (estado: "pagada" | "anulada") =>
      apiClient.patch<unknown>(
        `/ordenes-compra/${ocId}/estado`,
        { estado },
        session,
      ),
    onSuccess: async (_data, estado) => {
      toast.success(
        estado === "pagada"
          ? `OC ${numeroOc} marcada como pagada`
          : `OC ${numeroOc} anulada`,
      );
      await queryClient.invalidateQueries({ queryKey: ["ordenes-compra"] });
      await queryClient.invalidateQueries({ queryKey: ["solicitudes-pago"] });
      router.refresh();
    },
    onError: (err) => {
      toast.error(
        err instanceof ApiError
          ? err.detail
          : err instanceof Error
            ? err.message
            : "Error al actualizar la OC",
      );
    },
  });

  if (!canEdit && !canCancel && !canMarkPaid && !canDuplicate && !canDelete)
    return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canEdit && (
        <Link
          href={`/ordenes-compra/${ocId}/editar`}
          className={linkBtn}
          aria-label={`Editar OC ${numeroOc}`}
        >
          <Edit className="h-4 w-4" strokeWidth={1.5} />
          Editar
        </Link>
      )}
      <button
        type="button"
        onClick={async () => {
          if (!session) {
            handleSessionExpired();
            return;
          }
          const toastId = toast.loading(`Generando PDF de OC ${numeroOc}...`);
          // R152LLLL — AbortController con timeout 90s (browser default 30s
          // era insuficiente para PDFs con muchos adjuntos + cold Fly start).
          // Cache logo en backend reduce el tiempo típico a <3s.
          const controller = new AbortController();
          const timeoutId = window.setTimeout(
            () => controller.abort(),
            90_000,
          );
          try {
            const base =
              process.env.NEXT_PUBLIC_API_URL ??
              "https://cehta-backend.fly.dev/api/v1";
            // Endpoint real PDF con branding empresa + adjuntos.
            const resp = await fetch(
              `${base}/ordenes-compra/${ocId}/pdf?include_attachments=true`,
              {
                headers: { Authorization: `Bearer ${session.access_token}` },
                signal: controller.signal,
                cache: "no-store",
              },
            );
            if (!resp.ok) {
              // R152LLLL — Leer detail del body para mostrar al user qué pasó
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
            if (blob.size === 0) {
              throw new Error("El servidor devolvió un PDF vacío");
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            // OC-FILENAME — helper compartido (espejo del backend).
            // `a.download` pisa el Content-Disposition: si se arma a mano
            // vuelve a divergir del nombre que manda el backend.
            a.download = ocPdfFilename(numeroOc);
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            toast.success(
              `OC ${numeroOc} descargada (${Math.round(blob.size / 1024)} KB)`,
              { id: toastId },
            );
          } catch (err) {
            // R152LLLL — mensajes accionables según el tipo de error
            let msg: string;
            if (err instanceof Error && err.name === "AbortError") {
              msg =
                "El PDF tardó más de 90s en generarse. " +
                "Reintentá en unos segundos (la primera vez es más lenta " +
                "porque el servidor está cold).";
            } else if (
              err instanceof TypeError &&
              err.message.toLowerCase().includes("fetch")
            ) {
              msg =
                "No se pudo conectar con el servidor. " +
                "(1) Verifica tu conexión; " +
                "(2) recargá con Ctrl+Shift+R; " +
                "(3) si persiste, espera 30s y reintentá.";
            } else {
              msg = err instanceof Error
                ? `No pude generar el PDF: ${err.message}`
                : "Error desconocido generando PDF";
            }
            toast.error(msg, { id: toastId, duration: 10_000 });
          } finally {
            window.clearTimeout(timeoutId);
          }
        }}
        className={linkBtn}
        title="Descarga PDF con branding empresa + adjuntos anexados (para mandar al proveedor)"
      >
        <FileDown className="h-4 w-4" strokeWidth={1.5} />
        Descargar PDF
      </button>
      {canDuplicate && (
        <DuplicateOcDialog
          ocId={ocId}
          numeroOcOriginal={numeroOc}
          trigger={
            <button
              type="button"
              className={linkBtn}
              aria-label={`Duplicar OC ${numeroOc}`}
            >
              <Copy className="h-4 w-4" strokeWidth={1.5} />
              Duplicar
            </button>
          }
        />
      )}
      {canMarkPaid && (
        <button
          type="button"
          onClick={() => estadoMutation.mutate("pagada")}
          disabled={estadoMutation.isPending}
          className={successBtn}
        >
          <CheckCircle className="h-4 w-4" strokeWidth={1.5} />
          {estadoMutation.isPending && estadoMutation.variables === "pagada"
            ? "Guardando…"
            : "Marcar pagada"}
        </button>
      )}
      {canCancel && (
        <ConfirmDeleteDialog
          trigger={
            <button type="button" className={dangerBtn}>
              <XCircle className="h-4 w-4" strokeWidth={1.5} />
              Anular
            </button>
          }
          title={`¿Anular OC ${numeroOc}?`}
          description={
            <>
              La orden de compra quedará como{" "}
              <span className="font-medium text-ink-900">anulada</span> y no
              podrá emitirse ni pagarse. Esta acción se registra en el
              historial.
            </>
          }
          confirmText="Anular OC"
          onConfirm={() => estadoMutation.mutateAsync("anulada")}
        />
      )}
      {canDelete && (
        <ConfirmDeleteDialog
          trigger={
            <button
              type="button"
              className={dangerBtn}
              disabled={deleteMutation.isPending}
              aria-label={`Eliminar OC ${numeroOc}`}
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.5} />
              {deleteMutation.isPending ? "Eliminando…" : "Eliminar"}
            </button>
          }
          title={`¿Eliminar la OC ${numeroOc}?`}
          description={
            <>
              La orden de compra{" "}
              <span className="font-medium text-ink-900">{numeroOc}</span> sale
              del listado junto con sus ítems, su forma de pago y sus
              firmantes. Los correos y vouchers relacionados no se borran:
              solo dejan de estar asociados a esta OC.
              <br />
              <br />
              <span className="font-medium text-ink-900">
                Queda un registro permanente
              </span>{" "}
              en Órdenes de compra → Eliminadas, con una copia completa del
              documento, tu nombre, la fecha y el motivo que escribas acá. Ese
              registro no se puede editar ni borrar.
              {estado === "firmada" || estado === "pagada" ? (
                <>
                  <br />
                  <br />
                  <span className="font-medium text-negative">
                    Ojo: esta OC está {estado}.
                  </span>{" "}
                  Es el respaldo de un compromiso con un tercero. Si sólo
                  querés dejarla sin efecto, <em>Anular</em> hace eso y la deja
                  a la vista.
                </>
              ) : null}
            </>
          }
          confirmText="Eliminar definitivo"
          motivo={{
            label: "¿Por qué se elimina?",
            placeholder:
              "Ej: cargada con el proveedor equivocado, se reemplaza por la OC0046.",
            minLength: MOTIVO_MIN,
            hint: "Queda guardado para siempre. Es lo único que va a explicar este borrado.",
          }}
          onConfirm={(motivo) => deleteMutation.mutateAsync(motivo)}
        />
      )}
    </div>
  );
}
