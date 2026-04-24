// SOLO formato visual (i18n). NADA de lógica de negocio aquí.
// Valores ya calculados por el backend — el frontend solo los presenta.

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

export const toCLP = (value: number): string => CLP.format(value);
export const toUF = (value: number): string => `UF ${UF.format(value)}`;
export const toDate = (value: Date | string): string =>
  DATE.format(typeof value === "string" ? new Date(value) : value);
export const toDateTime = (value: Date | string): string =>
  DATETIME.format(typeof value === "string" ? new Date(value) : value);
