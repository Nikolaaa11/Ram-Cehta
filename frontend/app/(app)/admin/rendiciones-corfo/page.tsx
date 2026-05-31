"use client";

/**
 * /admin/rendiciones-corfo — Round 152w
 *
 * Genera los Excel oficiales de rendición CORFO para REVTECH/TRONGKAI:
 *   - RendicionesGastos.xlsx (21 cols)
 *   - RendicionesRRHH.xlsx (17 cols)
 *
 * Pre-llena lo que se puede desde la plataforma + deja dropdowns con
 * los catálogos oficiales para completar a mano lo restante.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  CircleDollarSign,
  Download,
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  Users,
  Settings2,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

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

const EMPRESAS = ["REVTECH", "TRONGKAI"] as const;

function currentPeriodo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 1); // mes pasado por default
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const fmtCLP = (n: number) => n.toLocaleString("es-CL", { maximumFractionDigits: 0 });

export default function RendicionesCorfoPage() {
  const { session } = useSession();
  const [empresa, setEmpresa] = useState<(typeof EMPRESAS)[number]>("REVTECH");
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

  return (
    <div className="mx-auto max-w-6xl px-6 py-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
          <CircleDollarSign className="size-7" strokeWidth={1.6} />
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            Rendiciones CORFO
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Generador de los Excel oficiales de rendición para REVTECH y
            TRONGKAI (subsidio CORFO 2026). Pre-llenado automático + dropdowns
            con catálogos oficiales.
          </p>
        </div>
      </div>

      {/* Selector empresa + periodo */}
      <div className="mt-6 grid grid-cols-1 gap-4 rounded-2xl border border-hairline bg-white p-5 shadow-card md:grid-cols-3">
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
            Empresa
          </label>
          <div className="mt-2 flex gap-2">
            {EMPRESAS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmpresa(e)}
                className={`rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                  empresa === e
                    ? "bg-cehta-green text-white"
                    : "bg-ink-50 text-ink-700 hover:bg-ink-100"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
            Período (YYYY-MM)
          </label>
          <input
            type="month"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="mt-2 w-full rounded-xl border border-hairline px-3 py-2 text-sm focus:border-cehta-green focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-ink-500">
            Período CORFO
          </label>
          <p className="mt-2 rounded-xl bg-ink-50 px-3 py-2 text-sm font-medium text-ink-700">
            {preview.data?.periodo_corfo ?? "—"}
          </p>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Documentos" value={rows.length} />
        <Stat label="Neto total" value={`$${fmtCLP(preview.data?.total_neto ?? 0)}`} />
        <Stat label="IVA" value={`$${fmtCLP(preview.data?.total_iva ?? 0)}`} />
        <Stat
          label="Sin mapeo"
          value={preview.data?.sin_mapeo ?? 0}
          warn={(preview.data?.sin_mapeo ?? 0) > 0}
        />
      </div>

      {/* Aviso si hay sin mapeo */}
      {(preview.data?.sin_mapeo ?? 0) > 0 && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <AlertTriangle className="size-5 shrink-0 text-amber-600" />
          <div className="flex-1">
            <p className="font-semibold">
              {preview.data?.sin_mapeo} cuentas locales sin mapeo a CORFO
            </p>
            <p className="mt-1 text-xs">
              El Excel se va a generar igual pero esas filas tendrán la
              columna "Cuenta" y "Ítem" en amarillo (vacías). Si configurás
              el mapeo una sola vez, las próximas rendiciones salen 100%
              pre-llenadas.
            </p>
          </div>
          <Link
            href={"/admin/rendiciones-corfo/mapping" as Route}
            className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700"
          >
            <Settings2 className="size-3.5" />
            Configurar mapeo
          </Link>
        </div>
      )}

      {/* Botón siempre visible para configurar mapeo */}
      {(preview.data?.sin_mapeo ?? 0) === 0 && rows.length > 0 && (
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-emerald-200 bg-emerald-50/50 px-5 py-3 text-sm text-emerald-900">
          <span className="inline-flex items-center gap-2">
            <CheckCircle2 className="size-4 text-emerald-600" />
            Todas las cuentas están mapeadas. El Excel sale completo.
          </span>
          <Link
            href={"/admin/rendiciones-corfo/mapping" as Route}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 hover:underline"
          >
            <Settings2 className="size-3" />
            Editar mapeo
          </Link>
        </div>
      )}

      {/* Botones descarga */}
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        <button
          type="button"
          disabled={downloadMut.isPending}
          onClick={() => downloadMut.mutate("gastos")}
          className="group flex items-center gap-4 rounded-2xl border border-cehta-green/30 bg-emerald-50/40 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-cehta-green hover:shadow-card disabled:cursor-not-allowed disabled:opacity-50"
        >
          <div className="flex size-12 items-center justify-center rounded-xl bg-cehta-green/10 text-cehta-green">
            <FileSpreadsheet className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink-900">
              Rendición de Gastos
            </p>
            <p className="mt-0.5 text-xs text-ink-600">
              21 columnas · {rows.length} filas pre-llenadas + dropdowns CORFO
            </p>
          </div>
          <Download className="size-5 text-cehta-green opacity-60 group-hover:opacity-100" />
        </button>
        <button
          type="button"
          disabled={downloadMut.isPending}
          onClick={() => downloadMut.mutate("rrhh")}
          className="group flex items-center gap-4 rounded-2xl border border-blue-200 bg-blue-50/40 p-5 text-left transition-all hover:-translate-y-0.5 hover:border-blue-500 hover:shadow-card disabled:cursor-not-allowed disabled:opacity-50"
        >
          <div className="flex size-12 items-center justify-center rounded-xl bg-blue-100 text-blue-700">
            <Users className="size-6" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-ink-900">Rendición de RRHH</p>
            <p className="mt-0.5 text-xs text-ink-600">
              17 columnas · Pre-llenado desde trabajadores + Nubox remuneraciones
            </p>
          </div>
          <Download className="size-5 text-blue-700 opacity-60 group-hover:opacity-100" />
        </button>
      </div>

      {/* Preview tabla */}
      <section className="mt-8 overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
        <header className="border-b border-hairline px-6 py-4">
          <h3 className="text-base font-semibold text-ink-900">
            Preview · Vouchers COMPRA del período (los que van al Excel de Gastos)
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            Solo vouchers en estado APPROVED/EXECUTED/SYNCED/RECONCILED. Si no
            aparece lo que esperás, verificá que esté firmado y aprobado.
          </p>
        </header>
        <div className="overflow-x-auto">
          {preview.isLoading ? (
            <p className="py-12 text-center text-sm text-ink-400">Cargando…</p>
          ) : rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-ink-400">
              Sin vouchers COMPRA APROBADOS para este período.
            </p>
          ) : (
            <table className="w-full text-sm" style={{ fontVariantNumeric: "tabular-nums" }}>
              <thead className="bg-ink-50/50">
                <tr className="text-[10px] uppercase tracking-wider text-ink-500">
                  <th className="px-4 py-3 text-left font-semibold">Fecha</th>
                  <th className="px-4 py-3 text-left font-semibold">Cuenta local</th>
                  <th className="px-4 py-3 text-center font-semibold">Mapeo CORFO</th>
                  <th className="px-4 py-3 text-left font-semibold">Proveedor</th>
                  <th className="px-4 py-3 text-right font-semibold">Folio</th>
                  <th className="px-4 py-3 text-right font-semibold">Neto</th>
                  <th className="px-4 py-3 text-right font-semibold">IVA</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((r) => (
                  <tr key={r.voucher_id} className="hover:bg-ink-50/40">
                    <td className="px-4 py-2.5 text-xs">{r.fecha}</td>
                    <td className="px-4 py-2.5 font-mono text-xs">
                      {r.cuenta_codigo}
                      {r.cuenta_nombre && (
                        <span className="ml-2 font-sans text-ink-500">{r.cuenta_nombre}</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {r.corfo_cuenta ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          <CheckCircle2 className="size-3" />
                          {r.corfo_cuenta}
                        </span>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                          ⚠️ Sin mapeo
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      <div>{r.proveedor_nombre ?? "—"}</div>
                      <div className="text-ink-400">{r.proveedor_rut ?? ""}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs">{r.folio ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right">${fmtCLP(r.monto_neto)}</td>
                    <td className="px-4 py-2.5 text-right text-ink-500">${fmtCLP(r.monto_iva)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold">${fmtCLP(r.monto_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {/* Help */}
      <div className="mt-6 rounded-2xl bg-cehta-green/5 px-5 py-4 text-xs text-ink-700">
        <p className="font-semibold text-cehta-green">📋 Cómo funciona</p>
        <ol className="mt-2 ml-5 list-decimal space-y-1 leading-relaxed">
          <li>Elegí empresa + período. El sistema lee los vouchers COMPRA aprobados de ese mes.</li>
          <li>Click en "Rendición de Gastos" → descarga el Excel con 21 columnas, dropdowns CORFO oficiales y los datos pre-llenados desde tus vouchers (folio, RUT proveedor, montos, fecha).</li>
          <li>Las columnas en <span className="rounded bg-amber-200 px-1.5 py-0.5">amarillo</span> son las que tenés que completar a mano: Cuenta CORFO + Ítem (si no hay mapeo aún), Forma de Pago, Fecha de Pago, Glosa.</li>
          <li>Si configurás el mapeo cuenta_local → CORFO_cuenta una vez, queda persistido y las próximas rendiciones se pre-llenan completas.</li>
          <li>Subí el Excel resultante al portal CORFO como rendición oficial.</li>
        </ol>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        warn
          ? "border-amber-200 bg-amber-50"
          : "border-hairline bg-white"
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-ink-500">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${warn ? "text-amber-700" : "text-ink-900"}`}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </p>
    </div>
  );
}
