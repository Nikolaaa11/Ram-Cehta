"use client";

/**
 * R152vvv — Módulo RRHH
 *
 * Acceso restringido a Benjamín Toro, Victoria y admins (allowlist en
 * core.rrhh_allowlist). El backend devuelve 403 si no estás en la lista;
 * acá hacemos GET /rrhh/access para mostrar empty state lindo en vez de
 * 403 toast feo.
 *
 * Funcionalidad:
 *   1. KPIs globales: # libros cargados, # empleados activos, costo último mes
 *   2. Upload de libro de remuneraciones Excel
 *   3. Tabla de libros mensuales (drill-down a detalle)
 *   4. Tabla de empleados activos con sueldo base y área
 */

import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Upload,
  TrendingUp,
  Calendar,
  Building2,
  ShieldAlert,
  Wallet,
  ChevronRight,
  FileSpreadsheet,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";

interface Empleado {
  rut: string;
  nombre: string;
  empresa_codigo: string;
  area: string | null;
  cargo: string | null;
  fecha_ingreso: string | null;
  activo: boolean;
  sueldo_base_actual: string | null;
}

interface Libro {
  id: number;
  empresa_codigo: string;
  periodo: string;
  total_haberes: string;
  total_liquido: string;
  total_descuentos_legales: string;
  total_aportes_patronales: string;
  total_costo_empresa: string;
  cantidad_empleados: number;
  archivo_origen: string | null;
  uploaded_at: string;
}

interface AccessResponse {
  allowed: boolean;
  reason?: string;
}

const EMPRESAS = [
  "AFIS", "FIP_CEHTA", "CENERGY", "EVOQUE", "CSL",
  "TRONGKAI", "RHO", "REVTECH", "DTE",
];

