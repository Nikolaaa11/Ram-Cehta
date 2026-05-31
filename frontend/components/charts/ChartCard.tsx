"use client";

/**
 * ChartCard — wrapper consistente para visualizaciones (R152bb).
 *
 * Provee:
 *   - Surface con padding correcto
 *   - Header con título + subtítulo + acciones opcionales
 *   - Loading skeleton coherente
 *   - Empty state
 *   - Error state
 *
 * Uso:
 *   <ChartCard title="Vouchers por estado" subtitle="Últimos 30d">
 *     <RechartsBarChart ... />
 *   </ChartCard>
 */
import { ReactNode } from "react";
import { AlertCircle, BarChart3 } from "lucide-react";

interface Props {
  title: string;
  subtitle?: string;
  /** Acciones a la derecha (botón de export, filtros, etc) */
  actions?: ReactNode;
  /** Children: el chart real */
  children: ReactNode;
  loading?: boolean;
  error?: string | null;
  empty?: boolean;
  emptyMessage?: string;
  /** Altura mínima del área del chart (px) */
  minHeight?: number;
  className?: string;
}

export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  loading,
  error,
  empty,
  emptyMessage = "No hay datos para mostrar todavía",
  minHeight = 240,
  className = "",
}: Props) {
  return (
    <div
      className={`rounded-2xl border border-hairline bg-white p-5 shadow-card transition-shadow hover:shadow-elevated-lg ${className}`}
    >
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight text-ink-900">
            {title}
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-ink-500">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>

      <div style={{ minHeight }}>
        {loading ? (
          <div
            className="flex animate-pulse items-center justify-center rounded-xl bg-ink-100/40"
            style={{ height: minHeight }}
          >
            <BarChart3 className="size-8 text-ink-300" strokeWidth={1.4} />
          </div>
        ) : error ? (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-xl bg-red-50/40 px-4 text-center"
            style={{ height: minHeight }}
          >
            <AlertCircle className="size-6 text-red-500" strokeWidth={1.6} />
            <p className="text-xs font-medium text-red-700">No se pudo cargar</p>
            <p className="text-[10px] text-red-600">{error}</p>
          </div>
        ) : empty ? (
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-xl bg-ink-50/40 px-4 text-center"
            style={{ height: minHeight }}
          >
            <BarChart3 className="size-7 text-ink-300" strokeWidth={1.4} />
            <p className="text-xs text-ink-500">{emptyMessage}</p>
          </div>
        ) : (
          children
        )}
      </div>
    </div>
  );
}
