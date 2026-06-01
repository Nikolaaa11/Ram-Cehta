"use client";

/**
 * /admin/nubox — Round 123 — Integración con Nubox (remuneraciones)
 *
 * Foco: bajar el Libro de Remuneraciones mensual de Nubox para que el
 * operador no tenga que abrir el PDF de cada liquidación.
 *
 * Flujo manual recomendado (siempre funciona):
 *   1. Bajar el xlsx desde Nubox web (Remuneraciones → Reportes → Libro)
 *   2. Subirlo acá → se parsea y persiste en core.nubox_remuneraciones
 *   3. Ver resumen + tabla con todos los trabajadores
 *
 * Auto-sync (best-effort, puede fallar si Nubox cambió):
 *   1. Cargar credencial Nubox (rut + clave) en core.empresa_credenciales
 *   2. Click "Test login" para validar
 *   3. Click "Sync" para auto-descarga
 */
import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  HelpCircle,
  Receipt,
  RefreshCw,
  TestTube2,
  Upload,
  Users,
  Wallet,
  XCircle,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";

interface EmpresaNuboxStatus {
  empresa_codigo: string;
  razon_social: string | null;
  rut: string | null;
  tiene_credencial_nubox: boolean;
  ultima_validacion_at: string | null;
  ultima_validacion_ok: boolean | null;
  ultimo_sync_at: string | null;
  ultimo_sync_status: string | null;
  remuneraciones_count: number;
}

interface Remuneracion {
  remuneracion_id: number;
  periodo: string;
  trabajador_rut: string;
  trabajador_nombre: string | null;
  sueldo_base: number;
  total_haberes: number;
  afp_descuento: number;
  salud_descuento: number;
  total_descuentos: number;
  sueldo_liquido: number;
  voucher_id: number | null;
}

interface ResumenRem {
  empresa_codigo: string;
  periodo: string;
  trabajadores_count: number;
  total_haberes: number;
  total_descuentos: number;
  total_liquido: number;
  total_afp: number;
  total_salud: number;
  total_impuesto: number;
  total_aportes_patronales: number;
}

