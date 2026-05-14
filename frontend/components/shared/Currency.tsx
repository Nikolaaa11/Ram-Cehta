"use client";

/**
 * Currency — componente unificado para mostrar montos.
 *
 * Round 2 polish: reemplaza los ~6 implementaciones inline de fmt(amount)
 * dispersas por vouchers (list/detail/nuevo/nubox/import/importar/desde-mensaje)
 * con un componente tipográficamente consistente.
 *
 * Uso:
 *   <Currency value={1234567} moneda="CLP" size="lg" />
 *   <Currency value={voucher.total_debit} size="xl" tone="success" />
 *   <Currency value={diff} tone={diff === 0 ? "success" : "danger"} />
 *
 * Convenciones:
 *   - tabular-nums siempre (columnas alineadas en tablas).
 *   - font-display en sizes md/lg/xl (matchea hero titles del design system).
 *   - $ prefix para CLP, código ISO para otras monedas.
 *   - Soporta string o number en input (vouchers vienen como string desde JSON).
 *   - Tone success/danger útil para Σ Debe / Haber / Diferencia.
 */
import { cn } from "@/lib/utils";

type Size = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
type Tone = "default" | "success" | "danger" | "warning" | "muted";

interface Props {
  value: number | string | null | undefined;
  moneda?: string;
  size?: Size;
  tone?: Tone;
  /** Si true, oculta el símbolo de moneda. */
  hideSymbol?: boolean;
  /** Número de decimales (default 0 para CLP, 2 otros). */
  decimals?: number;
  /** className extra para casos especiales. */
  className?: string;
  /** Si true, fuerza negativo entre paréntesis estilo contable (Σ Haber). */
  accounting?: boolean;
  /** Para títulos de página, h1 visualmente. */
  as?: "span" | "div" | "p";
}

const SIZE_CLASS: Record<Size, string> = {
  xs: "text-xs",
  sm: "text-sm",
  md: "text-base font-display font-semibold",
  lg: "text-lg font-display font-semibold tracking-tight",
  xl: "text-2xl font-display font-semibold tracking-tight",
  "2xl": "text-3xl font-display font-bold tracking-tight",
};

const TONE_CLASS: Record<Tone, string> = {
  default: "text-ink-900",
  success: "text-positive",
  danger: "text-negative",
  warning: "text-warning",
  muted: "text-ink-500",
};

function parseAmount(value: Props["value"]): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return value;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function formatNumber(n: number, decimals: number): string {
  return n.toLocaleString("es-CL", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function Currency({
  value,
  moneda = "CLP",
  size = "sm",
  tone = "default",
  hideSymbol = false,
  decimals,
  className,
  accounting = false,
  as: Tag = "span",
}: Props) {
  const n = parseAmount(value);
  const isNeg = n < 0;
  const abs = Math.abs(n);

  // Default decimals: 0 para CLP, 2 otros
  const effectiveDecimals = decimals ?? (moneda === "CLP" ? 0 : 2);

  // Símbolo según moneda
  const symbol = moneda === "CLP" ? "$" : moneda === "USD" ? "US$" : moneda;
  const useCode = moneda !== "CLP" && moneda !== "USD";

  const numberStr = formatNumber(abs, effectiveDecimals);

  let display: string;
  if (accounting && isNeg) {
    display = `(${hideSymbol ? "" : (useCode ? "" : `${symbol} `)}${numberStr}${useCode ? ` ${moneda}` : ""})`;
  } else {
    const sign = isNeg ? "-" : "";
    display = hideSymbol
      ? `${sign}${numberStr}`
      : useCode
        ? `${sign}${numberStr} ${moneda}`
        : `${sign}${symbol}${numberStr}`;
  }

  // Si tone="default" pero accounting + negativo, tono danger automático
  const effectiveTone =
    tone === "default" && accounting && isNeg ? "danger" : tone;

  return (
    <Tag
      className={cn(
        "tabular-nums whitespace-nowrap",
        SIZE_CLASS[size],
        TONE_CLASS[effectiveTone],
        className,
      )}
      title={moneda !== "CLP" ? `${numberStr} ${moneda}` : undefined}
    >
      {display}
    </Tag>
  );
}

/**
 * CurrencyDelta — muestra una diferencia (positiva/negativa) con
 * color automático y arrow opcional.
 */
export function CurrencyDelta({
  value,
  moneda = "CLP",
  size = "sm",
  showArrow = true,
  className,
}: Pick<Props, "value" | "moneda" | "size" | "className"> & {
  showArrow?: boolean;
}) {
  const n = parseAmount(value);
  if (n === 0) {
    return (
      <Currency
        value={0}
        moneda={moneda}
        size={size}
        tone="muted"
        className={className}
      />
    );
  }
  const tone: Tone = n > 0 ? "success" : "danger";
  const arrow = n > 0 ? "▲" : "▼";
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {showArrow && <span className={TONE_CLASS[tone]}>{arrow}</span>}
      <Currency value={n} moneda={moneda} size={size} tone={tone} />
    </span>
  );
}