const fmtCLP = (v: number | string | null) => {
  const n = typeof v === "string" ? Number(v) : v ?? 0;
  if (!n) return "$0";
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${n.toLocaleString("es-CL")}`;
};

const fmtPeriodo = (p: string) => {
  // 'YYYY-MM' → 'Mes YYYY'
  const [y, m] = p.split("-");
  const meses = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const idx = parseInt(m ?? "0", 10);
  return `${meses[idx] ?? m ?? ""} ${y ?? ""}`;
};

export default function RRHHPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [empresaUpload, setEmpresaUpload] = useState("AFIS");
  const fileRef = useRef<HTMLInputElement>(null);

  // 1. Access check
  const access = useQuery<AccessResponse>({
    queryKey: ["rrhh-access"],
    queryFn: () => apiClient.get<AccessResponse>("/rrhh/access", session),
    enabled: !!session,
  });

  // 2. Libros
  const libros = useQuery<Libro[]>({
    queryKey: ["rrhh-libros"],
    queryFn: () => apiClient.get<Libro[]>("/rrhh/libros", session),
    enabled: !!session && access.data?.allowed,
    staleTime: 60_000,
  });

  // 3. Empleados
  const empleados = useQuery<Empleado[]>({
    queryKey: ["rrhh-empleados"],
    queryFn: () =>
      apiClient.get<Empleado[]>("/rrhh/empleados", session),
    enabled: !!session && access.data?.allowed,
    staleTime: 60_000,
  });

  // 4. Upload mutation
  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return apiClient.postForm<{
        libro_id: number;
        empresa_codigo: string;
        periodo: string;
        cantidad_empleados: number;
        total_costo_empresa: string;
        reemplazo: boolean;
      }>(
        `/rrhh/libros/upload?empresa_codigo=${empresaUpload}`,
        fd,
        session,
      );
    },
    onSuccess: (data) => {
      toast.success(
        data.reemplazo
          ? `Libro ${fmtPeriodo(data.periodo)} actualizado (reemplazó el existente). ${data.cantidad_empleados} empleados, costo total ${fmtCLP(data.total_costo_empresa)}.`
          : `Libro ${fmtPeriodo(data.periodo)} cargado. ${data.cantidad_empleados} empleados, costo total ${fmtCLP(data.total_costo_empresa)}.`,
        { duration: 8000 },
      );
      qc.invalidateQueries({ queryKey: ["rrhh-libros"] });
      qc.invalidateQueries({ queryKey: ["rrhh-empleados"] });
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (err: unknown) => {
      const msg = err instanceof ApiError ? err.detail : "Error desconocido";
      toast.error(`Upload falló: ${msg}`, { duration: 10_000 });
    },
  });

  // Loading state mientras chequea acceso
  if (access.isLoading) {
    return (
      <div className="mx-auto max-w-[1280px] px-6 lg:px-10 pt-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-32 w-full" />
      </div>
    );
  }

  // No autorizado
  if (access.data && !access.data.allowed) {
    return (
      <div className="mx-auto max-w-2xl px-6 pt-20 text-center">
        <ShieldAlert className="mx-auto h-16 w-16 text-ink-300" strokeWidth={1.5} />
        <h1 className="mt-6 font-display text-2xl font-semibold text-ink-900">
          Módulo RRHH restringido
        </h1>
        <p className="mt-3 text-sm text-ink-500">
          {access.data.reason ??
            "Este módulo está restringido al equipo de RRHH (Benjamín, Victoria y administradores)."}
        </p>
        <p className="mt-2 text-xs text-ink-400">
          Si necesitás acceso, pedile a un admin que te agregue a la
          allowlist (<code>core.rrhh_allowlist</code>).
        </p>
      </div>
    );
  }

  // Datos derivados para KPIs
  const libroMasReciente = libros.data?.[0];
  const empleadosActivos = empleados.data?.length ?? 0;
  const empresasConData = new Set(libros.data?.map((l) => l.empresa_codigo) ?? []).size;

  return (
    <div className="mx-auto max-w-[1280px] px-6 lg:px-10 pt-8 pb-24 space-y-8">
      {/* Header */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
          R152vvv · Módulo restringido a RRHH
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900 sm:text-[36px]">
          Recursos Humanos
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Gasto real de la empresa por cada empleado. Incluye aportes patronales
          (AFP empleador, SIS, Seg. Cesantía 2.4%, Mutual, Seg. Social) además
          del líquido y los descuentos legales.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KPICard
          icon={<FileSpreadsheet className="h-5 w-5" strokeWidth={1.5} />}
          label="Libros cargados"
          value={libros.data?.length ?? 0}
          sub={`${empresasConData} empresa${empresasConData === 1 ? "" : "s"} con datos`}
        />
        <KPICard
          icon={<Users className="h-5 w-5" strokeWidth={1.5} />}
          label="Empleados activos"
          value={empleadosActivos}
          sub="Cross empresas portfolio"
        />
        <KPICard
          icon={<Wallet className="h-5 w-5" strokeWidth={1.5} />}
          label={
            libroMasReciente
              ? `Costo total ${fmtPeriodo(libroMasReciente.periodo)} (${libroMasReciente.empresa_codigo})`
              : "Costo último mes"
          }
          value={fmtCLP(libroMasReciente?.total_costo_empresa ?? 0)}
          sub={
            libroMasReciente
              ? `vs líquido pagado ${fmtCLP(libroMasReciente.total_liquido)}`
              : "Cargá un libro para ver KPIs"
          }
        />
      </div>

      {/* Upload */}
      <section className="rounded-3xl border border-hairline bg-white p-6 shadow-card">
        <div className="flex items-start gap-3">
          <Upload className="h-5 w-5 text-cehta-green" strokeWidth={1.75} />
          <div className="flex-1">
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Subir libro de remuneraciones
            </h2>
            <p className="mt-1 text-xs text-ink-500">
              Excel formato estándar Nubox / SII. El sistema detecta automáticamente
              el periodo desde el encabezado del archivo y reemplaza el libro
              existente si ya hubiera uno cargado para esa empresa + mes.
            </p>

            <div className="mt-4 flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 mb-1">
                  Empresa destino
                </label>
                <select
                  value={empresaUpload}
                  onChange={(e) => setEmpresaUpload(e.target.value)}
                  className="rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                >
                  {EMPRESAS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 mb-1">
                  Archivo .xlsx
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  disabled={uploadMut.isPending}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadMut.mutate(f);
                  }}
                  className="block w-full max-w-md text-xs text-ink-600 file:mr-3 file:rounded-xl file:border-0 file:bg-cehta-green file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-cehta-green/90 disabled:opacity-50"
                />
              </div>
              {uploadMut.isPending && (
                <span className="text-xs text-ink-500">Procesando…</span>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Libros */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-display text-lg font-semibold text-ink-900">
            Libros mensuales cargados
          </h2>
          <p className="text-[11px] text-ink-500">
            Click en un libro para ver el detalle por empleado
          </p>
        </div>
        {libros.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : libros.data && libros.data.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-3">Periodo</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3 text-right">Empleados</th>
                  <th className="px-4 py-3 text-right">Líquido pagado</th>
                  <th className="px-4 py-3 text-right">Aportes patronales</th>
                  <th className="px-4 py-3 text-right">Costo total empresa</th>
                  <th className="w-10 px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {libros.data.map((l) => (
                  <tr
                    key={l.id}
                    className="border-t border-hairline/50 hover:bg-cehta-green/5 cursor-pointer"
                    onClick={() => {
                      // TODO: drill-down futuro a /rrhh/libros/[id]
                      toast.info(`Detalle libro #${l.id} próximamente`);
                    }}
                  >
                    <td className="px-4 py-3 font-medium text-ink-900">
                      {fmtPeriodo(l.periodo)}
                    </td>
                    <td className="px-4 py-3 text-ink-600">{l.empresa_codigo}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {l.cantidad_empleados}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtCLP(l.total_liquido)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-amber-700">
                      {fmtCLP(l.total_aportes_patronales)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold text-cehta-green">
                      {fmtCLP(l.total_costo_empresa)}
                    </td>
                    <td className="px-4 py-3">
                      <ChevronRight className="h-4 w-4 text-ink-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-hairline bg-ink-50/30 p-8 text-center">
            <Calendar className="mx-auto h-10 w-10 text-ink-300" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-ink-500">
              Aún no hay libros cargados. Subí tu primer Excel arriba.
            </p>
          </div>
        )}
      </section>

      {/* Empleados activos */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-display text-lg font-semibold text-ink-900">
            Empleados activos
          </h2>
          <p className="text-[11px] text-ink-500">
            Catálogo cross-empresa. Se actualiza al cargar libros nuevos.
          </p>
        </div>
        {empleados.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : empleados.data && empleados.data.length > 0 ? (
          <div className="overflow-hidden rounded-2xl border border-hairline bg-white shadow-card">
            <table className="w-full text-sm">
              <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
                <tr>
                  <th className="px-4 py-3">RUT</th>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3">Área</th>
                  <th className="px-4 py-3 text-right">Sueldo base</th>
                </tr>
              </thead>
              <tbody>
                {empleados.data.map((e) => (
                  <tr key={e.rut} className="border-t border-hairline/50">
                    <td className="px-4 py-3 font-mono text-xs text-ink-600">{e.rut}</td>
                    <td className="px-4 py-3 font-medium text-ink-900">{e.nombre}</td>
                    <td className="px-4 py-3 text-ink-600">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <Building2 className="h-3 w-3" strokeWidth={2} />
                        {e.empresa_codigo}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-ink-600">{e.area ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtCLP(e.sueldo_base_actual)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-hairline bg-ink-50/30 p-8 text-center">
            <Users className="mx-auto h-10 w-10 text-ink-300" strokeWidth={1.5} />
            <p className="mt-3 text-sm text-ink-500">
              No hay empleados activos. Cargá un libro para popularizar el catálogo.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}

function KPICard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub: string;
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
      <div className="flex items-center gap-2 text-ink-500">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">
          {label}
        </span>
      </div>
      <p className="mt-2 font-display text-2xl font-semibold tabular-nums text-ink-900">
        {value}
      </p>
      <p className="mt-1 text-xs text-ink-500">{sub}</p>
    </div>
  );
}

function _unused() {
  // Suprimir warning por TrendingUp no usado (lo reservo para fase costo histórico)
  return TrendingUp;
}
