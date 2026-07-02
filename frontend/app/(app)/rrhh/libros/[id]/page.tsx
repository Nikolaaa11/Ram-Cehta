"use client";

/**
 * R152CCCC — Detalle del libro de remuneraciones (editable).
 *
 * Lista líneas por empleado con campos clave editables:
 *  - sueldo_base, horas_extras, gratificación, otros imponibles
 *  - asignación familiar, otros no imponibles
 *  - descuentos legales (AFP, salud, cesantía, otros, varios)
 *  - aportes patronales (AFP emp, SIS, cesantía emp, social, mutual)
 *
 * Al editar un campo, el backend recalcula totales derivados y los
 * totales del libro cabecera.
 */

import { use, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft, Calendar, Building2, Pencil, Download } from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";

interface Linea {
  id: number;
  empleado_rut: string;
  nombre: string;
  area: string | null;
  dias_trabajados: string;
  total_haberes: string;
  liquido_pagado: string;
  total_descuentos_legales: string;
  total_aportes_patronales: string;
  costo_total_empresa: string;
  sueldo_base: string;
  horas_extras: string;
  gratificacion_legal: string;
  asignacion_familiar: string;
  aporte_afp_empleador: string;
  sis: string;
  seguro_cesantia_empleador: string;
  seguro_social: string;
  mutual: string;
  base_tributable: string;
  impuesto_unico: string;
}

interface LibroDetalle {
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
  lineas: Linea[];
}

const fmtCLP = (v: string | number) => {
  const n = typeof v === "string" ? Number(v) : v;
  if (!n) return "$0";
  return `$${n.toLocaleString("es-CL")}`;
};

const fmtPeriodo = (p: string) => {
  const [y, m] = p.split("-");
  const meses = [
    "", "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
  ];
  const idx = parseInt(m ?? "0", 10);
  return `${meses[idx] ?? m ?? ""} ${y ?? ""}`;
};

