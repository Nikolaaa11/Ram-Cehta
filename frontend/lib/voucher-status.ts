/**
 * R152BBBBBB — Helpers de presentación para status de voucher / OC.
 *
 * Antes los badges mostraban "DRAFT", "PENDING", "APPROVED" literales del
 * backend — usuarios no-tech no entendían "DRAFT". Ahora hay una función
 * canónica que mapea a labels en español + colores consistentes.
 *
 * Si tu componente muestra un status badge, usá `voucherStatusLabel(status)`
 * y `voucherStatusTone(status)`.
 */

export type VoucherStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "EXECUTED"
  | "SYNCED"
  | "RECONCILED"
  | "VOID"
  | "CLOSED";

export type OcStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAGADA"
  | "PARCIAL"
  | "ANULADA";

const VOUCHER_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  PENDING: "Pendiente firma",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
  EXECUTED: "Ejecutado",
  // R152EEEEEE — labels que faltaban (backend SI los emite)
  SYNCED: "Sincronizado Nubox",
  RECONCILED: "Conciliado",
  VOID: "Anulado",
  CLOSED: "Cerrado",
};

const OC_LABELS: Record<string, string> = {
  DRAFT: "Borrador",
  PENDING: "Pendiente firma",
  APPROVED: "Aprobada",
  REJECTED: "Rechazada",
  PAGADA: "Pagada",
  PARCIAL: "Pago parcial",
  ANULADA: "Anulada",
};

/** Tonalidad sugerida para badges (Tailwind classes). */
const STATUS_TONES: Record<string, string> = {
  DRAFT: "bg-ink-100 text-ink-700",
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-100 text-red-800",
  EXECUTED: "bg-blue-100 text-blue-800",
  SYNCED: "bg-violet-100 text-violet-800",
  RECONCILED: "bg-violet-100 text-violet-800",
  VOID: "bg-ink-200 text-ink-600",
  CLOSED: "bg-ink-200 text-ink-600",
  PAGADA: "bg-emerald-100 text-emerald-800",
  PARCIAL: "bg-amber-100 text-amber-800",
  ANULADA: "bg-ink-200 text-ink-600",
};

/**
 * Devuelve label en español para un status de voucher.
 * Si no matchea, devuelve el status crudo (fallback safe).
 */
export function voucherStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return VOUCHER_LABELS[status] || status;
}

/**
 * Devuelve label en español para un status de OC.
 */
export function ocStatusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  return OC_LABELS[status] || status;
}

/**
 * Devuelve clases Tailwind para el badge según el status.
 */
export function statusTone(status: string | null | undefined): string {
  if (!status) return "bg-ink-100 text-ink-600";
  return STATUS_TONES[status] || "bg-ink-100 text-ink-600";
}