const currentPeriodo = (): string => {
  const now = new Date();
  // Por defecto el mes anterior (el mes en curso aún no está cerrado)
  const target = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, "0")}`;
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

export default function NuboxAdminPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [selectedEmpresa, setSelectedEmpresa] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState(currentPeriodo());
  const [excelFile, setExcelFile] = useState<File | null>(null);

  const { data: empresas, isLoading } = useQuery<EmpresaNuboxStatus[]>({
    queryKey: ["nubox-empresas"],
    queryFn: () =>
      apiClient.get<EmpresaNuboxStatus[]>("/admin/nubox/empresas", session),
    enabled: !!session,
    staleTime: 30_000,
  });

  const { data: resumen } = useQuery<ResumenRem>({
    queryKey: ["nubox-resumen", selectedEmpresa, periodo],
    queryFn: () =>
      apiClient.get<ResumenRem>(
        `/admin/nubox/resumen/${selectedEmpresa}?periodo=${periodo}`,
        session,
      ),
    enabled: !!session && !!selectedEmpresa,
  });

  const { data: remuneraciones } = useQuery<Remuneracion[]>({
    queryKey: ["nubox-remuneraciones", selectedEmpresa, periodo],
    queryFn: () =>
      apiClient.get<Remuneracion[]>(
        `/admin/nubox/remuneraciones/${selectedEmpresa}?periodo=${periodo}&limit=300`,
        session,
      ),
    enabled: !!session && !!selectedEmpresa,
  });

  const testLoginMut = useMutation({
    mutationFn: async (empresa: string) =>
      apiClient.post<{ ok: boolean; message: string }>(
        `/admin/nubox/test-login/${empresa}`,
        {},
        session,
      ),
    onSuccess: (data, empresa) => {
      if (data.ok) toast.success(`Nubox: login OK para ${empresa}`);
      else toast.error(`Nubox: ${data.message}`);
      qc.invalidateQueries({ queryKey: ["nubox-empresas"] });
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(`Error: ${msg}`);
    },
  });

  const syncMut = useMutation({
    mutationFn: async (vars: { empresa: string; periodo: string }) =>
      apiClient.post<{
        remuneraciones_count: number;
        duracion_segundos: number;
      }>(
        `/admin/nubox/sync-remuneraciones/${vars.empresa}?periodo=${vars.periodo}`,
        {},
        session,
      ),
    onSuccess: (data, vars) => {
      toast.success(
        `Sync OK: ${data.remuneraciones_count} trabajadores (${data.duracion_segundos.toFixed(1)}s)`,
      );
      qc.invalidateQueries({ queryKey: ["nubox-empresas"] });
      qc.invalidateQueries({ queryKey: ["nubox-resumen"] });
      qc.invalidateQueries({ queryKey: ["nubox-remuneraciones"] });
      setSelectedEmpresa(vars.empresa);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Error";
      toast.error(`Auto-sync falló: ${msg.slice(0, 200)}`);
    },
  });

  const importExcelMut = useMutation({
    mutationFn: async (vars: { empresa: string; file: File; periodo: string }) => {
      const formData = new FormData();
      formData.append("file", vars.file);
      const url = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1"}/admin/nubox/import-excel/${vars.empresa}?periodo=${vars.periodo}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${session?.access_token ?? ""}` },
        body: formData,
      });
      if (!resp.ok) {
        throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      }
      return resp.json() as Promise<{
        inserted: number;
        updated: number;
        errors: string[];
      }>;
    },
    onSuccess: (data) => {
      toast.success(
        `Import OK: ${data.inserted} nuevos, ${data.updated} actualizados`,
      );
      if (data.errors.length > 0) console.warn("Errores parser:", data.errors);
      setExcelFile(null);
      qc.invalidateQueries({ queryKey: ["nubox-empresas"] });
      qc.invalidateQueries({ queryKey: ["nubox-resumen"] });
      qc.invalidateQueries({ queryKey: ["nubox-remuneraciones"] });
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
            <Users className="size-3.5 text-cehta-green" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Integración Nubox · Remuneraciones
            </p>
          </div>
          <h1 className="mt-3 font-display text-4xl md:text-5xl font-semibold tracking-tight bg-gradient-to-br from-ink-900 via-ink-700 to-cehta-green bg-clip-text text-transparent">
            Libro de Remuneraciones
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-600 max-w-2xl">
            Bajamos el Libro de Remuneraciones mensual de Nubox al sistema
            para tener visibilidad de sueldos sin abrir cada liquidación.
            Recomendado: subir el xlsx manualmente (siempre funciona). La
            auto-sync es best-effort porque Nubox no tiene API pública.
          </p>
        </div>
      </div>

      {/* Empresas */}
      <section className="rounded-2xl bg-white ring-1 ring-hairline overflow-hidden">
        <header className="px-6 py-4 border-b border-hairline">
          <h2 className="font-display text-lg font-semibold text-ink-900">
            Empresas
          </h2>
          <p className="text-xs text-ink-500 mt-0.5">
            Clic en una fila para ver remuneraciones del período seleccionado.
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
                  <th className="px-4 py-3">Credencial</th>
                  <th className="px-4 py-3">Última validación</th>
                  <th className="px-4 py-3">Último sync</th>
                  <th className="px-4 py-3 text-right">Remuneraciones</th>
                  <th className="px-4 py-3 text-center">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {empresas.map((e) => (
                  <tr
                    key={e.empresa_codigo}
                    onClick={() => setSelectedEmpresa(e.empresa_codigo)}
                    className={`cursor-pointer hover:bg-ink-50/50 ${
                      selectedEmpresa === e.empresa_codigo ? "bg-cehta-green/5" : ""
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-ink-900">
                      {e.empresa_codigo}
                      <div className="text-[11px] text-ink-500">
                        {e.razon_social ?? "—"}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {e.tiene_credencial_nubox ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-cehta-green/10 px-2 py-0.5 text-[10px] font-medium text-cehta-green">
                          <CheckCircle2 className="size-3" /> Configurada
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-ink-100 px-2 py-0.5 text-[10px] font-medium text-ink-600">
                          <HelpCircle className="size-3" /> Sin clave
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
                    <td className="px-4 py-3 text-right font-mono tabular-nums">
                      {e.remuneraciones_count}
                    </td>
                    <td
                      className="px-4 py-3 text-center"
                      onClick={(ev) => ev.stopPropagation()}
                    >
                      <div className="inline-flex gap-1">
                        <button
                          type="button"
                          disabled={!e.tiene_credencial_nubox || testLoginMut.isPending}
                          onClick={() => testLoginMut.mutate(e.empresa_codigo)}
                          className="inline-flex items-center gap-1 rounded-md bg-ink-100 px-2 py-1 text-[11px] font-medium text-ink-700 hover:bg-ink-200 disabled:opacity-50"
                          title="Validar clave Nubox"
                        >
                          <TestTube2 className="size-3" />
                          Test
                        </button>
                        <button
                          type="button"
                          disabled={!e.tiene_credencial_nubox || syncMut.isPending}
                          onClick={() =>
                            syncMut.mutate({ empresa: e.empresa_codigo, periodo })
                          }
                          className="inline-flex items-center gap-1 rounded-md bg-cehta-green px-2 py-1 text-[11px] font-medium text-white hover:bg-cehta-green/90 disabled:opacity-50"
                          title={`Auto-sync ${periodo} (puede fallar — usar fallback Excel si pasa)`}
                        >
                          {syncMut.isPending ? (
                            <RefreshCw className="size-3 animate-spin" />
                          ) : (
                            <Download className="size-3" />
                          )}
                          Auto-sync
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

      {/* Selector de período */}
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
        <p className="text-xs text-ink-500">
          (Default: mes anterior, ya que el mes en curso aún no cerró)
        </p>
      </section>

      {/* Upload Excel manual — el método robusto */}
      {selectedEmpresa && (
        <section className="rounded-2xl bg-cehta-green/[0.05] ring-1 ring-cehta-green/20 p-4">
          <h3 className="font-display text-sm font-semibold text-cehta-green mb-2">
            📊 Subir Libro de Remuneraciones (recomendado)
          </h3>
          <p className="text-xs text-ink-700 mb-3 max-w-2xl">
            En Nubox web: <strong>Remuneraciones → Reportes → Libro de
            Remuneraciones</strong> → seleccionar período → <strong>Descargar Excel</strong>. Luego subilo acá.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => setExcelFile(e.target.files?.[0] ?? null)}
              className="text-xs"
            />
            <button
              type="button"
              disabled={!excelFile || importExcelMut.isPending}
              onClick={() => {
                if (!excelFile || !selectedEmpresa) return;
                importExcelMut.mutate({
                  empresa: selectedEmpresa,
                  file: excelFile,
                  periodo,
                });
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-cehta-green px-3 py-1.5 text-xs font-medium text-white hover:bg-cehta-green/90 disabled:opacity-50"
            >
              <Upload className="size-3" />
              {importExcelMut.isPending ? "Subiendo..." : "Subir xlsx"}
            </button>
          </div>
        </section>
      )}

      {/* Resumen del período */}
      {selectedEmpresa && resumen && resumen.trabajadores_count > 0 && (
        <section className="rounded-2xl bg-gradient-to-br from-cehta-green/[0.06] via-white to-cehta-green/[0.03] ring-1 ring-cehta-green/20 p-6">
          <div className="inline-flex items-center gap-2 rounded-full bg-cehta-green/10 px-3 py-1 ring-1 ring-cehta-green/20">
            <Wallet className="size-3.5 text-cehta-green" />
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
              Resumen · {selectedEmpresa} · {periodo}
            </p>
          </div>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="Trabajadores" value={String(resumen.trabajadores_count)} />
            <Card label="Total haberes" value={fmtCLP(resumen.total_haberes)} />
            <Card label="Total descuentos" value={fmtCLP(resumen.total_descuentos)} />
            <Card
              label="Líquido a pagar"
              value={fmtCLP(resumen.total_liquido)}
              highlight
            />
          </div>
          <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card label="AFP" value={fmtCLP(resumen.total_afp)} small />
            <Card label="Salud" value={fmtCLP(resumen.total_salud)} small />
            <Card label="Impuesto único" value={fmtCLP(resumen.total_impuesto)} small />
            <Card
              label="Aportes patronales"
              value={fmtCLP(resumen.total_aportes_patronales)}
              small
            />
          </div>
        </section>
      )}

      {/* Tabla detalle */}
      {selectedEmpresa && remuneraciones && remuneraciones.length > 0 && (
        <section className="rounded-2xl bg-white ring-1 ring-hairline overflow-hidden">
          <header className="px-6 py-4 border-b border-hairline">
            <h2 className="font-display text-lg font-semibold text-ink-900 flex items-center gap-2">
              <Receipt className="size-4 text-cehta-green" />
              Detalle por trabajador
            </h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-3">Trabajador / RUT</th>
                  <th className="px-4 py-3 text-right">Sueldo base</th>
                  <th className="px-4 py-3 text-right">Total haberes</th>
                  <th className="px-4 py-3 text-right">AFP</th>
                  <th className="px-4 py-3 text-right">Salud</th>
                  <th className="px-4 py-3 text-right">Descuentos</th>
                  <th className="px-4 py-3 text-right">Líquido</th>
                  <th className="px-4 py-3">Voucher</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {remuneraciones.map((r) => (
                  <tr key={r.remuneracion_id}>
                    <td className="px-4 py-2">
                      <div className="text-ink-900">{r.trabajador_nombre ?? "—"}</div>
                      <div className="text-[10px] font-mono text-ink-500">
                        {r.trabajador_rut}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {fmtCLP(r.sueldo_base)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums">
                      {fmtCLP(r.total_haberes)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-ink-600">
                      {fmtCLP(r.afp_descuento)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-ink-600">
                      {fmtCLP(r.salud_descuento)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-red-700">
                      {fmtCLP(r.total_descuentos)}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums font-medium text-ink-900">
                      {fmtCLP(r.sueldo_liquido)}
                    </td>
                    <td className="px-4 py-2 text-[10px]">
                      {r.voucher_id ? (
                        <Link
                          href={`/vouchers/${r.voucher_id}` as Route}
                          className="text-cehta-green hover:underline font-mono"
                        >
                          #{r.voucher_id}
                        </Link>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selectedEmpresa &&
        remuneraciones &&
        remuneraciones.length === 0 && (
          <div className="rounded-2xl border border-dashed border-hairline bg-white p-10 text-center">
            <p className="text-sm font-medium text-ink-700">
              Sin remuneraciones para {selectedEmpresa} en {periodo}
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs text-ink-500">
              Sube el Libro de Remuneraciones del período arriba para
              cargar los datos.
            </p>
          </div>
        )}
    </div>
  );
}

function Card({
  label, value, small = false, highlight = false,
}: {
  label: string;
  value: string;
  small?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-xl bg-white ring-1 ring-hairline p-3">
      <p className="text-[10px] uppercase tracking-wide text-ink-500">{label}</p>
      <p
        className={`font-mono tabular-nums mt-1 ${
          small ? "text-sm" : "text-lg"
        } ${highlight ? "font-bold text-cehta-green" : "font-semibold text-ink-900"}`}
      >
        {value}
      </p>
    </div>
  );
}
