"use client";

import type { Route } from "next";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ReportShell } from "@/components/reportes/ReportShell";
import { ContableFilters, fmtCLP } from "@/components/reportes/ContableFilters";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { LibroMayorReport, PlanCuenta } from "@/lib/api/schema";

export default function LibroMayorPage() {
  const { session } = useSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const empresa = params.get("empresa") ?? "";
  const cuenta = params.get("cuenta") ?? "";
  const fechaDesde = params.get("fecha_desde") ?? "";
  const fechaHasta = params.get("fecha_hasta") ?? "";

  // Cuentas imputables de la empresa para el dropdown
  const { data: cuentas } = useQuery<PlanCuenta[]>({
    queryKey: ["cuentas-imputables", empresa],
    queryFn: () =>
      apiClient.get<PlanCuenta[]>(
        `/plan-cuentas?imputable=true&activa=true&empresa_codigo=${empresa}`,
        session,
      ),
    enabled: !!session && !!empresa,
  });

  const { data, isLoading } = useQuery<LibroMayorReport>({
    queryKey: ["libro-mayor", empresa, cuenta, fechaDesde, fechaHasta],
    queryFn: () => {
      const qs = new URLSearchParams({
        empresa,
        cuenta,
        fecha_desde: fechaDesde,
        fecha_hasta: fechaHasta,
      });
      return apiClient.get<LibroMayorReport>(
        `/reportes/contables/libro-mayor?${qs}`,
        session,
      );
    },
    enabled:
      !!session && !!empresa && !!cuenta && !!fechaDesde && !!fechaHasta,
  });

  const cuentaSelector = (
    <select
      value={cuenta}
      onChange={(e) => {
        const next = new URLSearchParams(params.toString());
        next.set("cuenta", e.target.value);
        router.replace(`${pathname}?${next}` as Route);
      }}
      className="rounded-lg border-0 bg-ink-50 px-3 py-1.5 text-xs ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green min-w-[260px]"
    >
      <option value="">— Cuenta —</option>
      {(cuentas ?? []).map((c) => (
        <option key={c.codigo} value={c.codigo}>
          {c.codigo} · {c.nombre}
        </option>
      ))}
    </select>
  );

  return (
    <ReportShell
      eyebrow="Reporte contable formal"
      title="Libro Mayor"
      subtitle={
        cuenta
          ? `Movimientos y saldo de ${cuenta} para ${empresa}.`
          : "Elegí empresa, cuenta y rango de fechas."
      }
      filters={<ContableFilters extra={cuentaSelector} />}
    >
      {!cuenta ? (
        <p className="rounded-2xl border border-dashed border-hairline bg-white p-8 text-center text-sm text-ink-500">
          Elegí una cuenta del selector arriba para ver su libro mayor.
        </p>
      ) : isLoading ? (
        <p className="text-sm text-ink-500">Cargando…</p>
      ) : !data || !data.cuenta ? (
        <p className="text-sm text-ink-500">Cuenta no encontrada o sin movimientos.</p>
      ) : (
        <>
          {/* Header de la cuenta + sumas */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4 print:grid-cols-4">
            <Tile label="Saldo apertura" value={fmtCLP(Number(data.saldo_apertura))} />
            <Tile label="Σ Debe" value={fmtCLP(Number(data.total_debe))} tone="positive" />
            <Tile label="Σ Haber" value={fmtCLP(Number(data.total_haber))} tone="warning" />
            <Tile
              label="Saldo cierre"
              value={fmtCLP(Number(data.saldo_cierre))}
              tone="cehta"
            />
          </div>

          <div className="mt-6 overflow-hidden rounded-2xl border border-hairline bg-white shadow-card print:rounded-none print:border-0 print:shadow-none">
            <header className="border-b border-hairline bg-ink-50/40 px-4 py-2">
              <p className="font-mono text-xs tabular-nums text-ink-700">
                {data.cuenta.codigo} · {data.cuenta.nombre}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-ink-500">
                {data.cuenta.tipo} · Nivel {data.cuenta.nivel}
              </p>
            </header>
            <table className="w-full text-xs">
              <thead className="bg-ink-50/30 text-left text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-3 py-2">Fecha · Voucher</th>
                  <th className="px-3 py-2">Glosa</th>
                  <th className="px-3 py-2">Proyecto · Área</th>
                  <th className="px-3 py-2 text-right">Debe</th>
                  <th className="px-3 py-2 text-right">Haber</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                <tr className="bg-ink-50/40 font-semibold">
                  <td colSpan={3} className="px-3 py-2 text-[10px] uppercase tracking-wider text-ink-500">
                    Saldo de apertura
                  </td>
                  <td colSpan={2} className="px-3 py-2 text-right font-mono tabular-nums">
                    {fmtCLP(Number(data.saldo_apertura))}
                  </td>
                </tr>
                {data.movimientos.map((m) => (
                  <tr key={`${m.voucher_id}-${m.line_number}`}>
                    <td className="px-3 py-2 align-top">
                      <p className="font-mono font-semibold tabular-nums">
                        {m.fecha_contable}
                      </p>
                      <p className="font-mono text-[10px] tabular-nums text-ink-500">
                        {m.voucher_codigo}
                      </p>
                    </td>
                    <td className="px-3 py-2 align-top text-[11px]">
                      <p className="text-ink-700">{m.glosa}</p>
                      {m.linea_descripcion && (
                        <p className="text-[10px] italic text-ink-500">
                          {m.linea_descripcion}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top font-mono text-[10px] tabular-nums text-ink-500">
                      {m.proyecto_codigo ?? "—"}
                      <br />
                      <span className="text-ink-400">{m.area_codigo ?? "—"}</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {Number(m.debit) > 0 ? fmtCLP(Number(m.debit)) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">
                      {Number(m.credit) > 0 ? fmtCLP(Number(m.credit)) : "—"}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-ink-900/20 bg-cehta-green/5 font-semibold">
                  <td colSpan={3} className="px-3 py-2 text-[10px] uppercase tracking-wider text-cehta-green">
                    Saldo de cierre
                  </td>
                  <td colSpan={2} className="px-3 py-2 text-right font-mono tabular-nums text-cehta-green">
                    {fmtCLP(Number(data.saldo_cierre))}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}
    </ReportShell>
  );
}

function Tile({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "positive" | "warning" | "cehta";
}) {
  const accent = {
    ink: "border-hairline bg-white text-ink-900",
    positive: "border-positive/20 bg-positive/5 text-positive",
    warning: "border-warning/20 bg-warning/5 text-warning",
    cehta: "border-cehta-green/30 bg-cehta-green/5 text-cehta-green",
  }[tone];
  return (
    <div className={`rounded-2xl border ${accent} p-4`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">
        {label}
      </p>
      <p className="mt-1 font-display text-lg font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}
