"use client";

/**
 * /empresa/[codigo]/rendicion-corfo — R152ll
 *
 * Versión embebida del Generador de Rendiciones CORFO, contextualizada
 * a una empresa específica (REVTECH o TRONGKAI). Pre-fija el código de
 * empresa, simplifica el header (ya estamos dentro de la empresa) y
 * agrega checklist contextual de qué falta para que la rendición esté
 * lista.
 *
 * Fuentes de datos pre-llenadas en el Excel:
 *   - Gastos: core.vouchers (COMPRA) + voucher_lines (cuenta + IVA)
 *     + transferencias confirmadas (Forma Pago + Fecha Pago)
 *   - RRHH: core.trabajadores + core.nubox_remuneraciones (LIQ. SUELDO)
 *
 * Para no-CORFO empresas, redirige automáticamente al resumen.
 */
import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CircleDollarSign,
  Download,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Users as UsersIcon,
  Settings2,
  Calendar,
  ArrowRight,
  Sparkles,
  Receipt,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { AnimatedNumber } from "@/components/charts/AnimatedNumber";
import { DonutKPI } from "@/components/charts/DonutKPI";

const CORFO_EMPRESAS = new Set(["REVTECH", "TRONGKAI"]);

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

function currentPeriodo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const fmtCLP = (n: number) => n.toLocaleString("es-CL", { maximumFractionDigits: 0 });

interface Props {
  params: Promise<{ codigo: string }>;
}

