"use client";

/**
 * /admin/conciliacion
 *
 * Dashboard de conciliación bancaria:
 *   - 4 KPIs: vouchers conciliados / no conciliados / movimientos huérfanos / monto pendiente
 *   - Botón "Auto-conciliar" → corre algoritmo de match automático
 *   - Tab 1: Vouchers EXECUTED sin movimiento bancario
 *   - Tab 2: Movimientos bancarios sin voucher apuntándoles
 */
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  RefreshCw,
  Sparkles,
  Wallet,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import type {
  AutoRunReport,
  ConciliacionSummary,
  MovimientoHuerfano,
  VoucherNoConciliado,
} from "@/lib/api/schema";

interface Empresa {
  codigo: string;
  razon_social: string;
}

const fmtCLP = (v: number) => `$${Math.round(v).toLocaleString("es-CL")}`;

export default function ConciliacionPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [empresa, setEmpresa] = useState("");
  const [tab, setTab] = useState<"vouchers" | "movimientos">("vouchers");

  const { data: empresas } = useQuery<Empresa[]>({
    queryKey: ["empresas"],
    queryFn: () => apiClient.get<Empresa[]>("/empresa", session),
    enabled: !!session,
  });

  // Default empresa
  if (!empresa && empresas && empresas.length > 0) {
    setEmpresa(empresas[0]!.codigo);
  }

  const { data: summary } = useQuery<ConciliacionSummary>({
    queryKey: ["conciliacion-summary", empresa],
    queryFn: () =>
      apiClient.get<ConciliacionSummary>(
        `/admin/conciliacion/summary?empresa=${empresa}`,
        session,
      ),
    enabled: !!session && !!empresa,
  });

  const { data: noConciliados } = useQuery<VoucherNoConciliado[]>({
    queryKey: ["no-conciliados", empresa],
    queryFn: () =>
      apiClient.get<VoucherNoConciliado[]>(
        `/admin/conciliacion/no-conciliados?empresa=${empresa}`,
        session,
      ),
    enabled: !!session && !!empresa,
  });

  const { data: huerfanos } = useQuery<MovimientoHuerfano[]>({
    queryKey: ["movimientos-huerfanos", empresa],
    queryFn: () =>
      apiClient.get<MovimientoHuerfano[]>(
        `/admin/conciliacion/movimientos-huerfanos?empresa=${empresa}`,
        session,
      ),
    enabled: !!session && !!empresa,
  });

  const autoRunMut = useMutation({
    mutationFn: async () =>
      apiClient.post<AutoRunReport>(
        "/admin/conciliacion/auto-run",
        { empresa_codigo: empresa, window_days: 3 },
        session,
      ),
    onSuccess: (r) => {
      const matched = r.matched_unico;
      const ambiguous = r.matched_ambiguo;
      const none = r.sin_candidatos;
      toast.success(
        `Auto-conciliación: ${matched} match${matched !== 1 ? "es" : ""} automático${matched !== 1 ? "s" : ""}`,
        {
          description: `${ambiguous} ambiguos · ${none} sin candidatos · ${r.vouchers_evaluados} evaluados`,
          duration: 8000,
        },
      );
      qc.invalidateQueries({ queryKey: ["conciliacion-summary", empresa] });
      qc.invalidateQueries({ queryKey: ["no-conciliados", empresa] });
      qc.invalidateQueries({ queryKey: ["movimientos-huerfanos", empresa] });
      qc.invalidateQueries({ queryKey: ["vouchers"] });
    },
    onError: (err) => {
      toast.error(err instanceof ApiError ? err.detail : "Error", {
        duration: 8000,
      });
    },
  });

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[400px]"
        style={{
          background:
            "radial-gradient(70% 50% at 50% 0%, rgba(35,108,79,0.05) 0%, transparent 65%)",
        }}
      />

      <div className="mx-auto max-w-[1280px] px-6 lg:px-10 pt-10 pb-20 space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-3xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
              Conciliación bancaria · V5 Fase 5
            </p>
            <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-[40px] sm:leading-[1.1]">
              Voucher ↔ Movimiento bancario
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
              Cierra el ciclo contable: cada voucher EXECUTED debería tener su
              movimiento bancario apuntándolo. El algoritmo automático
              matchea por monto + fecha (±3 días) + empresa. Los casos
              ambiguos quedan para revisión manual.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              className="rounded-lg border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              {(empresas ?? []).map((e) => (
                <option key={e.codigo} value={e.codigo}>
                  {e.codigo}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => autoRunMut.mutate()}
              disabled={!empresa || autoRunMut.isPending}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-cehta-green-700 disabled:opacity-60"
              title="Match automático: 1 candidato exacto = match. Múltiples = manual."
            >
              <Sparkles
                className={`h-4 w-4 ${autoRunMut.isPending ? "animate-pulse" : ""}`}
                strokeWidth={2.25}
              />
              {autoRunMut.isPending ? "Conciliando…" : "Auto-conciliar"}
            </button>
          </div>
        </header>

        {/* KPIs */}
        {summary && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi
              label="Conciliados"
              value={String(summary.conciliados)}
              hint="RECONCILED"
              tone="cehta"
            />
            <Kpi
              label="No conciliados"
              value={String(summary.no_conciliados)}
              hint="EXECUTED sin movimiento"
              tone={summary.no_conciliados > 0 ? "warning" : "ink"}
            />
            <Kpi
              label="Movs huérfanos"
              value={String(summary.movimientos_huerfanos)}
              hint="Banco sin voucher"
              tone={summary.movimientos_huerfanos > 0 ? "warning" : "ink"}
            />
            <Kpi
              label="Monto pendiente"
              value={fmtCLP(Number(summary.monto_pendiente))}
              hint="Σ vouchers EXECUTED"
            />
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-hairline">
          <button
            type="button"
            onClick={() => setTab("vouchers")}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === "vouchers"
                ? "border-cehta-green text-cehta-green"
                : "border-transparent text-ink-500 hover:text-ink-700"
            }`}
          >
            Vouchers no conciliados ({(noConciliados ?? []).length})
          </button>
          <button
            type="button"
            onClick={() => setTab("movimientos")}
            className={`border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              tab === "movimientos"
                ? "border-cehta-green text-cehta-green"
                : "border-transparent text-ink-500 hover:text-ink-700"
            }`}
          >
            Movimientos huérfanos ({(huerfanos ?? []).length})
          </button>
        </div>

        {/* Tab content */}
        {tab === "vouchers" ? (
          <VouchersTable items={noConciliados ?? []} />
        ) : (
          <MovimientosTable items={huerfanos ?? []} />
        )}
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  tone = "ink",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: "ink" | "cehta" | "warning";
}) {
  const accent =
    tone === "cehta"
      ? "border-cehta-green/30 bg-cehta-green/5"
      : tone === "warning"
        ? "border-warning/30 bg-warning/5"
        : "border-hairline bg-white";
  const valueColor =
    tone === "cehta"
      ? "text-cehta-green"
      : tone === "warning"
        ? "text-warning"
        : "text-ink-900";
  return (
    <div className={`rounded-2xl border ${accent} p-4 shadow-card`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        {label}
      </p>
      <p
        className={`mt-1 font-display text-2xl font-semibold tabular-nums ${valueColor}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] text-ink-500">{hint}</p>
    </div>
  );
}

