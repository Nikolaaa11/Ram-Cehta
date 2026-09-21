"use client";

/**
 * MotivoPagoDialog — marcar pagada una OC a la que le faltan firmas.
 *
 * Pasa en la vida real: el proveedor ya cobró y un firmante nunca entró a la
 * plataforma (TECMAVIDA tenía tres OC trabadas así). El backend lo permite
 * sólo con un motivo, que queda en el historial de la OC junto a los nombres
 * de quienes no firmaron. Las firmas NO se marcan como hechas: queda la
 * constancia de que faltaron.
 *
 * Controlado (open/onOpenChange). Quien decide si hace falta es el BACKEND:
 * la ficha y el kanban intentan marcar pagada sin motivo y, si responde 422
 * pidiéndolo, abren este diálogo con ese mismo mensaje (`detalle`), que ya
 * dice quiénes no firmaron. Así los externos que firman en papel —que el
 * backend no cuenta como pendientes— no disparan el diálogo por error.
 */
import { ConfirmDeleteDialog } from "@/components/shared/confirm-delete-dialog";

// Tiene que coincidir con _MOTIVO_PAGO_SIN_FIRMAS_MIN del backend
// (app/api/v1/ordenes_compra.py).
export const MOTIVO_PAGO_MIN = 10;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  numeroOc: string;
  /** Mensaje del backend (422) que explica quiénes faltan. Tiene prioridad. */
  detalle?: string | null;
  /** Nombres de quienes no firmaron, si se conocen. */
  pendientes?: string[] | null;
  /** "pagada" o "parcial". */
  estado?: "pagada" | "parcial";
  onConfirm: (motivo: string) => Promise<unknown>;
}

export function MotivoPagoDialog({
  open,
  onOpenChange,
  numeroOc,
  detalle,
  pendientes,
  estado = "pagada",
  onConfirm,
}: Props) {
  const n = pendientes?.length ?? 0;
  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      tone="neutral"
      title={`¿Marcar ${estado} la OC ${numeroOc} sin todas las firmas?`}
      description={
        detalle ? (
          <>
            {detalle} Las firmas quedan como{" "}
            <span className="font-medium text-ink-900">no firmadas</span>; el motivo queda con tu
            nombre y la fecha.
          </>
        ) : (
        <>
          {n > 0 ? (
            <>
              Falta{n === 1 ? "" : "n"} la{n === 1 ? "" : "s"} firma
              {n === 1 ? "" : "s"} de{" "}
              <span className="font-medium text-ink-900">
                {pendientes!.join(", ")}
              </span>
              .{" "}
            </>
          ) : (
            <>Esta OC todavía tiene firmas pendientes. </>
          )}
          Si el pago ya se hizo igual, puedes registrarlo: las firmas quedan
          como <span className="font-medium text-ink-900">no firmadas</span>{" "}
          y el motivo que escribas queda en el historial de la OC, con tu
          nombre y la fecha.
        </>
        )
      }
      confirmText={estado === "pagada" ? "Marcar pagada" : "Marcar parcial"}
      motivo={{
        label: "¿Por qué se marca pagada sin las firmas?",
        placeholder:
          "Ej: transferido el 15-09 (comprobante en Dropbox); José Maturana aprobó por correo y no usa la plataforma.",
        minLength: MOTIVO_PAGO_MIN,
        hint: "Queda registrado en el historial de la OC.",
      }}
      onConfirm={onConfirm}
    />
  );
}