export default function EmpresaRendicionCorfoPage({ params }: Props) {
  const { codigo } = use(params);
  const router = useRouter();
  const { session } = useSession();
  const [periodo, setPeriodo] = useState(currentPeriodo());

  // Si la empresa no es CORFO, redirigir al resumen
  useEffect(() => {
    if (codigo && !CORFO_EMPRESAS.has(codigo)) {
      router.replace(`/empresa/${codigo}` as Route);
    }
  }, [codigo, router]);

  const preview = useQuery<PreviewResp>({
    queryKey: ["corfo", "preview", codigo, periodo],
    queryFn: () =>
      apiClient.get<PreviewResp>(
        `/admin/corfo/rendicion/preview?empresa=${codigo}&periodo=${periodo}`,
        session,
      ),
    enabled: !!session && CORFO_EMPRESAS.has(codigo),
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
          body: JSON.stringify({ empresa: codigo, periodo, tipo }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Rendicion_${tipo === "gastos" ? "Gastos" : "Rrhh"}_${codigo}_${periodo}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });

  if (!CORFO_EMPRESAS.has(codigo)) {
    return (
      <div className="px-6 py-10 text-sm text-ink-500">
        Esta empresa no tiene proyecto CORFO activo.
      </div>
    );
  }

  const rows = preview.data?.rows ?? [];
  const totalDocs = rows.length;
  const sinMapeo = preview.data?.sin_mapeo ?? 0;
  const conMapeo = Math.max(0, totalDocs - sinMapeo);
  const pctMapeado = totalDocs > 0 ? Math.round((conMapeo / totalDocs) * 100) : 100;
  const todoMapeado = sinMapeo === 0 && totalDocs > 0;

  return (
    <div className="space-y-6 px-6 py-8 lg:px-10">
      {/* Header empresa-específico */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-50/60 via-white to-emerald-50/40 ring-1 ring-amber-200/40 p-6 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-12 size-40 rounded-full bg-amber-200/30 blur-3xl"
        />
        <div className="relative flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-3 py-1 ring-1 ring-amber-200">
              <CircleDollarSign className="size-3.5 text-amber-700" strokeWidth={2} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800">
                Proyecto CORFO 2024-265638
              </span>
            </div>
            <h2 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink-900">
              Rendiciones CORFO · {codigo}
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-600">
              Generá los Excel oficiales de Gastos y RRHH pre-llenados con los
              vouchers aprobados de {codigo} y los datos de remuneraciones desde
              Nubox. Solo te queda completar lo amarillo (comprobante físico).
            </p>
          </div>
          <Link
            href={"/admin/rendiciones-corfo/mapping" as Route}
            className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:bg-ink-50"
          >
            <Settings2 className="size-3.5" />
            Editor de mapeo
          </Link>
        </div>
      </div>

      {/* Selector de período */}
      <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
        <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
          Período a rendir
        </label>
        <div className="mt-2 flex items-center gap-3">
          <input
            type="month"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="rounded-xl border border-hairline bg-white px-3 py-2 text-sm focus:border-cehta-green focus:outline-none focus:ring-2 focus:ring-cehta-green/20"
          />
          <span className="text-[11px] text-ink-500">
            Por defecto, mes anterior. La rendición CORFO normalmente se hace
            del mes que cerró.
          </span>
        </div>
      </div>

      {/* Stats con animación */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Documentos
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
            <AnimatedNumber value={totalDocs} format="int" />
          </p>
          <p className="mt-1 text-[10px] text-ink-500">Vouchers COMPRA aprobados</p>
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            Monto neto
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
            <AnimatedNumber value={preview.data?.total_neto ?? 0} format="clp" />
          </p>
        </div>
        <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
            IVA
          </p>
          <p className="mt-2 font-display text-3xl font-semibold text-ink-900">
            <AnimatedNumber value={preview.data?.total_iva ?? 0} format="clp" />
          </p>
        </div>
        <div
          className={`rounded-2xl border p-5 shadow-card ${
            sinMapeo > 0
              ? "border-amber-200 bg-amber-50/40"
              : "border-emerald-200 bg-emerald-50/40"
          }`}
        >
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider">
            {sinMapeo > 0 ? (
              <AlertTriangle className="size-3.5 text-amber-700" />
            ) : (
              <CheckCircle2 className="size-3.5 text-emerald-700" />
            )}
            <span className={sinMapeo > 0 ? "text-amber-800" : "text-emerald-800"}>
              {sinMapeo > 0 ? "Sin mapeo" : "Todo mapeado"}
            </span>
          </p>
          <p
            className={`mt-2 font-display text-3xl font-semibold ${
              sinMapeo > 0 ? "text-amber-900" : "text-emerald-900"
            }`}
          >
            <AnimatedNumber value={sinMapeo} format="int" />
          </p>
        </div>
      </div>

      {/* Donut de progreso de mapeo */}
      <div className="flex items-center gap-6 rounded-2xl border border-hairline bg-white p-5 shadow-card">
        <DonutKPI
          value={pctMapeado}
          total={100}
          label="% mapeado"
          color={todoMapeado ? "#10B981" : "#F59E0B"}
          size={120}
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-ink-900">
            {todoMapeado ? "Listo para descargar" : "Faltan cuentas por mapear"}
          </h3>
          <p className="mt-1 text-xs text-ink-600">
            {todoMapeado
              ? `Las ${totalDocs} cuentas locales tienen su equivalente CORFO asignado. El Excel saldrá completo de tu lado del trabajo.`
              : `${sinMapeo} de ${totalDocs} cuentas locales aún no tienen su CORFO equivalente. Hacé click en "Editor de mapeo" arriba para arreglarlo en bulk.`}
          </p>
          {!todoMapeado && (
            <Link
              href={"/admin/rendiciones-corfo/mapping" as Route}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:underline"
            >
              Ir al editor con auto-sugerencia
              <ArrowRight className="size-3" />
            </Link>
          )}
        </div>
      </div>

      {/* Botones download */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <button
          type="button"
          onClick={() => downloadMut.mutate("gastos")}
          disabled={downloadMut.isPending || totalDocs === 0}
          className="group flex items-center justify-between gap-3 rounded-2xl border border-hairline bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-cehta-green hover:shadow-elevated-lg disabled:opacity-50 disabled:hover:translate-y-0"
        >
          <div className="text-left">
            <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              <Receipt className="size-3.5" />
              Archivo 1 de 2
            </p>
            <p className="mt-1 text-base font-semibold text-ink-900">
              Descargar Gastos.xlsx
            </p>
            <p className="text-[11px] text-ink-500">
              21 columnas · {totalDocs} filas · dropdowns oficiales activos
            </p>
          </div>
          <div className="flex size-12 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green group-hover:bg-cehta-green group-hover:text-white">
            <Download className="size-5" strokeWidth={1.8} />
          </div>
        </button>
        <button
          type="button"
          onClick={() => downloadMut.mutate("rrhh")}
          disabled={downloadMut.isPending}
          className="group flex items-center justify-between gap-3 rounded-2xl border border-hairline bg-white p-5 shadow-card transition-all hover:-translate-y-0.5 hover:border-cehta-green hover:shadow-elevated-lg disabled:opacity-50 disabled:hover:translate-y-0"
        >
          <div className="text-left">
            <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
              <UsersIcon className="size-3.5" />
              Archivo 2 de 2
            </p>
            <p className="mt-1 text-base font-semibold text-ink-900">
              Descargar RRHH.xlsx
            </p>
            <p className="text-[11px] text-ink-500">
              17 columnas · trabajadores activos · liquidaciones desde Nubox
            </p>
          </div>
          <div className="flex size-12 items-center justify-center rounded-2xl bg-cehta-green/10 text-cehta-green group-hover:bg-cehta-green group-hover:text-white">
            <Download className="size-5" strokeWidth={1.8} />
          </div>
        </button>
      </div>

      {/* Checklist de qué falta para que la rendición esté lista */}
      <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles className="size-4 text-cehta-green" strokeWidth={2} />
          <h3 className="text-sm font-semibold tracking-tight text-ink-900">
            Checklist · cómo facilitamos el llenado
          </h3>
        </div>
        <ul className="space-y-2 text-xs text-ink-700">
          <ChecklistItem
            done={true}
            label="Estructura oficial folio 2024-265638"
            desc="Carga_Gastos (21 cols) + Carga_RRHH (17 cols) + hoja Listados con los catálogos CORFO oficiales como dropdowns."
          />
          <ChecklistItem
            done={true}
            label="Pre-llenado desde vouchers aprobados"
            desc="Empresa, fecha, proveedor, folio, monto neto, IVA, total, glosa — todo cargado automáticamente."
          />
          <ChecklistItem
            done={todoMapeado}
            label="Mapeo cuenta local → cuenta CORFO"
            desc="Cada cuenta del plan local se traduce a la nomenclatura CORFO. Auto-sugerencia con 18 patrones de keyword."
          />
          <ChecklistItem
            done={true}
            label="Forma de Pago + Fecha de Pago si voucher EXECUTED"
            desc="Si la transferencia ya se ejecutó, esos 2 campos se completan automáticamente. Si no, quedan amarillos para completar."
          />
          <ChecklistItem
            done={true}
            label="RRHH desde trabajadores + Nubox remuneraciones"
            desc="Trabajadores activos con su sueldo bruto del período pulled desde core.nubox_remuneraciones."
          />
          <ChecklistItem
            done={false}
            label="Comprobante físico + glosa CORFO específica"
            desc="Las celdas amarillas del Excel son lo que tenés que completar a mano: receptor de la boleta, glosa CORFO, comprobante adjunto al portal."
            warn
          />
        </ul>
      </div>

      {/* Tabla preview con primeros 8 vouchers */}
      {totalDocs > 0 && (
        <div className="rounded-2xl border border-hairline bg-white shadow-card">
          <header className="border-b border-hairline px-5 py-3">
            <h3 className="text-sm font-semibold text-ink-900">
              Preview · primeras {Math.min(8, totalDocs)} de {totalDocs} líneas
            </h3>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-ink-50/40 text-[10px] uppercase tracking-wider text-ink-500">
                <tr>
                  <th className="px-3 py-2 text-left">Fecha</th>
                  <th className="px-3 py-2 text-left">Proveedor</th>
                  <th className="px-3 py-2 text-left">Folio</th>
                  <th className="px-3 py-2 text-right">Neto</th>
                  <th className="px-3 py-2 text-right">IVA</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-center">Mapeo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.slice(0, 8).map((r) => (
                  <tr key={r.voucher_id} className="hover:bg-ink-50/40">
                    <td className="px-3 py-2">{r.fecha}</td>
                    <td className="px-3 py-2 truncate" style={{ maxWidth: 180 }} title={r.proveedor_nombre ?? ""}>
                      {r.proveedor_nombre ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">{r.folio ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCLP(r.monto_neto)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtCLP(r.monto_iva)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold">
                      {fmtCLP(r.monto_total)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.corfo_cuenta ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          <CheckCircle2 className="size-3" />
                          OK
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          <AlertTriangle className="size-3" />
                          Sin mapeo
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalDocs > 8 && (
            <p className="border-t border-hairline px-5 py-2 text-[10px] text-ink-500">
              … y {totalDocs - 8} líneas más se incluyen en el Excel descargado.
            </p>
          )}
        </div>
      )}

      {downloadMut.isError && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-xs text-red-700">
          No se pudo generar el Excel:{" "}
          {downloadMut.error instanceof Error ? downloadMut.error.message : "error desconocido"}
        </p>
      )}
    </div>
  );
}

function ChecklistItem({
  done,
  label,
  desc,
  warn = false,
}: {
  done: boolean;
  label: string;
  desc: string;
  warn?: boolean;
}) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full ${
          done
            ? "bg-cehta-green/15 text-cehta-green"
            : warn
            ? "bg-amber-100 text-amber-700"
            : "bg-ink-100 text-ink-400"
        }`}
      >
        {done ? (
          <CheckCircle2 className="size-3" strokeWidth={2.5} />
        ) : warn ? (
          <AlertTriangle className="size-2.5" strokeWidth={2.5} />
        ) : (
          <span className="size-1 rounded-full bg-current" />
        )}
      </span>
      <div className="min-w-0">
        <p className={`font-semibold ${done ? "text-ink-900" : warn ? "text-amber-900" : "text-ink-500"}`}>
          {label}
        </p>
        <p className="text-[11px] text-ink-500">{desc}</p>
      </div>
    </li>
  );
}