function VouchersTable({ items }: { items: VoucherNoConciliado[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-positive/30 bg-positive/5 p-8 text-center">
        <CheckCircle2
          className="mx-auto h-10 w-10 text-positive"
          strokeWidth={1.5}
        />
        <p className="mt-3 text-sm text-ink-700">
          ¡No hay vouchers pendientes de conciliar! Todo cuadra con banco.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
      <table className="w-full text-sm">
        <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          <tr>
            <th className="px-4 py-2">Voucher</th>
            <th className="px-4 py-2">Tipo</th>
            <th className="px-4 py-2">Fecha</th>
            <th className="px-4 py-2">Glosa · Contraparte</th>
            <th className="px-4 py-2 text-right">Monto</th>
            <th className="px-4 py-2 text-right">Acción</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {items.map((v) => (
            <tr key={v.voucher_id} className="hover:bg-ink-50/40">
              <td className="px-4 py-2 font-mono text-xs tabular-nums">
                {v.codigo}
              </td>
              <td className="px-4 py-2">
                <span className="inline-flex rounded-full bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
                  {v.tipo}
                </span>
              </td>
              <td className="px-4 py-2 font-mono text-[10px] tabular-nums text-ink-500">
                {v.fecha_contable}
                {v.fecha_ejecucion && v.fecha_ejecucion !== v.fecha_contable && (
                  <>
                    <br />
                    <span className="text-ink-400">ejec: {v.fecha_ejecucion}</span>
                  </>
                )}
              </td>
              <td className="px-4 py-2">
                <p className="line-clamp-1 text-ink-700">{v.glosa}</p>
                {v.contraparte_nombre && (
                  <p className="text-[11px] text-ink-500">
                    {v.contraparte_nombre}
                  </p>
                )}
              </td>
              <td className="px-4 py-2 text-right font-mono tabular-nums">
                {fmtCLP(Number(v.total_debit))}
              </td>
              <td className="px-4 py-2 text-right">
                <Link
                  href={`/vouchers/${v.voucher_id}` as any}
                  className="inline-flex items-center gap-1 rounded-lg bg-cehta-green/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-cehta-green hover:bg-cehta-green/20"
                >
                  Conciliar
                  <ArrowRight className="h-3 w-3" strokeWidth={2.5} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MovimientosTable({ items }: { items: MovimientoHuerfano[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-2xl border border-positive/30 bg-positive/5 p-8 text-center">
        <CheckCircle2
          className="mx-auto h-10 w-10 text-positive"
          strokeWidth={1.5}
        />
        <p className="mt-3 text-sm text-ink-700">
          Sin movimientos huérfanos. Todos los movimientos del banco tienen
          su voucher correspondiente.
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-2xl border border-hairline bg-white">
      <header className="border-b border-hairline bg-amber-50/40 px-4 py-2">
        <p className="text-[11px] text-amber-800">
          <AlertCircle
            className="mr-1 inline h-3.5 w-3.5"
            strokeWidth={1.75}
          />
          Movimientos en banco que no tienen voucher contable. Investigá si
          falta el asiento o si fue un error de carga del ETL.
        </p>
      </header>
      <table className="w-full text-sm">
        <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          <tr>
            <th className="px-4 py-2">Fecha · Banco</th>
            <th className="px-4 py-2">Descripción</th>
            <th className="px-4 py-2">Proveedor</th>
            <th className="px-4 py-2 text-right">Monto</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-hairline">
          {items.map((m) => (
            <tr key={m.movimiento_id}>
              <td className="px-4 py-2 font-mono text-xs tabular-nums">
                {m.fecha}
                {m.banco && (
                  <p className="text-[10px] text-ink-500">{m.banco}</p>
                )}
              </td>
              <td className="px-4 py-2 text-xs">
                <p className="line-clamp-1 text-ink-700">
                  {m.descripcion ?? "—"}
                </p>
                {m.tipo_egreso && (
                  <p className="text-[10px] uppercase tracking-wider text-ink-400">
                    {m.tipo_egreso}
                  </p>
                )}
              </td>
              <td className="px-4 py-2 text-xs text-ink-700">
                {m.proveedor_nombre ?? "—"}
              </td>
              <td
                className={`px-4 py-2 text-right font-mono font-semibold tabular-nums ${
                  Number(m.monto) < 0 ? "text-negative" : "text-positive"
                }`}
              >
                {fmtCLP(Math.abs(Number(m.monto)))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
