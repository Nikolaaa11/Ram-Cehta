"use client";

/**
 * R152zzz — /flujos-caja-proyecto
 *
 * Flujo de caja proyectado por proyecto contable.
 * MEJORAS IA.docx #8: upload Excel + editar en pantalla.
 *
 * UI: selector de proyecto → matriz mes × categoría editable. Upload
 * Excel para poblar de una. Muestra proyectado vs real (vouchers).
 */

import { useState, useRef, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FolderOpen,
  Upload,
  Plus,
  TrendingUp,
  TrendingDown,
  Trash2,
} from "lucide-react";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProyectoContable } from "@/lib/api/schema";

interface FlujoCell {
  id: number;
  proyecto_codigo: string;
  periodo: string;
  categoria: string;
  tipo: "INGRESO" | "EGRESO";
  monto_proyectado: string;
  monto_real: string;
  notas: string | null;
}

const fmtCLP = (v: string | number) => {
  const n = typeof v === "string" ? Number(v) : v;
  if (!n) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${n.toLocaleString("es-CL")}`;
};

const fmtPeriodo = (p: string) => {
  const [y, m] = p.split("-");
  const meses = [
    "", "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
  ];
  return `${meses[parseInt(m)]} ${y}`;
};

const CATEGORIAS_DEFAULT = [
  "RRHH",
  "Operación",
  "Inversión",
  "Gastos generales",
  "Ingresos",
];

export default function FlujosCajaProyectoPage() {
  const { session } = useSession();
  const qc = useQueryClient();
  const [proyectoCodigo, setProyectoCodigo] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Catálogo proyectos
  const proyectos = useQuery<ProyectoContable[]>({
    queryKey: ["proyectos-contables-todos"],
    queryFn: () =>
      apiClient.get<ProyectoContable[]>(
        "/proyectos-contables?estado=ACTIVE",
        session,
      ),
    enabled: !!session,
    staleTime: 60_000,
  });

  // Celdas del flujo
  const flujo = useQuery<FlujoCell[]>({
    queryKey: ["flujo-caja-proyecto", proyectoCodigo],
    queryFn: () =>
      apiClient.get<FlujoCell[]>(
        `/flujos-caja/proyecto/${proyectoCodigo}`,
        session,
      ),
    enabled: !!session && !!proyectoCodigo,
  });

  // Derivar lista de períodos y categorías
  const { periodos, categorias } = useMemo(() => {
    const ps = new Set<string>();
    const cs = new Set<string>();
    (flujo.data ?? []).forEach((c) => {
      ps.add(c.periodo);
      cs.add(c.categoria);
    });
    CATEGORIAS_DEFAULT.forEach((c) => cs.add(c));
    return {
      periodos: Array.from(ps).sort(),
      categorias: Array.from(cs).sort(),
    };
  }, [flujo.data]);

  // Lookup celda por (periodo, categoria)
  const cellMap = useMemo(() => {
    const m = new Map<string, FlujoCell>();
    (flujo.data ?? []).forEach((c) => {
      m.set(`${c.periodo}|${c.categoria}`, c);
    });
    return m;
  }, [flujo.data]);

  const upsertMut = useMutation({
    mutationFn: async (vars: {
      periodo: string;
      categoria: string;
      monto: number;
      tipo: "INGRESO" | "EGRESO";
    }) =>
      apiClient.put<FlujoCell>(
        `/flujos-caja/proyecto/${proyectoCodigo}/cell`,
        {
          periodo: vars.periodo,
          categoria: vars.categoria,
          tipo: vars.tipo,
          monto_proyectado: vars.monto,
        },
        session,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["flujo-caja-proyecto", proyectoCodigo] });
    },
    onError: (e: unknown) =>
      toast.error(e instanceof ApiError ? e.detail : "Error guardando"),
  });

  const uploadMut = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return apiClient.postForm<{
        celdas_creadas: number;
        celdas_actualizadas: number;
      }>(
        `/flujos-caja/proyecto/${proyectoCodigo}/upload`,
        fd,
        session,
      );
    },
    onSuccess: (data) => {
      toast.success(
        `Flujo cargado: ${data.celdas_creadas} nuevas + ${data.celdas_actualizadas} actualizadas.`,
        { duration: 8000 },
      );
      qc.invalidateQueries({ queryKey: ["flujo-caja-proyecto", proyectoCodigo] });
      if (fileRef.current) fileRef.current.value = "";
    },
    onError: (e: unknown) =>
      toast.error(e instanceof ApiError ? e.detail : "Error upload"),
  });

  // Próximos 12 meses para mostrar si no hay nada
  const meses12 = useMemo(() => {
    if (periodos.length > 0) return periodos;
    const arr = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    return arr;
  }, [periodos]);

  const proyectoSel = proyectos.data?.find((p) => p.codigo === proyectoCodigo);

  // Totales por periodo
  const totales = useMemo(() => {
    const t: Record<string, { ing: number; egr: number }> = {};
    (flujo.data ?? []).forEach((c) => {
      if (!t[c.periodo]) t[c.periodo] = { ing: 0, egr: 0 };
      if (c.tipo === "INGRESO") t[c.periodo].ing += Number(c.monto_proyectado);
      else t[c.periodo].egr += Number(c.monto_proyectado);
    });
    return t;
  }, [flujo.data]);

  return (
    <div className="mx-auto max-w-[1400px] px-6 lg:px-10 pt-8 pb-24 space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
          R152zzz · MEJORAS IA.docx #8
        </p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
          Flujo de caja por proyecto
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Cargá tu proyección en pantalla o subila desde un Excel. La columna{" "}
          <strong>Real</strong> se calcula desde los vouchers EXECUTED que tengan
          el código de proyecto asignado.
        </p>
      </div>

      {/* Selector */}
      <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
        <label className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 mb-2">
          <FolderOpen className="inline h-3.5 w-3.5 mr-1" strokeWidth={1.5} />
          Proyecto contable
        </label>
        <select
          value={proyectoCodigo}
          onChange={(e) => setProyectoCodigo(e.target.value)}
          className="w-full rounded-xl border-0 bg-ink-50 px-3 py-2 text-sm ring-1 ring-hairline focus:bg-white focus:outline-none focus:ring-2 focus:ring-cehta-green"
        >
          <option value="">— Elegir proyecto —</option>
          {(proyectos.data ?? []).map((p) => (
            <option key={p.codigo} value={p.codigo}>
              {p.codigo} · {p.nombre}
            </option>
          ))}
        </select>
      </div>

      {!proyectoCodigo ? (
        <div className="rounded-2xl border-2 border-dashed border-hairline bg-ink-50/30 p-12 text-center">
          <FolderOpen className="mx-auto h-12 w-12 text-ink-300" strokeWidth={1.5} />
          <p className="mt-3 text-sm text-ink-500">
            Elegí un proyecto contable para empezar a cargar su flujo de caja.
          </p>
          <p className="mt-1 text-xs text-ink-400">
            ¿No hay proyectos? Crealos en /admin/proyectos-contables.
          </p>
        </div>
      ) : flujo.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <>
          {proyectoSel && (
            <div className="rounded-2xl bg-cehta-green/5 ring-1 ring-cehta-green/20 px-4 py-3 text-sm">
              <strong>{proyectoSel.codigo}</strong> — {proyectoSel.nombre} ·{" "}
              {proyectoSel.tipo_financiamiento}
              {proyectoSel.presupuesto_total && (
                <span className="ml-3 text-ink-600">
                  Presupuesto: {fmtCLP(String(proyectoSel.presupuesto_total))}
                </span>
              )}
            </div>
          )}

          {/* Upload */}
          <div className="rounded-2xl border border-hairline bg-white p-5 shadow-card">
            <div className="flex items-start gap-3">
              <Upload className="h-5 w-5 text-cehta-green mt-0.5" strokeWidth={1.75} />
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-ink-900">
                  Subir Excel del flujo
                </h3>
                <p className="mt-1 text-xs text-ink-500">
                  Columnas requeridas: <code>periodo</code> (YYYY-MM),{" "}
                  <code>categoria</code>, <code>monto</code>. Opcionales:{" "}
                  <code>tipo</code> (INGRESO/EGRESO, default EGRESO),{" "}
                  <code>notas</code>.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls"
                  disabled={uploadMut.isPending}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadMut.mutate(f);
                  }}
                  className="mt-3 block w-full max-w-md text-xs text-ink-600 file:mr-3 file:rounded-xl file:border-0 file:bg-cehta-green file:px-4 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-cehta-green/90 disabled:opacity-50"
                />
              </div>
            </div>
          </div>

          {/* Matriz */}
          <div className="rounded-2xl border border-hairline bg-white shadow-card overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-ink-50/60 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500 sticky top-0">
                <tr>
                  <th className="px-4 py-3 sticky left-0 bg-ink-50/60 border-r border-hairline">
                    Categoría
                  </th>
                  {meses12.map((p) => (
                    <th key={p} className="px-3 py-3 text-right whitespace-nowrap">
                      {fmtPeriodo(p)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categorias.map((cat) => (
                  <tr key={cat} className="border-t border-hairline/50">
                    <td className="px-4 py-2 font-medium text-ink-900 sticky left-0 bg-white border-r border-hairline">
                      {cat}
                    </td>
                    {meses12.map((p) => {
                      const cell = cellMap.get(`${p}|${cat}`);
                      return (
                        <td key={p} className="px-1 py-1">
                          <EditableMontoCell
                            cell={cell}
                            periodo={p}
                            categoria={cat}
                            onSave={(monto, tipo) =>
                              upsertMut.mutate({ periodo: p, categoria: cat, monto, tipo })
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* Totales */}
                <tr className="bg-cehta-green/5 border-t-2 border-cehta-green/30 font-semibold">
                  <td className="px-4 py-2 sticky left-0 bg-cehta-green/5 border-r border-hairline">
                    Neto periodo
                  </td>
                  {meses12.map((p) => {
                    const t = totales[p] ?? { ing: 0, egr: 0 };
                    const neto = t.ing - t.egr;
                    return (
                      <td key={p} className="px-2 py-2 text-right tabular-nums">
                        <span
                          className={
                            neto >= 0
                              ? "text-emerald-700"
                              : "text-red-700"
                          }
                        >
                          {neto >= 0 ? (
                            <TrendingUp className="inline h-3 w-3 mr-0.5" strokeWidth={2} />
                          ) : (
                            <TrendingDown className="inline h-3 w-3 mr-0.5" strokeWidth={2} />
                          )}
                          {fmtCLP(neto)}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              </tbody>
            </table>
          </div>

          <p className="text-xs text-ink-500">
            Tip: tipo INGRESO se muestra en verde, EGRESO en rojo. Click en una
            celda para editar. Enter para guardar. El campo está en miles de
            pesos para acelerar la carga.
          </p>
        </>
      )}
    </div>
  );
}

function EditableMontoCell({
  cell,
  periodo,
  categoria,
  onSave,
}: {
  cell: FlujoCell | undefined;
  periodo: string;
  categoria: string;
  onSave: (monto: number, tipo: "INGRESO" | "EGRESO") => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(
    cell ? String(Math.round(Number(cell.monto_proyectado))) : "",
  );
  const [tipo, setTipo] = useState<"INGRESO" | "EGRESO">(
    cell?.tipo ?? (categoria.toLowerCase().includes("ingres") ? "INGRESO" : "EGRESO"),
  );

  const monto = Number(cell?.monto_proyectado ?? 0);
  const real = Number(cell?.monto_real ?? 0);
  const colorClass = cell?.tipo === "INGRESO" ? "text-emerald-700" : "text-ink-900";

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = Number(draft);
            if (!isNaN(n) && n >= 0) onSave(n, tipo);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const n = Number(draft);
              if (!isNaN(n) && n >= 0) onSave(n, tipo);
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          }}
          className="w-20 rounded-md border-0 bg-white px-2 py-1 text-right text-xs ring-1 ring-cehta-green focus:outline-none focus:ring-2"
        />
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as "INGRESO" | "EGRESO")}
          className="rounded-md border-0 bg-white px-1 py-1 text-[10px] ring-1 ring-hairline"
        >
          <option value="EGRESO">E</option>
          <option value="INGRESO">I</option>
        </select>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className={`w-full rounded-md px-2 py-1 text-right text-xs tabular-nums hover:bg-cehta-green/10 ${colorClass}`}
      title={
        cell
          ? `${cell.tipo} · Real: ${fmtCLP(real)}${cell.notas ? "\n" + cell.notas : ""}`
          : "Click para agregar"
      }
    >
      {monto ? fmtCLP(monto) : <span className="text-ink-300">—</span>}
      {real > 0 && monto > 0 && (
        <div className="text-[9px] text-ink-400 normal-case">
          R: {fmtCLP(real)}
        </div>
      )}
    </button>
  );
}
