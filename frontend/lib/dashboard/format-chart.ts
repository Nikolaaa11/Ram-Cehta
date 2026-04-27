/**
 * Formatters específicos para charts. Reducen verbosidad en ejes y leyendas.
 *
 * `formatM` colapsa números grandes para que los ticks del YAxis sean
 * legibles a 11px ($1.2M en vez de $1.234.567).
 *
 * `formatPeriodo` traduce el formato del backend ("MM_YY") a una etiqueta
 * humana en español ("Feb '26").
 */

const MESES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

export function formatM(v: number): string {
  if (v === 0 || Number.isNaN(v)) return "$0";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(0)}K`;
  return `${sign}$${abs}`;
}

export function formatPeriodo(periodo: string): string {
  // "02_26" → "Feb '26"
  if (!periodo || !periodo.includes("_")) return periodo;
  const [m, y] = periodo.split("_");
  const mi = parseInt(m ?? "", 10) - 1;
  const month = Number.isFinite(mi) && mi >= 0 && mi < 12 ? MESES[mi] : m;
  return `${month} '${y}`;
}

export function formatPeriodoFull(periodo: string): string {
  // "02_26" → "Febrero 2026"
  const NAMES = [
    "Enero",
    "Febrero",
    "Marzo",
    "Abril",
    "Mayo",
    "Junio",
    "Julio",
    "Agosto",
    "Septiembre",
    "Octubre",
    "Noviembre",
    "Diciembre",
  ];
  if (!periodo || !periodo.includes("_")) return periodo;
  const [m, y] = periodo.split("_");
  const mi = parseInt(m ?? "", 10) - 1;
  const month = Number.isFinite(mi) && mi >= 0 && mi < 12 ? NAMES[mi] : m;
  const year = `20${y}`;
  return `${month} ${year}`;
}
