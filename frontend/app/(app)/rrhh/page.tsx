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

import { useState, useRef, useMemo } from "react";
import dynamic from "next/dynamic";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import type { Route } from "next";
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
  Pencil,
  Trash2,
  Plus,
  X,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";

// R152FFFF — Lazy load chart (recharts ya está en bundle global pero
// igual lo hacemos cliente-side para no aumentar el SSR de /rrhh).
const EvolucionCostoChart = dynamic(
  () =>
    import("@/components/rrhh/EvolucionCostoChart").then(
      (m) => m.EvolucionCostoChart,
    ),
  { ssr: false, loading: () => <Skeleton className="h-64 w-full rounded-2xl" /> },
);

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
  const router = useRouter();
  const [empresaUpload, setEmpresaUpload] = useState("AFIS");
  const [empresaFilter, setEmpresaFilter] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [editEmp, setEditEmp] = useState<Empleado | null>(null);
  const [showCreate, setShowCreate] = useState(false);

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

  // R152FFFF — Serie temporal para gráfico evolución mensual.
  // Agrupa libros por periodo, suma costo_total cross-empresa.
  const evolucionData = useMemo(() => {
    const m = new Map<string, { periodo: string; total: number; byEmpresa: Record<string, number> }>();
    (libros.data ?? []).forEach((l) => {
      const acc = m.get(l.periodo) ?? { periodo: l.periodo, total: 0, byEmpresa: {} };
      const v = Number(l.total_costo_empresa);
      acc.total += v;
      acc.byEmpresa[l.empresa_codigo] = (acc.byEmpresa[l.empresa_codigo] ?? 0) + v;
      m.set(l.periodo, acc);
    });
    return Array.from(m.values()).sort((a, b) =>
      a.periodo.localeCompare(b.periodo),
    );
  }, [libros.data]);

  // 3. Empleados (filtrable por empresa)
  const empleados = useQuery<Empleado[]>({
    queryKey: ["rrhh-empleados", empresaFilter],
    queryFn: () => {
      const qs = empresaFilter ? `?empresa_codigo=${empresaFilter}` : "";
      return apiClient.get<Empleado[]>(`/rrhh/empleados${qs}`, session);
    },
    enabled: !!session && access.data?.allowed,
    staleTime: 30_000,
  });

  // Mutations CRUD empleados (R152CCCC)
  const deleteEmpMut = useMutation({
    mutationFn: async (rut: string) =>
      apiClient.delete(`/rrhh/empleados/${rut}`, session),
    onSuccess: () => {
      toast.success("Empleado dado de baja");
      qc.invalidateQueries({ queryKey: ["rrhh-empleados"] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof ApiError ? e.detail : "Error"),
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

      {/* R152FFFF — Gráfico evolución mensual costo total */}
      <EvolucionCostoChart data={evolucionData} />

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
                    onClick={() => router.push(`/rrhh/libros/${l.id}` as Route)}
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
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-3">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink-900">
              Empleados activos
            </h2>
            <p className="text-[11px] text-ink-500 mt-1">
              Catálogo editable cross-empresa. Click en un empleado para editar.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={empresaFilter}
              onChange={(e) => setEmpresaFilter(e.target.value)}
              className="rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              <option value="">Todas las empresas</option>
              {EMPRESAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green px-3 py-2 text-xs font-semibold text-white hover:bg-cehta-green/90"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
              Nuevo empleado
            </button>
          </div>
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
                  <th className="w-24 px-4 py-3"></th>
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
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => setEditEmp(e)}
                          className="p-1.5 rounded-lg text-ink-500 hover:text-cehta-green hover:bg-cehta-green/10"
                          title="Editar empleado"
                        >
                          <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`¿Dar de baja a ${e.nombre}?`)) {
                              deleteEmpMut.mutate(e.rut);
                            }
                          }}
                          className="p-1.5 rounded-lg text-ink-500 hover:text-red-600 hover:bg-red-50"
                          title="Dar de baja (soft delete)"
                        >
                          <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                        </button>
                      </div>
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
              No hay empleados activos{empresaFilter ? ` en ${empresaFilter}` : ""}.
              {!empresaFilter && " Cargá un libro o creá empleados manualmente."}
            </p>
          </div>
        )}
      </section>

      {/* R152CCCC — Modal de edición/creación empleado */}
      {(editEmp || showCreate) && (
        <EmpleadoModal
          empleado={editEmp}
          onClose={() => {
            setEditEmp(null);
            setShowCreate(false);
          }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["rrhh-empleados"] });
            setEditEmp(null);
            setShowCreate(false);
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// R152CCCC — Modal de edición/creación empleado
// ─────────────────────────────────────────────────────────────────────

function EmpleadoModal({
  empleado,
  onClose,
  onSaved,
}: {
  empleado: Empleado | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { session } = useSession();
  const isCreate = !empleado;
  const [rut, setRut] = useState(empleado?.rut ?? "");
  const [nombre, setNombre] = useState(empleado?.nombre ?? "");
  const [empresaCodigo, setEmpresaCodigo] = useState(
    empleado?.empresa_codigo ?? "AFIS",
  );
  const [area, setArea] = useState(empleado?.area ?? "");
  const [cargo, setCargo] = useState(empleado?.cargo ?? "");
  const [sueldoBase, setSueldoBase] = useState(
    empleado?.sueldo_base_actual ?? "",
  );
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!rut.trim() || !nombre.trim()) {
      toast.error("RUT y nombre son obligatorios");
      return;
    }
    setLoading(true);
    try {
      const payload = {
        rut: rut.trim(),
        nombre: nombre.trim(),
        empresa_codigo: empresaCodigo,
        area: area.trim() || null,
        cargo: cargo.trim() || null,
        sueldo_base_actual: sueldoBase ? Number(sueldoBase) : null,
      };
      if (isCreate) {
        await apiClient.post("/rrhh/empleados", payload, session);
        toast.success(`Empleado ${nombre} creado`);
      } else {
        // PATCH solo manda los campos cambiados; mandamos todo lo que tiene valor
        const patch: Record<string, unknown> = {
          nombre: payload.nombre,
          area: payload.area,
          cargo: payload.cargo,
          sueldo_base_actual: payload.sueldo_base_actual,
        };
        await apiClient.patch(
          `/rrhh/empleados/${empleado.rut}`,
          patch,
          session,
        );
        toast.success(`Empleado ${nombre} actualizado`);
      }
      onSaved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "Error guardando");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-lg space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-600 hover:bg-ink-200"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
        <h2 className="font-display text-xl font-semibold tracking-tight">
          {isCreate ? "Nuevo empleado" : "Editar empleado"}
        </h2>

        <div className="grid grid-cols-2 gap-3">
          <Field label="RUT (con DV)" required>
            <input
              type="text"
              value={rut}
              disabled={!isCreate}
              onChange={(e) => setRut(e.target.value)}
              placeholder="12345678-9"
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm font-mono ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:opacity-60"
            />
          </Field>
          <Field label="Empresa">
            <select
              value={empresaCodigo}
              onChange={(e) => setEmpresaCodigo(e.target.value)}
              disabled={!isCreate}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green disabled:opacity-60"
            >
              {EMPRESAS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Nombre completo" required className="col-span-2">
            <input
              type="text"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
          <Field label="Área">
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Gerencia, Adm. y Finanzas..."
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
          <Field label="Cargo">
            <input
              type="text"
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              placeholder="Analista, Jefe..."
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
          <Field label="Sueldo base" className="col-span-2">
            <input
              type="number"
              value={String(sueldoBase ?? "")}
              onChange={(e) => setSueldoBase(e.target.value)}
              placeholder="0"
              className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm font-mono ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
            />
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="rounded-xl bg-ink-100 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-200 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={loading}
            className="rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white hover:bg-cehta-green/90 disabled:opacity-50"
          >
            {loading ? "Guardando…" : "Guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  required,
  children,
  className,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 mb-1">
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
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
