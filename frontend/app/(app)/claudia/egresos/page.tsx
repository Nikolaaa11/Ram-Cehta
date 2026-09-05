"use client";

/**
 * /claudia/egresos — Registro de egresos CORFO: la planilla de Claudia
 * adentro de la plataforma.
 *
 * Pedido de Nicolás (2026-09-02): "ingresar los datos como si fuera un
 * excel pero al hacerle click sale toda la información del monto, que es la
 * misma información que pide CORFO y tiene la facultad de separar por
 * porcentaje qué paga Cehta y qué paga el P-tec [...] que se puedan
 * almacenar datos mes a mes y que queden todos registrados".
 *
 * Estructura (§3.5 del spec):
 *   1. Header con el control REVTECH | TRONGKAI (se recuerda en localStorage),
 *      Importar Excel, Exportar y "+ Nuevo gasto".
 *   2. Chips de meses ("Todos" primero, punto ámbar si hay algo por resolver).
 *   3. KPIs del mes con barra apilada por fuente.
 *   4. La grilla editable (`EgresosGrid`).
 *   5. La ficha lateral (`EgresoSheet`) al hacer click en una fila.
 *
 * La API (`/claudia/egresos`) ya aplica el gate de acceso del grupo ClaudIA:
 * un usuario ajeno recibe 403 y acá se le muestra el motivo, no una grilla
 * vacía que parezca "no hay datos".
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, Loader2, Plus, Search, Table2, Upload } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/shared/EmptyState";
import { ErrorState } from "@/components/shared/ErrorState";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { EgresosGrid } from "@/components/claudia/EgresosGrid";
import { EgresoSheet } from "@/components/claudia/EgresoSheet";
import { EgresosKpis, kpisDesdeItems, kpisDesdeResumen } from "@/components/claudia/EgresosKpis";
import { formatearPeriodo, PeriodoChips } from "@/components/claudia/PeriodoChips";
import { ImportarExcelDialog } from "@/components/claudia/ImportarExcelDialog";
import { decimalACentavos } from "@/lib/claudia/reparto";
import { trocearLotes } from "@/lib/claudia/pegar-egresos";
import {
  BATCH_MAX_FILAS,
  CORFO_EMPRESAS,
  LARGO_MAX,
  type BatchRequest,
  type BatchResponse,
  type CatalogosResponse,
  type CorfoEmpresa,
  type DeleteResponse,
  type EgresoCreate,
  type EgresoCreateFila,
  type EgresoRead,
  type EgresosListResponse,
  type EgresoUpdate,
  type PeriodosResponse,
  type ResumenResponse,
} from "@/lib/claudia/types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
const LS_EMPRESA = "claudia-egresos-empresa";

function esCorfoEmpresa(v: unknown): v is CorfoEmpresa {
  return typeof v === "string" && (CORFO_EMPRESAS as readonly string[]).includes(v);
}

function leerEmpresaGuardada(): CorfoEmpresa {
  try {
    if (typeof window !== "undefined") {
      const v = window.localStorage.getItem(LS_EMPRESA);
      if (esCorfoEmpresa(v)) return v;
    }
  } catch {
    // localStorage bloqueado (Safari privado, etc.): se arranca con REVTECH.
  }
  return "REVTECH";
}

function hoyIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function useDebounced<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setV(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return v;
}

export default function RegistroEgresosPage() {
  const { session } = useSession();
  const queryClient = useQueryClient();

  const [empresa, setEmpresa] = useState<CorfoEmpresa>("REVTECH");
  const [hidratado, setHidratado] = useState(false);
  useEffect(() => {
    setEmpresa(leerEmpresaGuardada());
    setHidratado(true);
  }, []);
  useEffect(() => {
    if (!hidratado) return;
    try {
      window.localStorage.setItem(LS_EMPRESA, empresa);
    } catch {
      // sin localStorage no pasa nada: sólo no se recuerda
    }
  }, [empresa, hidratado]);

  /** null = todavía no eligió: se usa el mes más reciente. "" = Todos. */
  const [periodoSel, setPeriodoSel] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // La API acepta `q` de hasta 120 caracteres (422 si se pasa): el input
  // tiene maxLength y acá se recorta igual por si llega pegado.
  const qDebounced = useDebounced(q.trim().slice(0, LARGO_MAX.busqueda), 300);
  const [estadoFiltro, setEstadoFiltro] = useState("");
  const [repartoFiltro, setRepartoFiltro] = useState("");
  const [seleccionado, setSeleccionado] = useState<number | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [focoNuevo, setFocoNuevo] = useState(0);
  const [exportando, setExportando] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────────

  const periodos = useQuery({
    queryKey: ["claudia-egresos", empresa, "periodos"],
    queryFn: () =>
      apiClient.get<PeriodosResponse>(`/claudia/egresos/periodos?empresa=${empresa}`, session),
    enabled: !!session && hidratado,
    staleTime: 60_000,
  });

  const periodo = periodoSel ?? periodos.data?.items[0]?.periodo ?? "";
  const listaHabilitada = !!session && hidratado && (periodoSel !== null || periodos.isSuccess || periodos.isError);

  const catalogos = useQuery({
    queryKey: ["claudia-egresos", empresa, "catalogos"],
    queryFn: () =>
      apiClient.get<CatalogosResponse>(`/claudia/egresos/catalogos?empresa=${empresa}`, session),
    enabled: !!session && hidratado,
    staleTime: 5 * 60_000,
  });

  const resumen = useQuery({
    queryKey: ["claudia-egresos", empresa, "resumen", periodo],
    queryFn: () =>
      apiClient.get<ResumenResponse>(
        `/claudia/egresos/resumen?empresa=${empresa}&periodo=${periodo}`,
        session,
      ),
    enabled: listaHabilitada && periodo !== "",
    staleTime: 60_000,
  });

  const lista = useQuery({
    queryKey: ["claudia-egresos", empresa, "lista", periodo, qDebounced, estadoFiltro, repartoFiltro],
    queryFn: () => {
      const p = new URLSearchParams({ empresa });
      if (periodo) p.set("periodo", periodo);
      if (qDebounced) p.set("q", qDebounced);
      if (estadoFiltro) p.set("estado_pago", estadoFiltro);
      if (repartoFiltro) p.set("reparto_estado", repartoFiltro);
      return apiClient.get<EgresosListResponse>(`/claudia/egresos?${p.toString()}`, session);
    },
    enabled: listaHabilitada,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  const items = useMemo(() => lista.data?.items ?? [], [lista.data]);
  const hayFiltros = qDebounced !== "" || estadoFiltro !== "" || repartoFiltro !== "";

  const mostrarTrewaox = useMemo(() => {
    const r = decimalACentavos(resumen.data?.por_fuente.trewaox) ?? 0;
    if (r > 0) return true;
    return items.some((i) => (decimalACentavos(i.reparto?.trewaox) ?? 0) > 0);
  }, [resumen.data, items]);

  const kpis = useMemo(() => {
    if (periodo) return resumen.data ? kpisDesdeResumen(resumen.data) : null;
    return lista.data ? kpisDesdeItems(lista.data.items) : null;
  }, [periodo, resumen.data, lista.data]);
  const kpisCargando = periodo ? resumen.isLoading : lista.isLoading;
  const mesVacio = lista.isSuccess && items.length === 0 && !hayFiltros;

  // ── Mutaciones ─────────────────────────────────────────────────────────

  const invalidarTodo = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["claudia-egresos", empresa] }),
    [queryClient, empresa],
  );

  const actualizar = useCallback(
    async (id: number, patch: EgresoUpdate): Promise<EgresoRead> => {
      const nuevo = await apiClient.put<EgresoRead>(`/claudia/egresos/${id}`, patch, session);
      // La fila se actualiza en caché al toque (sin parpadeo) y después se
      // refresca todo: la fecha pudo cambiar de mes y los KPIs de valor.
      queryClient.setQueriesData<EgresosListResponse>(
        { queryKey: ["claudia-egresos", empresa, "lista"] },
        (old) => (old ? { ...old, items: old.items.map((i) => (i.egreso_id === id ? nuevo : i)) } : old),
      );
      void invalidarTodo();
      return nuevo;
    },
    [session, queryClient, empresa, invalidarTodo],
  );

  const crear = useCallback(
    async (fila: EgresoCreateFila): Promise<EgresoRead> => {
      const body: EgresoCreate = { ...fila, empresa_codigo: empresa, origen: fila.origen ?? "UI" };
      const creado = await apiClient.post<EgresoRead>("/claudia/egresos", body, session);
      await invalidarTodo();
      return creado;
    },
    [session, empresa, invalidarTodo],
  );

  const pegar = useCallback(
    async (filas: EgresoCreateFila[]) => {
      // `POST /batch` acepta 500 filas y es todo-o-nada por llamada. Con
      // más filas se manda un POST por lote, EN ORDEN (no en paralelo: si
      // el lote 2 falla no queremos que el 3 ya haya entrado). La garantía
      // pasa a ser por lote; el diálogo lo avisa antes de confirmar.
      const lotes = trocearLotes(filas);
      let creados = 0;
      try {
        for (let i = 0; i < lotes.length; i++) {
          const lote = lotes[i]!;
          const body: BatchRequest = { empresa_codigo: empresa, filas: lote };
          try {
            const r = await apiClient.post<BatchResponse>("/claudia/egresos/batch", body, session);
            creados += r.n ?? lote.length;
          } catch (err) {
            if (lotes.length > 1 && err instanceof ApiError) {
              const desde = i * BATCH_MAX_FILAS + 1;
              const hasta = desde + lote.length - 1;
              throw new ApiError(
                err.status,
                `Falló el lote ${i + 1} de ${lotes.length} (filas ${desde} a ${hasta} de lo pegado; ` +
                  `"Fila N" abajo cuenta desde el inicio de ese lote). ` +
                  `Los ${creados} gastos de los lotes anteriores ya quedaron guardados · ${err.detail}`,
              );
            }
            throw err;
          }
        }
      } finally {
        // Lo que sí entró tiene que verse aunque un lote posterior fallara.
        if (creados > 0) await invalidarTodo();
      }
    },
    [session, empresa, invalidarTodo],
  );

  const eliminar = useCallback(
    async (id: number, motivo: string) => {
      await apiClient.delete<DeleteResponse>(`/claudia/egresos/${id}`, session, { motivo });
      toast.success("Gasto eliminado", { description: "Sigue en el historial con tu motivo." });
      await invalidarTodo();
    },
    [session, invalidarTodo],
  );

  const duplicar = useCallback(
    async (e: EgresoRead) => {
      // Si neto + impuesto no cuadran (filas importadas del Excel), mandar
      // los tres daría 422. Se manda sólo el total: la API pone neto =
      // total e impuesto 0, y el toast lo dice para que no pase callado.
      const cuadra = e.neto_mas_impuesto_cuadra;
      const body: EgresoCreate = {
        empresa_codigo: e.empresa_codigo,
        fecha: hoyIso(),
        descripcion: e.descripcion,
        rut_emisor: e.rut_emisor,
        tipo_documento: e.tipo_documento,
        folio: null,
        ...(cuadra ? { monto_neto: e.monto_neto, impuesto: e.impuesto } : {}),
        total: e.total,
        tipo_egreso: e.tipo_egreso,
        fuente: e.fuente,
        proyecto: e.proyecto,
        estado_pago: "PENDIENTE",
        fecha_pago: null,
        reparto: e.reparto_estado === "OK" ? e.reparto : null,
        corfo: {
          cuenta: e.corfo.cuenta,
          item: e.corfo.item,
          fuente_financiamiento: e.corfo.fuente_financiamiento,
          etapa: e.corfo.etapa,
          forma_pago: e.corfo.forma_pago,
        },
        observaciones: e.observaciones,
        origen: "UI",
      };
      const creado = await apiClient.post<EgresoRead>("/claudia/egresos", body, session);
      toast.success("Gasto duplicado con fecha de hoy", {
        description: cuadra
          ? creado.descripcion
          : `${creado.descripcion} · el neto y el impuesto del original no sumaban el total: en la copia se normalizaron (neto = total, impuesto $0).`,
      });
      await invalidarTodo();
      setPeriodoSel(creado.periodo);
      setSeleccionado(creado.egreso_id);
    },
    [session, invalidarTodo],
  );

  async function exportar() {
    if (!session) return;
    setExportando(true);
    try {
      const p = new URLSearchParams({ empresa });
      if (periodo) p.set("periodo", periodo);
      const res = await fetch(`${API_BASE}/claudia/egresos/exportar.xlsx?${p.toString()}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = (await res.json()) as { detail?: unknown };
          if (typeof body.detail === "string") msg = body.detail;
        } catch {
          // sin cuerpo JSON
        }
        throw new ApiError(res.status, msg);
      }
      const cd = res.headers.get("content-disposition") ?? "";
      const m = /filename="?([^";]+)"?/.exec(cd);
      const filename = m?.[1] ?? `registro_egresos_${empresa}_${periodo || "todos"}.xlsx`;
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("Excel descargado", {
        description: "Dos hojas: Registro de Egresos y Carga_Gastos (formato oficial CORFO).",
      });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "No se pudo exportar");
    } finally {
      setExportando(false);
    }
  }

  function cambiarEmpresa(e: CorfoEmpresa) {
    if (e === empresa) return;
    setEmpresa(e);
    setPeriodoSel(null);
    setSeleccionado(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const periodoLabel = periodo ? formatearPeriodo(periodo) : "todos los meses";
  const errorLista = lista.error instanceof Error ? lista.error : null;
  const esProhibido = lista.error instanceof ApiError && lista.error.status === 403;

  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <Link
        href={"/claudia" as Route}
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} />
        Mi workspace
      </Link>

      <PageHeader
        eyebrow="ClaudIA · CORFO 2026"
        icon={Table2}
        title="Registro de egresos"
        description="Tu planilla de gastos, mes a mes: grilla editable como Excel, ficha completa por gasto con las columnas oficiales CORFO, reparto por fuente e historial de cada cambio."
        compact
        trailing={
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="inline-flex rounded-xl bg-surface-muted p-0.5 ring-1 ring-hairline"
              role="radiogroup"
              aria-label="Empresa"
            >
              {CORFO_EMPRESAS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="radio"
                  aria-checked={empresa === e}
                  onClick={() => cambiarEmpresa(e)}
                  className={cn(
                    "rounded-[10px] px-3.5 py-1.5 text-sm font-semibold transition-all duration-150 ease-apple focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                    empresa === e ? "bg-white text-ink-900 shadow-card" : "text-ink-500 hover:text-ink-900",
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green"
            >
              <Upload className="size-4" strokeWidth={1.75} />
              Importar Excel
            </button>
            <button
              type="button"
              onClick={() => void exportar()}
              disabled={exportando || !session}
              title="Descarga el Excel con Registro de Egresos + Carga_Gastos"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors duration-150 hover:bg-ink-100/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green disabled:opacity-50"
            >
              {exportando ? <Loader2 className="size-4 animate-spin" strokeWidth={2} /> : <Download className="size-4" strokeWidth={1.75} />}
              Exportar
            </button>
            <button
              type="button"
              onClick={() => setFocoNuevo((n) => n + 1)}
              className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-3.5 py-2 text-sm font-semibold text-white shadow-card transition-colors duration-150 hover:bg-cehta-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2"
            >
              <Plus className="size-4" strokeWidth={2.25} />
              Nuevo gasto
            </button>
          </div>
        }
      />

      {esProhibido ? (
        <ErrorState
          title="Sección reservada"
          description={lista.error instanceof ApiError ? lista.error.detail : undefined}
        />
      ) : (
        <>
          <PeriodoChips
            items={periodos.data?.items ?? []}
            value={periodo}
            onChange={(p) => {
              setPeriodoSel(p);
              setSeleccionado(null);
            }}
            loading={periodos.isLoading || !hidratado}
            nTotal={periodos.data?.n_total ?? 0}
            totalGeneral={periodos.data?.total_general ?? "0"}
          />

          {!mesVacio && (
            <EgresosKpis data={kpis} loading={kpisCargando} mostrarTrewaox={mostrarTrewaox} />
          )}

          <div className="flex flex-wrap items-center gap-2">
            <label className="relative flex-1 min-w-[14rem]">
              <span className="sr-only">Buscar por descripción, RUT o folio</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-500" strokeWidth={1.75} />
              <input
                type="search"
                value={q}
                maxLength={LARGO_MAX.busqueda}
                onChange={(e) => setQ(e.target.value.slice(0, LARGO_MAX.busqueda))}
                placeholder="Buscar descripción, RUT o folio…"
                className="h-9 w-full rounded-xl bg-white pl-9 pr-3 text-sm text-ink-900 ring-1 ring-hairline transition-shadow duration-150 placeholder:text-ink-500 focus:outline-none focus:ring-2 focus:ring-cehta-green"
              />
            </label>
            <select
              value={estadoFiltro}
              onChange={(e) => setEstadoFiltro(e.target.value)}
              aria-label="Filtrar por estado de pago"
              className="h-9 rounded-xl bg-white px-3 text-sm text-ink-700 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              <option value="">Todos los estados</option>
              <option value="PAGADO">Pagados</option>
              <option value="PARCIAL">Pago parcial</option>
              <option value="PENDIENTE">Pendientes</option>
            </select>
            <select
              value={repartoFiltro}
              onChange={(e) => setRepartoFiltro(e.target.value)}
              aria-label="Filtrar por estado del reparto"
              className="h-9 rounded-xl bg-white px-3 text-sm text-ink-700 ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
            >
              <option value="">Todo el reparto</option>
              <option value="OK">Reparto OK</option>
              <option value="SIN_CLASIFICAR">Sin clasificar</option>
              <option value="DESCUADRADO">Descuadrados</option>
            </select>
            {lista.data && (
              <span className="text-xs tabular-nums text-ink-500">
                {lista.data.n} {lista.data.n === 1 ? "gasto" : "gastos"}
                {lista.data.truncado && (
                  <span
                    className="ml-1 inline-flex items-center gap-1.5 text-ink-700"
                    title="La API devuelve hasta 2000 filas; filtrá por mes o buscá para ver el resto."
                  >
                    · <span className="inline-block size-1.5 rounded-full bg-warning" aria-hidden />
                    lista recortada
                  </span>
                )}
              </span>
            )}
          </div>

          {errorLista && !lista.data ? (
            <ErrorState
              title="No se pudo cargar el registro"
              error={errorLista}
              onRetry={() => void lista.refetch()}
            />
          ) : (
            <EgresosGrid
              items={items}
              loading={!hidratado || (lista.isLoading && !lista.data)}
              empresa={empresa}
              periodo={periodo}
              catalogos={catalogos.data}
              mostrarTrewaox={mostrarTrewaox}
              onAbrir={setSeleccionado}
              onActualizar={actualizar}
              onCrear={crear}
              onPegar={pegar}
              focoNuevo={focoNuevo}
              vacio={
                hayFiltros ? (
                  <EmptyState
                    icon={Search}
                    title="Ningún gasto coincide"
                    description={`Con esos filtros no hay gastos en ${periodoLabel} para ${empresa}.`}
                    padding="compact"
                    className="rounded-none shadow-none ring-0"
                    primaryAction={{
                      label: "Limpiar filtros",
                      onClick: () => {
                        setQ("");
                        setEstadoFiltro("");
                        setRepartoFiltro("");
                      },
                    }}
                  />
                ) : (
                  <EmptyState
                    icon={Table2}
                    tone="info"
                    title={`Todavía no hay gastos en ${periodoLabel} para ${empresa}`}
                    description="No es un error: el mes está vacío. Escribí en la fila de abajo, pegá filas desde tu Excel (Ctrl+V) o importá la planilla completa."
                    padding="compact"
                    className="rounded-none shadow-none ring-0"
                    primaryAction={{ label: "Cargar el primer gasto", onClick: () => setFocoNuevo((n) => n + 1) }}
                    secondaryAction={{ label: "Importar Excel", onClick: () => setImportOpen(true) }}
                  />
                )
              }
            />
          )}
        </>
      )}

      <EgresoSheet
        egresoId={seleccionado}
        onClose={() => setSeleccionado(null)}
        catalogos={catalogos.data}
        mostrarTrewaox={mostrarTrewaox}
        onActualizar={actualizar}
        onEliminar={eliminar}
        onDuplicar={duplicar}
      />

      <ImportarExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        empresa={empresa}
        onImportado={(r) => {
          if (esCorfoEmpresa(r.empresa_codigo)) cambiarEmpresa(r.empresa_codigo);
          void queryClient.invalidateQueries({ queryKey: ["claudia-egresos"] });
        }}
      />
    </div>
  );
}