export default function LibroDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const libroId = Number(id);
  const { session } = useSession();
  const qc = useQueryClient();
  const [editLinea, setEditLinea] = useState<Linea | null>(null);

  const libro = useQuery<LibroDetalle>({
    queryKey: ["rrhh-libro", libroId],
    queryFn: () =>
      apiClient.get<LibroDetalle>(`/rrhh/libros/${libroId}`, session),
    enabled: !!session && Number.isFinite(libroId),
  });

  if (libro.isLoading) {
    return (
      <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-4 h-96 w-full" />
      </div>
    );
  }

  if (!libro.data) {
    return (
      <div className="mx-auto max-w-2xl px-6 pt-20 text-center text-sm text-ink-500">
        Libro no encontrado.
        <div className="mt-4">
          <Link href={"/rrhh" as Route} className="text-cehta-green underline">
            ← Volver a RRHH
          </Link>
        </div>
      </div>
    );
  }

  const l = libro.data;

  return (
    <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-8 pb-24 space-y-6">
      <div>
        <Link
          href={"/rrhh" as Route}
          className="inline-flex items-center gap-1.5 text-xs text-ink-500 hover:text-cehta-green"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
          Volver a RRHH
        </Link>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="mt-2 font-display text-2xl font-semibold text-ink-900">
              Libro de remuneraciones · {fmtPeriodo(l.periodo)}
            </h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-ink-600">
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-4 w-4 text-cehta-green" strokeWidth={1.75} />
                <strong>{l.empresa_codigo}</strong>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="h-4 w-4 text-ink-400" strokeWidth={1.75} />
                {l.cantidad_empleados} empleados
              </span>
            </div>
          </div>
          {/* R152DDDD — Botón export Excel formato Nubox/SII */}
          {/* R152UUUUUU: era <a href="/api/v1/..."> relativo al dominio del
              frontend (no existe ahi) - click normal funcionaba por el
              preventDefault, pero middle-click / abrir en pestana nueva /
              copiar enlace daban 404. Como boton no hay URL enganosa. */}
          <button
            type="button"
            onClick={async () => {
              if (!session?.access_token) return;
              try {
                const res = await fetch(
                  `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1"}/rrhh/libros/${libroId}/export-excel`,
                  {
                    headers: { Authorization: `Bearer ${session.access_token}` },
                  },
                );
                if (!res.ok) {
                  toast.error(`Export falló: HTTP ${res.status}`);
                  return;
                }
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `libro_remuneraciones_${l.empresa_codigo}_${l.periodo}.xlsx`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(url);
                toast.success("Excel descargado");
              } catch (err) {
                toast.error("Error descargando Excel");
              }
            }}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white hover:bg-cehta-green/90 cursor-pointer"
          >
            <Download className="h-4 w-4" strokeWidth={2} />
            Exportar Excel
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <KPICard label="Total haberes" value={fmtCLP(l.total_haberes)} />
        <KPICard
          label="Líquido pagado"
          value={fmtCLP(l.total_liquido)}
          sub="lo que recibe el empleado"
        />
        <KPICard
          label="Aportes patronales"
          value={fmtCLP(l.total_aportes_patronales)}
          sub="AFP + SIS + cesantía + mutual"
          color="amber"
        />
        <KPICard
          label="Costo total empresa"
          value={fmtCLP(l.total_costo_empresa)}
          sub="haberes + aportes patronales"
          color="green"
        />
      </div>

      {/* Tabla líneas */}
      <div className="overflow-x-auto rounded-2xl border border-hairline bg-white shadow-card">
        <table className="min-w-full text-sm">
          <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
            <tr>
              <th className="px-4 py-3">Empleado</th>
              <th className="px-4 py-3">Área</th>
              <th className="px-4 py-3 text-right">Sueldo base</th>
              <th className="px-4 py-3 text-right">Total haberes</th>
              <th className="px-4 py-3 text-right">Líquido</th>
              <th className="px-4 py-3 text-right">Aportes patron.</th>
              <th className="px-4 py-3 text-right">Costo total</th>
              <th className="w-10 px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {l.lineas.map((linea) => (
              <tr key={linea.id} className="border-t border-hairline/50">
                <td className="px-4 py-3">
                  <div className="font-medium text-ink-900">{linea.nombre}</div>
                  <div className="font-mono text-[10px] text-ink-500">
                    {linea.empleado_rut}
                  </div>
                </td>
                <td className="px-4 py-3 text-xs text-ink-600">
                  {linea.area ?? "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-ink-600">
                  {fmtCLP(linea.sueldo_base)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fmtCLP(linea.total_haberes)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {fmtCLP(linea.liquido_pagado)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-amber-700">
                  {fmtCLP(linea.total_aportes_patronales)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-cehta-green">
                  {fmtCLP(linea.costo_total_empresa)}
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => setEditLinea(linea)}
                    className="p-1.5 rounded-lg text-ink-500 hover:text-cehta-green hover:bg-cehta-green/10"
                    title="Editar línea"
                  >
                    <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-500">
        Click en el ícono de lápiz para editar campos de cada empleado. El
        sistema recalcula automáticamente totales derivados y los totales
        del libro.
      </p>

      {editLinea && (
        <LineaModal
          libroId={libroId}
          linea={editLinea}
          onClose={() => setEditLinea(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["rrhh-libro", libroId] });
            qc.invalidateQueries({ queryKey: ["rrhh-libros"] });
            setEditLinea(null);
          }}
        />
      )}
    </div>
  );
}

