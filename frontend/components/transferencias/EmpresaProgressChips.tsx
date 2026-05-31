"use client";

/**
 * EmpresaProgressChips — R152ii
 *
 * Reemplaza los chips planos por chips con un mini-donut por empresa
 * mostrando cuántos están seleccionados de los disponibles (X de Y).
 *
 * Mantiene la API simple: pasa `by_empresa` + `empresaFilter` + setter.
 */
import { Building2 } from "lucide-react";

/**
 * Mini ring (sin texto interno) usado dentro del chip. Reproduce la idea del
 * DonutKPI pero en 22px sin overflow del número interno.
 */
function MiniRing({
  value,
  total,
  color,
  size = 22,
}: {
  value: number;
  total: number;
  color: string;
  size?: number;
}) {
  const pct = total > 0 ? Math.max(0, Math.min(1, value / total)) : 0;
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = circumference * pct;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="#E5E7EB"
        strokeWidth={3}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeDasharray={`${dash} ${circumference - dash}`}
        strokeDashoffset={circumference / 4}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{
          transition:
            "stroke-dasharray 600ms cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />
    </svg>
  );
}

interface EmpresaSlice {
  empresa_codigo: string;
  count: number;
  total_clp: number;
}

interface Props {
  byEmpresa: EmpresaSlice[];
  selectedByEmpresa: Record<string, number>;
  totalCount: number;
  empresaFilter: string;
  onChange: (codigo: string) => void;
}

export function EmpresaProgressChips({
  byEmpresa,
  selectedByEmpresa,
  totalCount,
  empresaFilter,
  onChange,
}: Props) {
  if (byEmpresa.length <= 1) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        Por empresa:
      </span>
      <button
        type="button"
        onClick={() => onChange("")}
        className={`rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors ${
          empresaFilter === ""
            ? "bg-cehta-green/10 text-cehta-green ring-cehta-green/30"
            : "bg-white text-ink-600 ring-hairline hover:bg-ink-50"
        }`}
      >
        Todas ({totalCount})
      </button>
      {byEmpresa.map((b) => {
        const selected = selectedByEmpresa[b.empresa_codigo] ?? 0;
        const active = empresaFilter === b.empresa_codigo;
        return (
          <button
            key={b.empresa_codigo}
            type="button"
            onClick={() => onChange(b.empresa_codigo)}
            className={`group inline-flex items-center gap-2 rounded-full pl-2 pr-3 py-1 text-xs font-medium ring-1 transition-colors ${
              active
                ? "bg-blue-50 text-blue-700 ring-blue-200"
                : "bg-white text-ink-600 ring-hairline hover:bg-ink-50"
            }`}
            title={`${selected} de ${b.count} firmadas · listas`}
          >
            <MiniRing
              value={selected}
              total={b.count}
              color={active ? "#1D4ED8" : "#236C4F"}
            />
            <Building2 className="size-3" />
            <span>
              {b.empresa_codigo}{" "}
              <span className="text-ink-400 tabular-nums">
                {selected}/{b.count}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
