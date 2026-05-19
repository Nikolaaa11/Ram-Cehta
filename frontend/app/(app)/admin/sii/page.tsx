"use client";

/**
 * /admin/sii — Round 117 — Integración con el SII
 *
 * Pantalla para gestionar la sincronización de data tributaria del SII:
 *   - Lista de empresas con su estado de credencial SII
 *   - Botón "Probar login" → valida que la clave abra sesión OK
 *   - Botón "Sincronizar mes actual" → baja RCV compras + ventas
 *   - Selector de período para sincronizar meses pasados
 *   - Tabla de documentos descargados con filtros
 *   - Historial de runs (éxitos / fallos)
 *
 * Solo admin. La clave SII descifrada nunca sale del backend — todo se
 * gatilla via endpoints `/admin/sii/...`.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calculator,
  CheckCircle2,
  Download,
  FilePlus2,
  GitMerge,
  RefreshCw,
  Shield,
  TestTube2,
  Upload,
  XCircle,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";

interface EmpresaSiiStatus {
  empresa_codigo: string;
  razon_social: string | null;
  rut: string | null;
  tiene_credencial_sii: boolean;
  ultima_validacion_at: string | null;
  ultima_validacion_ok: boolean | null;
  ultimo_sync_at: string | null;
  ultimo_sync_status: string | null;
  documentos_count: number;
}

interface SiiRun {
  run_id: number;
  tipo: string;
  periodo: string | null;
  status: string;
  started_at: string;
  finished_at: string | null;
  documentos_count: number;
  error_message: string | null;
}

interface TipoDteBreakdown {
  tipo_dte: number;
  nombre: string;
  count: number;
  monto_neto: number;
  monto_iva: number;
  monto_total: number;
}

interface F29Preview {
  empresa_codigo: string;
  periodo: string;
  ventas_count: number;
  compras_count: number;
  iva_debito_fiscal: number;
  iva_credito_fiscal: number;
  ventas_total: number;
  compras_total: number;
  ventas_neto: number;
  compras_neto: number;
  f29_estimado_a_pagar: number;
  docs_conciliados: number;
  docs_sin_voucher: number;
  ventas_por_tipo: TipoDteBreakdown[];
  compras_por_tipo: TipoDteBreakdown[];
}

interface SiiDocumento {
  sii_doc_id: number;
  flujo: string;
  tipo_dte: number;
  folio: string;
  periodo: string;
  rut_contraparte: string;
  razon_social_contraparte: string | null;
  fecha_emision: string | null;
  monto_neto: number;
  monto_iva: number;
  monto_total: number;
  estado_sii: string | null;
  voucher_id: number | null;
}

const DTE_NAMES: Record<number, string> = {
  33: "Factura",
  34: "Factura exenta",
  39: "Boleta",
  41: "Boleta exenta",
  46: "Factura compra",
  56: "Nota débito",
  61: "Nota crédito",
  110: "Factura exportación",
};

const currentPeriodo = (): string => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
};

const fmtCLP = (n: number) =>
  n ? `$${Math.round(n).toLocaleString("es-CL")}` : "—";

const fmtFecha = (iso: string | null) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("es-CL");
  } catch {
    return iso;
  }
};

export default function SiiAdminPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const router = useRouter();
  const [selectedEmpresa, setSelectedEmpresa] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState(currentPeriodo());
  const [flujoFilter, setFlujoFilter] = useState<"" | "compra" | "venta">("");

  const { data: empresas, isLoading } = useQuery<EmpresaSiiStatus[]>({
    queryKey: ["sii-empresas"],
    queryFn: () =>
      apiClient.get<EmpresaSiiStatus[]>("/admin/sii/empresas", session),
    enabled: !!session,
    staleTime: 30_000,
  });

  const { data: runs } = useQuery<SiiRun[]>({
    queryKey: ["sii-runs", selectedEmpresa],
    queryFn: () =>
      apiClient.get<SiiRun[]>(
        `/admin/sii/runs/${selectedEmpresa}`,
        session,
      ),
    enabled: !!session && !!selectedEmpresa,
  });

  // Round 119 — F29 estimado a partir del RCV
  const { data: f29Preview } = useQuery<F29Preview>({
    queryKey: ["sii-f29-preview", selectedEmpresa, periodo],
    queryFn: () =>
      apiClient.get<F29Preview>(
        `/admin/sii/f29-preview/${selectedEmpresa}?periodo=${periodo}`,
        session,
      ),
    enabled: !!session && !!selectedEmpresa,
  });

  const { data: documentos } = useQuery<SiiDocumento[]>({
    queryKey: ["sii-documentos", selectedEmpresa, periodo, flujoFilter],
    queryFn: () => {
      const qs = new URLSearchParams({ periodo, limit: "300" });
      if (flujoFilter) qs.set("flujo", flujoFilter);
      return apiClient.get<SiiDocumento[]>(
        `/admin/sii/documentos/${selectedEmpresa}?${qs}`,
        session,
      );
    },
    enabled: !!session && !!selectedEmpresa,
  });

  const testLoginMut = useMutation({
    mutationFn: async (empresa: string) =>
      apiClient.post<{ ok: boolean; message: string }>(
        `/admin/sii/test-login/${empresa}`,
        {},
        session,
      ),
    onSuccess: (data, empresa) => {
      if (data.ok) {
        toast.success(`Login OK para ${empresa}`);
      } else {
        toast.error(`Login falló: ${data.message}`);
      }
      qc.invalidateQueries({ queryKey: ["sii-empresas"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(`Error: ${msg}`);
    },
  });

  const syncMut = useMutation({
    mutationFn: async (vars: { empresa: string; periodo: string }) =>
      apiClient.post<{
        run_id: number;
        compras_count: number;
        ventas_count: number;
        duracion_segundos: number;
      }>(
        `/admin/sii/sync-rcv/${vars.empresa}?periodo=${vars.periodo}`,
        {},
        session,
      ),
    onSuccess: (data, vars) => {
      toast.success(
        `Sync OK: ${data.compras_count} compras + ${data.ventas_count} ventas (${data.duracion_segundos.toFixed(1)}s)`,
      );
      qc.invalidateQueries({ queryKey: ["sii-empresas"] });
      qc.invalidateQueries({ queryKey: ["sii-runs"] });
      qc.invalidateQueries({ queryKey: ["sii-documentos"] });
      setSelectedEmpresa(vars.empresa);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(`Sync falló: ${msg}`);
    },
  });

  // Round 118 — Conciliar SII docs <-> vouchers
  const conciliarMut = useMutation({
    mutationFn: async (vars: { empresa: string; periodo?: string }) => {
      const qs = vars.periodo ? `?periodo=${vars.periodo}` : "";
      return apiClient.post<{
        total_processed: number;
        matched_exact: number;
        matched_fuzzy: number;
        unmatched: number;
      }>(`/admin/sii/conciliar/${vars.empresa}${qs}`, {}, session);
    },
    onSuccess: (data) => {
      toast.success(
        `Conciliación: ${data.matched_exact} match exacto, ${data.matched_fuzzy} fuzzy, ${data.unmatched} sin matchear`,
      );
      qc.invalidateQueries({ queryKey: ["sii-documentos"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(`Conciliación falló: ${msg}`);
    },
  });

  // Round 121 — Crear voucher DRAFT desde un doc SII no conciliado
  const crearVoucherMut = useMutation({
    mutationFn: async (sii_doc_id: number) =>
      apiClient.post<{
        voucher_id: number;
        codigo: string;
        sii_doc_id: number;
        message: string;
      }>(`/admin/sii/crear-voucher-desde-dte/${sii_doc_id}`, {}, session),
    onSuccess: (data) => {
      toast.success(
        `Voucher ${data.codigo} creado. Te llevo a editarlo →`,
      );
      qc.invalidateQueries({ queryKey: ["sii-documentos"] });
      qc.invalidateQueries({ queryKey: ["sii-f29-preview"] });
      // Redirigir al detalle del voucher para que el operador edite las cuentas
      router.push(`/vouchers/${data.voucher_id}` as Route);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(`No se pudo crear el voucher: ${msg}`);
    },
  });

  // Round 118 — Import CSV manual del portal SII
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [csvFlujo, setCsvFlujo] = useState<"compra" | "venta">("compra");
  const importCsvMut = useMutation({
    mutationFn: async (vars: { empresa: string; file: File; flujo: string; periodo: string }) => {
      const formData = new FormData();
      formData.append("file", vars.file);
      const url = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1"}/admin/sii/import-csv/${vars.empresa}?flujo=${vars.flujo}&periodo_default=${vars.periodo}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: formData,
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`${resp.status}: ${errText.slice(0, 200)}`);
      }
      return resp.json() as Promise<{
        inserted: number;
        updated: number;
        errors: string[];
      }>;
    },
    onSuccess: (data) => {
      toast.success(
        `Import OK: ${data.inserted} nuevos, ${data.updated} actualizados${data.errors.length ? ` (${data.errors.length} warns)` : ""}`,
      );
      if (data.errors.length > 0) {
        console.warn("Import CSV errores:", data.errors);
      }
      setCsvFile(null);
      qc.invalidateQueries({ queryKey: ["sii-empresas"] });
      qc.invalidateQueries({ queryKey: ["sii-documentos"] });
      qc.invalidateQueries({ queryKey: ["sii-runs"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(`Import falló: ${msg}`);
    },
  });

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-8 space-y-6">
      <Link
        href={"/admin/system-status" as Route}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 hover:text-cehta-green"
      >
        <ArrowLeft className="h-4 w-4" />
        Volver al panel admin
      </Link>

      {/* Hero */}
      <div className="relative overflow-hidden rounded-3xl bg-ink-50/40 ring-1 ring-hairline p-8 shadow-card">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "linear-gradient(rgba(35,108,79,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(35,108,79,0.04) 1px, transparent 1px)",
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(ellipse at top, black 30%, transparent 70%)",
          }}
        />
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-4 py-1.5 ring-1 ring-cehta-green/20">
            <Shield className="size-3.5 text-cehta-green" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Integración SII · Round 117
            </p>
          </div>
          <h1 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight bg-gradient-to-br from-ink-900 via-ink-700 to-cehta-green bg-clip-text text-transparent">
            Sincronización con el SII
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-600 max-w-2xl">
            Bajamos el <strong>RCV</strong> (Registro de Compras y Ventas)
            de cada empresa desde el portal del Servicio de Impuestos
            Internos. Las claves van cifradas en DB y solo se descifran al
            momento de uso. La data queda en{" "}
            <code className="font-mono text-xs">core.sii_documentos</code>.
          </p>
        </div>
      </div>

      {/* Lista de empresas */}
      <section className="rounded-2xl bg-white ring-1 ring-hairline overflow-hidden">
        <header className="px-6 py-4 border-b border-hairline">
          <h2 className="font-display text-lg font-semibold text-ink-900">
            Empresas
          </h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Clic en una fila para ver sus documentos descargados.
          </p>
        </header>
        {isLoading ? (
          <p className="p-6 text-sm text-ink-500">Cargando…</p>
        ) : !empresas || empresas.length === 0 ? (
          <p className="p-6 text-sm text-ink-500">Sin empresas configuradas.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">RUT</th>
                  <th className="px-4 py-3">Credencial</th>
                  <th className="px-4 py-3">Última validación</th>
                  <th className="px-4 py-3">Último sync</th>
                  <th className="px-4 py-3 text-right">Docs</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {empresas.map((e) => (
                  <tr
                    key={e.empresa_codigo}
                    onClick={() => setSelectedEmpresa(e.empresa_codigo)}
                    className={`cursor-pointer hover:bg-ink-50/50 ${
                      selectedEmpresa === e.empresa_codigo
                        ? "bg-cehta-green/5"
                        : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-ink-900">
                      {e.empresa_codigo}
                      <div className="text-[11px] text-ink-500">
                        {e.razon_social ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-ink-700">
                      {e.rut ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {e.tiene_credencial_sii ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-cehta-green/10 px-2 py-0.5 text-[10px] font-medium text-cehta-green">
                          <CheckCircle2 className="size-3" />
                          Configurada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          <XCircle className="size-3" />
                          Falta
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700">
                      {e.ultima_validacion_at ? (
                        <>
                          {fmtFecha(e.ultima_validacion_at)}{" "}
                          {e.ultima_validacion_ok ? (
                            <span className="text-cehta-green">✓</span>
                          ) : (
                            <span className="text-red-600">✗</span>
                          )}
                        </>
                      ) : (
                        <span className="text-ink-400">Nunca</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-700">
                      {e.ultimo_sync_at ? (
                        <>
                          {fmtFecha(e.ultimo_sync_at)}{" "}
                          <span
                            className={
                              e.ultimo_sync_status === "OK"
                                ? "text-cehta-green"
                                : "text-red-600"
                            }
                          >
                            {e.ultimo_sync_status}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-400">Nunca</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-sm tabular-nums">
                      {e.documentos_count}
                    </td>
                    <td
                      className="px-4 py-3 text-center"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          disabled={
                            !e.tiene_credencial_sii ||
                            testLoginMut.isPending
                          }
                          onClick={() => testLoginMut.mutate(e.empresa_codigo)}
                          className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-ink-200 disabled:opacity-50"
                          title="Verificar que la clave SII abra sesión"
                        >
                          <TestTube2 className="size-3" />
                          Test
                        </button>
                        <button
                          type="button"
                          disabled={
                            !e.tiene_credencial_sii || syncMut.isPending
                          }
                          onClick={() =>
                            syncMut.mutate({
                              empresa: e.empresa_codigo,
                              periodo,
                            })
                          }
                          className="inline-flex items-center gap-1 rounded-md bg-cehta-green px-2 py-1 text-[11px] font-medium text-white hover:bg-cehta-green/90 disabled:opacity-50"
                          title={`Bajar RCV de ${periodo}`}
                        >
                          {syncMut.isPending ? (
                            <RefreshCw className="size-3 animate-spin" />
                          ) : (
                            <Download className="size-3" />
                          )}
                          Sync {periodo}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Selector de período + flujo */}
      <section className="flex flex-wrap items-center gap-3 px-2">
        <label className="text-sm text-ink-700">
          Período:{" "}
          <input
            type="month"
            value={periodo}
            onChange={(e) => setPeriodo(e.target.value)}
            className="rounded-md border-0 bg-ink-50 px-2 py-1 text-sm ring-1 ring-hairline focus:bg-white"
          />
        </label>
        <label className="text-sm text-ink-700">
          Flujo:{" "}
          <select
            value={flujoFilter}
            onChange={(e) =>
              setFlujoFilter(e.target.value as "" | "compra" | "venta")
            }
            className="rounded-md border-0 bg-ink-50 px-2 py-1 text-sm ring-1 ring-hairline focus:bg-white"
          >
            <option value="">Compras + Ventas</option>
            <option value="compra">Solo compras</option>
            <option value="venta">Solo ventas</option>
          </select>
        </label>
        {selectedEmpresa && (
          <button
            type="button"
            disabled={conciliarMut.isPending}
            onClick={() =>
              conciliarMut.mutate({ empresa: selectedEmpresa, periodo })
            }
            className="inline-flex items-center gap-1.5 rounded-md bg-cehta-green/10 px-3 py-1.5 text-xs font-medium text-cehta-green ring-1 ring-cehta-green/20 hover:bg-cehta-green/15 disabled:opacity-50"
            title="Matchear documentos SII con vouchers locales"
          >
            <GitMerge className="size-3" />
            {conciliarMut.isPending ? "Conciliando..." : "Conciliar con vouchers"}
          </button>
        )}
      </section>

      {/* Round 118 — Import CSV manual */}
      {selectedEmpresa && (
        <section className="rounded-2xl bg-amber-50/40 ring-1 ring-amber-200 p-4">
          <h3 className="font-display text-sm font-semibold text-amber-900 mb-2">
            ⬆️ Fallback: subir CSV bajado del portal sii.cl
          </h3>
          <p className="text-xs text-amber-800 mb-3 max-w-2xl">
            Si el botón &quot;Sync&quot; arriba falla porque el SII cambió su portal, podés
            bajar el CSV manualmente (sii.cl → Servicios online → Registro Compras y
            Ventas → Descargar) y subirlo acá. Mismo destino,
            <code className="font-mono mx-1 px-1 bg-amber-100 rounded">core.sii_documentos</code>.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={csvFlujo}
              onChange={(e) => setCsvFlujo(e.target.value as "compra" | "venta")}
              className="rounded-md border-0 bg-white px-2 py-1.5 text-xs ring-1 ring-hairline"
            >
              <option value="compra">Compras (CSV)</option>
              <option value="venta">Ventas (CSV)</option>
            </select>
            <input
              type="file"
              accept=".csv,.tsv,.txt"
              onChange={(e) => setCsvFile(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
            <button
              type="button"
              disabled={!csvFile || importCsvMut.isPending}
              onClick={() => {
                if (!csvFile || !selectedEmpresa) return;
                importCsvMut.mutate({
                  empresa: selectedEmpresa,
                  file: csvFile,
                  flujo: csvFlujo,
                  periodo,
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-50"
            >
              <Upload className="size-3" />
              {importCsvMut.isPending ? "Subiendo..." : "Subir CSV"}
            </button>
          </div>
        </section>
      )}

      {/* Round 119 — F29 preview */}
      {selectedEmpresa &&
        f29Preview &&
        (f29Preview.ventas_count > 0 || f29Preview.compras_count > 0) && (
          <section className="rounded-2xl bg-gradient-to-br from-cehta-green/[0.06] via-white to-cehta-green/[0.03] ring-1 ring-cehta-green/20 p-6">
            <header className="flex items-center justify-between mb-4">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-3 py-1 ring-1 ring-cehta-green/20">
                  <Calculator className="size-3.5 text-cehta-green" />
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
                    F29 estimado · {selectedEmpresa} · {periodo}
                  </p>
                </div>
                <h2 className="mt-2 font-display text-2xl font-semibold text-ink-900">
                  {f29Preview.f29_estimado_a_pagar > 0 ? "A pagar" : "Saldo a favor"}:{" "}
                  <span
                    className={
                      f29Preview.f29_estimado_a_pagar > 0
                        ? "text-red-700"
                        : "text-cehta-green"
                    }
                  >
                    {fmtCLP(Math.abs(f29Preview.f29_estimado_a_pagar))}
                  </span>
                </h2>
                <p className="text-xs text-ink-500 mt-1">
                  Cálculo: IVA débito (ventas) − IVA crédito (compras). Las
                  notas de crédito se restan en ambos flujos. Preview — no
                  reemplaza el F29 oficial del SII.
                </p>
              </div>
            </header>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl bg-white ring-1 ring-hairline p-3">
                <p className="text-[10px] uppercase tracking-wide text-ink-500">
                  IVA Débito (ventas)
                </p>
                <p className="font-mono text-lg font-semibold tabular-nums text-ink-900 mt-1">
                  {fmtCLP(f29Preview.iva_debito_fiscal)}
                </p>
                <p className="text-[10px] text-ink-400 mt-0.5">
                  {f29Preview.ventas_count} docs · neto{" "}
                  {fmtCLP(f29Preview.ventas_neto)}
                </p>
              </div>
              <div className="rounded-xl bg-white ring-1 ring-hairline p-3">
                <p className="text-[10px] uppercase tracking-wide text-ink-500">
                  IVA Crédito (compras)
                </p>
                <p className="font-mono text-lg font-semibold tabular-nums text-ink-900 mt-1">
                  {fmtCLP(f29Preview.iva_credito_fiscal)}
                </p>
                <p className="text-[10px] text-ink-400 mt-0.5">
                  {f29Preview.compras_count} docs · neto{" "}
                  {fmtCLP(f29Preview.compras_neto)}
                </p>
              </div>
              <div className="rounded-xl bg-white ring-1 ring-hairline p-3">
                <p className="text-[10px] uppercase tracking-wide text-ink-500">
                  Total ventas
                </p>
                <p className="font-mono text-lg font-semibold tabular-nums text-ink-900 mt-1">
                  {fmtCLP(f29Preview.ventas_total)}
                </p>
              </div>
              <div className="rounded-xl bg-white ring-1 ring-hairline p-3">
                <p className="text-[10px] uppercase tracking-wide text-ink-500">
                  Total compras
                </p>
                <p className="font-mono text-lg font-semibold tabular-nums text-ink-900 mt-1">
                  {fmtCLP(f29Preview.compras_total)}
                </p>
              </div>
            </div>

            {/* Alerta de conciliación */}
            {f29Preview.docs_sin_voucher > 0 && (
              <div className="mt-4 rounded-lg bg-amber-50 ring-1 ring-amber-200 p-3 text-xs text-amber-900">
                ⚠️ <strong>{f29Preview.docs_sin_voucher} documentos del SII</strong>{" "}
                no están conciliados con vouchers locales. Probable que falten
                cargar como voucher. Apretá &quot;Conciliar con vouchers&quot; arriba
                para reintentar el match automático.
              </div>
            )}
            {f29Preview.docs_sin_voucher === 0 && (
              <div className="mt-4 rounded-lg bg-cehta-green/10 ring-1 ring-cehta-green/20 p-3 text-xs text-cehta-green">
                ✓ Todos los documentos del SII están conciliados con vouchers
                ({f29Preview.docs_conciliados} matcheados).
              </div>
            )}

            {/* Breakdown por tipo DTE */}
            <details className="mt-4 group">
              <summary className="cursor-pointer text-xs font-medium text-ink-600 hover:text-cehta-green">
                Ver desglose por tipo DTE →
              </summary>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 mb-2">
                    Ventas por tipo
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-ink-500">
                        <th className="pb-1">Tipo</th>
                        <th className="pb-1 text-right">Cant.</th>
                        <th className="pb-1 text-right">IVA</th>
                        <th className="pb-1 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f29Preview.ventas_por_tipo.map((b) => (
                        <tr key={`v-${b.tipo_dte}`} className="border-t border-hairline">
                          <td className="py-1">{b.nombre}</td>
                          <td className="py-1 text-right font-mono">{b.count}</td>
                          <td className="py-1 text-right font-mono">
                            {fmtCLP(b.monto_iva)}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {fmtCLP(b.monto_total)}
                          </td>
                        </tr>
                      ))}
                      {f29Preview.ventas_por_tipo.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-1 text-ink-400">
                            Sin ventas registradas en este período
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500 mb-2">
                    Compras por tipo
                  </p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-ink-500">
                        <th className="pb-1">Tipo</th>
                        <th className="pb-1 text-right">Cant.</th>
                        <th className="pb-1 text-right">IVA</th>
                        <th className="pb-1 text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {f29Preview.compras_por_tipo.map((b) => (
                        <tr key={`c-${b.tipo_dte}`} className="border-t border-hairline">
                          <td className="py-1">{b.nombre}</td>
                          <td className="py-1 text-right font-mono">{b.count}</td>
                          <td className="py-1 text-right font-mono">
                            {fmtCLP(b.monto_iva)}
                          </td>
                          <td className="py-1 text-right font-mono">
                            {fmtCLP(b.monto_total)}
                          </td>
                        </tr>
                      ))}
                      {f29Preview.compras_por_tipo.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-1 text-ink-400">
                            Sin compras registradas en este período
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </details>
          </section>
        )}

      {/* Documentos descargados */}
      {selectedEmpresa && (
        <section className="rounded-2xl bg-white ring-1 ring-hairline overflow-hidden">
          <header className="px-6 py-4 border-b border-hairline flex items-center justify-between">
            <div>
              <h2 className="font-display text-lg font-semibold text-ink-900">
                Documentos · {selectedEmpresa} · {periodo}
              </h2>
              <p className="text-xs text-ink-500 mt-0.5">
                {documentos?.length ?? 0} resultados
              </p>
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-3">Flujo</th>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Folio</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Contraparte</th>
                  <th className="px-4 py-3 text-right">Neto</th>
                  <th className="px-4 py-3 text-right">IVA</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Voucher</th>
                  <th className="px-4 py-3 text-center">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {(documentos ?? []).map((d) => (
                  <tr key={d.sii_doc_id}>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          d.flujo === "compra"
                            ? "bg-blue-50 text-blue-700"
                            : "bg-emerald-50 text-emerald-700"
                        }`}
                      >
                        {d.flujo}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-700">
                      {DTE_NAMES[d.tipo_dte] ?? `DTE ${d.tipo_dte}`}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">{d.folio}</td>
                    <td className="px-4 py-2 text-xs text-ink-600">
                      {fmtFecha(d.fecha_emision)}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <div className="font-mono text-ink-700">
                        {d.rut_contraparte}
                      </div>
                      <div className="text-[10px] text-ink-500 truncate max-w-xs">
                        {d.razon_social_contraparte}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {fmtCLP(d.monto_neto)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {fmtCLP(d.monto_iva)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums font-medium">
                      {fmtCLP(d.monto_total)}
                    </td>
                    <td className="px-4 py-2 text-[10px]">
                      {d.voucher_id ? (
                        <Link
                          href={`/vouchers/${d.voucher_id}` as Route}
                          className="inline-flex items-center gap-1 text-cehta-green hover:underline font-mono"
                        >
                          <CheckCircle2 className="size-3" />
                          #{d.voucher_id}
                        </Link>
                      ) : (
                        <span className="text-ink-400">Sin matchear</span>
                      )}
                      {d.estado_sii && (
                        <div className="text-ink-500 mt-0.5">{d.estado_sii}</div>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {!d.voucher_id && (
                        <button
                          type="button"
                          disabled={crearVoucherMut.isPending}
                          onClick={() => crearVoucherMut.mutate(d.sii_doc_id)}
                          className="inline-flex items-center gap-1 rounded-md bg-cehta-green/10 px-2 py-1 text-[10px] font-medium text-cehta-green ring-1 ring-cehta-green/20 hover:bg-cehta-green/15 disabled:opacity-50"
                          title="Crear voucher DRAFT precargado con estos datos"
                        >
                          <FilePlus2 className="size-3" />
                          Crear voucher
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(!documentos || documentos.length === 0) && (
              <p className="p-6 text-center text-sm text-ink-500">
                Sin documentos. Probá hacer un sync arriba.
              </p>
            )}
          </div>
        </section>
      )}

      {/* Historial de runs */}
      {selectedEmpresa && runs && runs.length > 0 && (
        <section className="rounded-2xl bg-white ring-1 ring-hairline overflow-hidden">
          <header className="px-6 py-4 border-b border-hairline">
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Historial · {selectedEmpresa}
            </h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Período</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Inicio</th>
                  <th className="px-4 py-3">Fin</th>
                  <th className="px-4 py-3 text-right">Docs</th>
                  <th className="px-4 py-3">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {runs.map((r) => (
                  <tr key={r.run_id}>
                    <td className="px-4 py-2 text-xs">{r.tipo}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {r.periodo ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          r.status === "OK"
                            ? "bg-cehta-green/10 text-cehta-green"
                            : r.status === "FAILED"
                              ? "bg-red-50 text-red-700"
                              : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-600">
                      {fmtFecha(r.started_at)}
                    </td>
                    <td className="px-4 py-2 text-xs text-ink-600">
                      {fmtFecha(r.finished_at)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {r.documentos_count}
                    </td>
                    <td className="px-4 py-2 text-[10px] text-red-700 max-w-xs truncate">
                      {r.error_message ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
