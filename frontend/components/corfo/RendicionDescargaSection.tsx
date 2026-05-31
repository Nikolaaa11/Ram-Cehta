"use client";

/**
 * RendicionDescargaSection — sección reutilizable de descarga de
 * rendiciones CORFO (R152mm).
 *
 * Diseñada para embed debajo del form de creación de voucher CORFO
 * (`/vouchers/corfo`) o de cualquier otra vista de empresa REVTECH/
 * TRONGKAI. Llama a los endpoints `/admin/corfo/rendicion/*` y descarga
 * los dos Excel oficiales del folio 2024-265638:
 *
 *   - Carga_Gastos (21 cols)
 *   - Carga_RRHH (17 cols)
 *
 * Pre-llenados con:
 *   - Vouchers COMPRA aprobados del período
 *   - Si voucher EXECUTED: Forma de Pago + Fecha de Pago
 *   - Trabajadores activos + remuneraciones Nubox del período (RRHH)
 *   - Mapeo cuenta_local → cuenta CORFO con auto-sugerencia
 *
 * Lo que queda manual (celdas amarillas):
 *   - Comprobante físico
 *   - Glosa CORFO específica
 *   - Receptor de la boleta (si aplica)
 */
import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CircleDollarSign,
  Download,
  AlertTriangle,
  CheckCircle2,
  Receipt,
  Users as UsersIcon,
  Settings2,
  ArrowRight,
  Sparkles,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { AnimatedNumber } from "@/components/charts/AnimatedNumber";
import { DonutKPI } from "@/components/charts/DonutKPI";

interface PreviewRow {
  voucher_id: number;
  fecha: string;
  cuenta_codigo: string;
  cuenta_nombre: string | null;
  monto_neto: number;
  monto_iva: number;
  monto_total: number;
  proveedor_rut: string | null;
  proveedor_nombre: string | null;
  folio: string | null;
  glosa: string | null;
  corfo_cuenta: string | null;
  corfo_item: string | null;
}

interface PreviewResp {
  empresa_codigo: string;
  periodo: string;
  periodo_corfo: string;
  rows: PreviewRow[];
  total_neto: number;
  total_iva: number;
  total_total: number;
  sin_mapeo: number;
}

interface Props {
  /** REVTECH o TRONGKAI */
  empresa: "REVTECH" | "TRONGKAI";
  /** Modo compacto para embed (default) vs full (página dedicada) */
  variant?: "compact" | "full";
}

function currentPeriodo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const fmtCLP = (n: number) =>
  n.toLocaleString("es-CL", { maximumFractionDigits: 0 });

