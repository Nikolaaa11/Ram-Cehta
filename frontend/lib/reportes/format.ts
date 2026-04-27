/**
 * Helpers de formato para reportes — wrapper sobre `lib/format.ts` con
 * tolerancia a strings/null/undefined desde el backend (Decimal serializado).
 */
import { toCLP, toDate, toDateTime, toUF } from "@/lib/format";

export function fmtCLP(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return toCLP(n);
}

export function fmtUF(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return toUF(n);
}

export function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try {
    return toDate(v);
  } catch {
    return "—";
  }
}

export function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try {
    return toDateTime(v);
  } catch {
    return "—";
  }
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return v.toLocaleString("es-CL");
}

export function fmtFileTimestamp(d: Date = new Date()): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