function KPICard({
  label,
  value,
  sub,
  color = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  color?: "default" | "amber" | "green";
}) {
  const colorClass =
    color === "amber"
      ? "text-amber-700"
      : color === "green"
        ? "text-cehta-green"
        : "text-ink-900";
  return (
    <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
        {label}
      </p>
      <p className={`mt-2 font-display text-xl font-semibold tabular-nums ${colorClass}`}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-ink-500">{sub}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Modal edición de línea
// ─────────────────────────────────────────────────────────────────────

const CAMPOS_EDITABLES = [
  { key: "sueldo_base", label: "Sueldo base", group: "haberes" },
  { key: "horas_extras", label: "Horas extras", group: "haberes" },
  { key: "gratificacion_legal", label: "Gratificación legal", group: "haberes" },
  { key: "otros_imponibles", label: "Otros imponibles", group: "haberes" },
  { key: "asignacion_familiar", label: "Asignación familiar", group: "haberes" },
  { key: "otros_no_imponibles", label: "Otros no imponibles", group: "haberes" },
  { key: "prevision", label: "Previsión (AFP)", group: "descuentos" },
  { key: "salud", label: "Salud", group: "descuentos" },
  { key: "seguro_cesantia_trab", label: "Seg. Cesantía (trab.)", group: "descuentos" },
  { key: "otros_descuentos_legales", label: "Otros desc. legales", group: "descuentos" },
  { key: "descuentos_varios", label: "Descuentos varios", group: "descuentos" },
  { key: "aporte_afp_empleador", label: "AFP empleador", group: "patronales" },
  { key: "sis", label: "SIS", group: "patronales" },
  { key: "seguro_cesantia_empleador", label: "Seg. Cesantía (emp.)", group: "patronales" },
  { key: "seguro_social", label: "Seguro Social", group: "patronales" },
  { key: "mutual", label: "Mutual ATEP", group: "patronales" },
] as const;

const GROUP_LABELS: Record<string, string> = {
  haberes: "Haberes (imponibles + no imp.)",
  descuentos: "Descuentos trabajador",
  patronales: "Aportes patronales (empresa)",
};

function LineaModal({
  libroId,
  linea,
  onClose,
  onSaved,
}: {
  libroId: number;
  linea: Linea;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { session } = useSession();
  // Estado: copia de los valores actuales
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of CAMPOS_EDITABLES) {
      const v = (linea as unknown as Record<string, string>)[f.key];
      init[f.key] = v != null ? String(Math.round(Number(v))) : "0";
    }
    return init;
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: Record<string, number> = {};
      for (const [k, v] of Object.entries(values)) {
        const n = Number(v);
        if (!isNaN(n) && n >= 0) payload[k] = n;
      }
      return apiClient.patch(
        `/rrhh/libros/${libroId}/lineas/${linea.id}`,
        payload,
        session,
      );
    },
    onSuccess: () => {
      toast.success(`Línea de ${linea.nombre} actualizada`);
      onSaved();
    },
    onError: (e: unknown) =>
      toast.error(e instanceof ApiError ? e.detail : "Error guardando"),
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm overflow-y-auto"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-3xl my-8 space-y-4 rounded-3xl bg-white p-6 shadow-2xl"
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full bg-ink-100 text-ink-600 hover:bg-ink-200 text-lg font-semibold"
        >
          ×
        </button>
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight">
            Editar línea: {linea.nombre}
          </h2>
          <p className="text-xs text-ink-500 mt-1">
            RUT {linea.empleado_rut} · {linea.area ?? "Sin área"}
          </p>
        </div>

        {(["haberes", "descuentos", "patronales"] as const).map((g) => (
          <div key={g} className="space-y-2">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cehta-green">
              {GROUP_LABELS[g]}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CAMPOS_EDITABLES.filter((f) => f.group === g).map((f) => (
                <div key={f.key}>
                  <label className="block text-[10px] font-medium text-ink-500 mb-0.5">
                    {f.label}
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={values[f.key] ?? "0"}
                    onChange={(e) =>
                      setValues((prev) => ({ ...prev, [f.key]: e.target.value }))
                    }
                    className="w-full rounded-lg border-0 bg-ink-50 px-2 py-1.5 text-right text-xs font-mono ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        <div className="flex justify-end gap-2 pt-2 border-t border-hairline">
          <button
            onClick={onClose}
            disabled={saveMut.isPending}
            className="rounded-xl bg-ink-100 px-4 py-2 text-sm font-medium text-ink-700 hover:bg-ink-200 disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending}
            className="rounded-xl bg-cehta-green px-4 py-2 text-sm font-semibold text-white hover:bg-cehta-green/90 disabled:opacity-50"
          >
            {saveMut.isPending ? "Guardando…" : "Guardar y recalcular"}
          </button>
        </div>
      </div>
    </div>
  );
}
