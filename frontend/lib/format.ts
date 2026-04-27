// SOLO formato visual (i18n). NADA de lógica de negocio aquí.
// Valores ya calculados por el backend — el frontend solo los presenta.

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

const CLP = new Intl.NumberFormat("es-CL", {
  style: "currency",
  currency: "CLP",
  maximumFractionDigits: 0,
});

const UF = new Intl.NumberFormat("es-CL", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

const DATE = new Intl.DateTimeFormat("es-CL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const DATETIME = new Intl.DateTimeFormat("es-CL", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const toCLP = (value: number | string | null | undefined): string => {
  if (value === null || value === undefined) return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (Number.isNaN(num)) return "—";
  return CLP.format(num);
};
export const toUF = (value: number): string => `UF ${UF.format(value)}`;
export const toDate = (value: Date | string): string =>
  DATE.format(typeof value === "string" ? new Date(value) : value);
export const toDateTime = (value: Date | string): string =>
  DATETIME.format(typeof value === "string" ? new Date(value) : value);

/**
 * Formatea un porcentaje. El backend ya entrega el valor con su signo
 * (positivo o negativo); aquí solo presentamos.
 *
 * @param value - número en formato porcentual (8.2 = 8.2%)
 * @param opts.signed - si true, antepone "+" a valores positivos
 * @param opts.digits - decimales (default 1)
 */
export function toPct(
  value: number,
  opts?: { signed?: boolean; digits?: number },
): string {
  const digits = opts?.digits ?? 1;
  const formatted = value.toFixed(digits);
  if (opts?.signed && value > 0) return `+${formatted}%`;
  return `${formatted}%`;
}

/**
 * Tiempo relativo en español usando date-fns.
 *
 * Ejemplos: "hace 5 minutos", "hace 2 horas", "hace 1 día".
 * Devuelve "—" si la fecha es nula/indefinida.
 */
export function toRelative(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  return formatDistanceToNow(d, { locale: es, addSuffix: true });
}