export function RendicionDescargaSection({ empresa, variant = "compact" }: Props) {
  const { session } = useSession();
  const [periodo, setPeriodo] = useState(currentPeriodo());

  const preview = useQuery<PreviewResp>({
    queryKey: ["corfo", "preview", empresa, periodo],
    queryFn: () =>
      apiClient.get<PreviewResp>(
        `/admin/corfo/rendicion/preview?empresa=${empresa}&periodo=${periodo}`,
        session,
      ),
    enabled: !!session,
  });

  const downloadMut = useMutation({
    mutationFn: async (tipo: "gastos" | "rrhh") => {
      if (!session?.access_token) throw new Error("No session");
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? ""}/admin/corfo/rendicion/excel`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ empresa, periodo, tipo }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Rendicion_${tipo === "gastos" ? "Gastos" : "Rrhh"}_${empresa}_${periodo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });

  const rows = preview.data?.rows ?? [];
  const totalDocs = rows.length;
  const sinMapeo = preview.data?.sin_mapeo ?? 0;
  const conMapeo = Math.max(0, totalDocs - sinMapeo);
  const pctMapeado = totalDocs > 0 ? Math.round((conMapeo / totalDocs) * 100) : 100;
  const todoMapeado = sinMapeo === 0 && totalDocs > 0;

  return (
    <section
      className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-50/40 via-white to-emerald-50/30 ring-1 ring-amber-200/40 p-6 shadow-card"
      aria-labelledby="rendicion-corfo-title"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 size-44 rounded-full bg-amber-200/20 blur-3xl"
      />
      <div className="relative">
        {/* Header de la sección */}
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 ring-1 ring-amber-200">
              <CircleDollarSign className="size-3.5 text-amber-700" strokeWidth={2} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800">
                Rendición oficial · folio 2024-265638
              </span>
            </div>
            <h2
              id="rendicion-corfo-title"
              className="mt-2 font-display text-xl font-semibold tracking-tight text-ink-900"
            >
              Descargar planilla de rendición CORFO · {empresa}
            </h2>
            <p className="mt-1 max-w-2xl text-xs text-ink-600">
              Estos son los dos Excel que CORFO exige rendir cada período. Vienen
              pre-llenados con los vouchers aprobados de <strong>{empresa}</strong>{" "}
              y los datos de Nubox del mes. Solo te queda completar lo amarillo
              (comprobante físico / glosa específica).
            </p>
          </div>
          <Link
            href={"/admin/rendiciones-corfo/mapping" as Route}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:bg-ink-50 print:hidden"
          >
            <Settings2 className="size-3.5" />
            Editor de mapeo
          </Link>
        </header>

        {/* Selector de período */}
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-white p-3">
          <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Período
          </label>
          <input
            type="month"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="rounded-lg border border-hairline bg-white px-3 py-1.5 text-sm focus:border-cehta-green focus:outline-none focus:ring-2 focus:ring-cehta-green/20"
          />
          <span className="text-[11px] text-ink-500">
            Default: mes anterior. {totalDocs} doc{totalDocs !== 1 ? "s" : ""}{" "}
            COMPRA aprobado{totalDocs !== 1 ? "s" : ""} en este período.
          </span>
        </div>

        {/* Stats + donut */}
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_1fr_auto]">
          <StatCard label="Docs" value={totalDocs} format="int" />
          <StatCard label="Neto" value={preview.data?.total_neto ?? 0} format="clp" />
          <StatCard label="IVA" value={preview.data?.total_iva ?? 0} format="clp" />
          <StatCard
            label={sinMapeo > 0 ? "Sin mapeo" : "Mapeado"}
            value={sinMapeo > 0 ? sinMapeo : totalDocs}
            format="int"
            tone={sinMapeo > 0 ? "warning" : "positive"}
          />
          <div className="flex items-center justify-center rounded-2xl border border-hairline bg-white p-3">
            <DonutKPI
              value={pctMapeado}
              total={100}
              label="% mapeado"
              color={todoMapeado ? "#10B981" : "#F59E0B"}
              size={110}
            />
          </div>
        </div>

        {/* Banner mapeo si falta */}
        {!todoMapeado && totalDocs > 0 && (
          <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-700" strokeWidth={2} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-amber-900">
                Faltan {sinMapeo} cuentas locales por mapear a CORFO
              </p>
              <p className="mt-0.5 text-[11px] text-amber-800">
                Antes de descargar conviene completar el mapeo. El editor tiene
                auto-sugerencia por keywords (Honorarios → SUBCONTRATOS,
                Arriendo → ARRIENDO, etc.)
              </p>
              <Link
                href={"/admin/rendiciones-corfo/mapping" as Route}
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-amber-900 hover:underline"
              >
                Ir al editor con auto-sugerencia
                <ArrowRight className="size-3" />
              </Link>
            </div>
          </div>
        )}

        {/* Botones de descarga */}
        <div className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2">
          <DownloadButton
            icon={Receipt}
            title="Carga_Gastos.xlsx"
            subtitle="21 cols · vouchers COMPRA aprobados"
            extraInfo={`${totalDocs} filas`}
            disabled={downloadMut.isPending || totalDocs === 0}
            onClick={() => downloadMut.mutate("gastos")}
            loading={downloadMut.isPending && downloadMut.variables === "gastos"}
          />
          <DownloadButton
            icon={UsersIcon}
            title="Carga_RRHH.xlsx"
            subtitle="17 cols · trabajadores + Nubox"
            extraInfo="liq. sueldo del período"
            disabled={downloadMut.isPending}
            onClick={() => downloadMut.mutate("rrhh")}
            loading={downloadMut.isPending && downloadMut.variables === "rrhh"}
          />
        </div>

        {downloadMut.isError && (
          <p className="mt-3 rounded-xl bg-red-50 px-4 py-2 text-[11px] text-red-700">
            No se pudo generar el Excel:{" "}
            {downloadMut.error instanceof Error
              ? downloadMut.error.message
              : "error desconocido"}
          </p>
        )}

        {/* Checklist de qué hacemos por vos */}
        {variant === "full" && (
          <div className="mt-5 rounded-2xl border border-hairline bg-white p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="size-3.5 text-cehta-green" strokeWidth={2} />
              <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-700">
                Cómo facilitamos el llenado
              </h3>
            </div>
            <ul className="space-y-1.5 text-[11px] text-ink-700">
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-cehta-green" />
                <span><strong>Estructura oficial</strong> · Carga_Gastos (21 cols) + Carga_RRHH (17 cols) + hoja Listados con dropdowns CORFO oficiales.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-cehta-green" />
                <span><strong>Pre-llenado desde vouchers</strong> · empresa, fecha, proveedor, folio, neto, IVA, total, glosa automáticos.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-cehta-green" />
                <span><strong>Mapeo cuenta_local → CORFO</strong> · auto-sugerencia con 18 patrones de keyword (Honorario→SUBCONTRATOS, Arriendo→ARRIENDO, …).</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-cehta-green" />
                <span><strong>Forma + Fecha de Pago</strong> · si el voucher ya está EXECUTED, se rellenan solos (R152ll requiere fly deploy).</span>
              </li>
              <li className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-cehta-green" />
                <span><strong>RRHH desde Nubox</strong> · trabajadores activos con sueldo bruto desde core.nubox_remuneraciones.</span>
              </li>
              <li className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-amber-600" />
                <span className="text-amber-900"><strong>Las celdas amarillas son manuales</strong> · comprobante físico, glosa CORFO específica, receptor.</span>
              </li>
            </ul>
          </div>
        )}

        {/* Preview compacto (primeras 5 filas) en variant compact */}
        {variant === "compact" && totalDocs > 0 && (
          <details className="mt-4 rounded-xl border border-hairline bg-white">
            <summary className="cursor-pointer px-4 py-2 text-[11px] font-medium text-ink-600 hover:bg-ink-50">
              Ver preview ({totalDocs} líneas)
            </summary>
            <div className="overflow-x-auto px-2 pb-3">
              <table className="w-full text-[11px]">
                <thead className="text-[9px] uppercase tracking-wider text-ink-500">
                  <tr>
                    <th className="px-2 py-1 text-left">Fecha</th>
                    <th className="px-2 py-1 text-left">Proveedor</th>
                    <th className="px-2 py-1 text-right">Total</th>
                    <th className="px-2 py-1 text-center">Mapeo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {rows.slice(0, 5).map((r) => (
                    <tr key={r.voucher_id}>
                      <td className="px-2 py-1">{r.fecha}</td>
                      <td
                        className="truncate px-2 py-1"
                        style={{ maxWidth: 180 }}
                        title={r.proveedor_nombre ?? ""}
                      >
                        {r.proveedor_nombre ?? "—"}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {fmtCLP(r.monto_total)}
                      </td>
                      <td className="px-2 py-1 text-center">
                        {r.corfo_cuenta ? (
                          <CheckCircle2 className="inline size-3 text-emerald-600" />
                        ) : (
                          <AlertTriangle className="inline size-3 text-amber-600" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {totalDocs > 5 && (
                <p className="mt-1 px-2 text-[10px] text-ink-500">
                  …{totalDocs - 5} líneas más se incluyen en el Excel descargado.
                </p>
              )}
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  format,
  tone = "neutral",
}: {
  label: string;
  value: number;
  format: "int" | "clp";
  tone?: "neutral" | "warning" | "positive";
}) {
  const toneStyle =
    tone === "warning"
      ? "border-amber-200 bg-amber-50/40 text-amber-900"
      : tone === "positive"
      ? "border-emerald-200 bg-emerald-50/40 text-emerald-900"
      : "border-hairline bg-white text-ink-900";
  return (
    <div className={`rounded-2xl border p-3 shadow-card ${toneStyle}`}>
      <p className="text-[9px] font-semibold uppercase tracking-wider opacity-70">
        {label}
      </p>
      <p className="mt-1 font-display text-xl font-semibold">
        <AnimatedNumber value={value} format={format} />
      </p>
    </div>
  );
}

function DownloadButton({
  icon: Icon,
  title,
  subtitle,
  extraInfo,
  disabled,
  onClick,
  loading,
}: {
  icon: typeof Receipt;
  title: string;
  subtitle: string;
  extraInfo: string;
  disabled: boolean;
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="group flex items-center justify-between gap-3 rounded-2xl border border-hairline bg-white p-4 shadow-card transition-all hover:-translate-y-0.5 hover:border-cehta-green hover:shadow-elevated-lg disabled:opacity-50 disabled:hover:translate-y-0"
    >
      <div className="text-left">
        <p className="inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-ink-500">
          <Icon className="size-3" />
          {subtitle}
        </p>
        <p className="mt-1 text-sm font-semibold text-ink-900">{title}</p>
        <p className="text-[10px] text-ink-500">{extraInfo}</p>
      </div>
      <div className="flex size-10 items-center justify-center rounded-xl bg-cehta-green/10 text-cehta-green transition-colors group-hover:bg-cehta-green group-hover:text-white">
        {loading ? (
          <div className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : (
          <Download className="size-4" strokeWidth={1.8} />
        )}
      </div>
    </button>
  );
}
