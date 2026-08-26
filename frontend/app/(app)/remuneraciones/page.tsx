"use client";

/**
 * Remuneraciones — calcular liquidaciones chilenas y conciliarlas contra el
 * libro del contador.
 *
 * Cuatro subpestañas:
 *   1. Nómina del mes  — generar los borradores del período y ver totales,
 *      más la conciliación contra el libro de MCG si está subido.
 *   2. Calcular        — el formulario completo con el desglose en vivo.
 *   3. Parámetros      — los indicadores del período (UF, UTM, IMM, tasas).
 *      Si falta la UF o la UTM, el motor SE NIEGA a calcular y esta pestaña
 *      es donde se arregla.
 *   4. Guía y ejemplos — la teoría, con 5 ejemplos calculados EN VIVO por el
 *      mismo motor que calcula las liquidaciones reales.
 *
 * Mismo gate de acceso que RRHH: una liquidación es el dato más sensible de
 * la plataforma después de las claves.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BookOpenCheck,
  Calculator,
  CheckCircle2,
  Loader2,
  Play,
  Settings2,
  ShieldAlert,
  Users,
} from "lucide-react";

import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { toCLP } from "@/lib/format";
import { toast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";

// ─────────────────────────────────────────────────────────────────────
// Tipos (espejo de la API)
// ─────────────────────────────────────────────────────────────────────

interface Parametros {
  periodo: string;
  uf: string | null;
  utm: string | null;
  listo_para_calcular: boolean;
  ingreso_minimo: string;
  tope_imponible_uf: string;
  tope_afc_uf: string;
  jornada_horas: string;
  sis_pct: string;
  mutual_pct: string;
  reforma_cuenta_individual_pct: string;
  reforma_seguro_social_pct: string;
  comisiones_afp: Record<string, string>;
  notas: string | null;
}

interface Resultado {
  [k: string]: string | string[] | number;
  advertencias: string[];
}

interface LiquidacionItem {
  liquidacion_id: number;
  empleado_rut: string;
  empleado_nombre: string;
  estado: string;
  total_haberes: string;
  total_descuentos: string;
  liquido: string;
  costo_empresa: string;
}

interface Conciliacion {
  hay_libro: boolean;
  mensaje?: string;
  resumen?: {
    cuadran: number;
    difieren: number;
    solo_plataforma: number;
    solo_libro: number;
  };
  empleados: {
    empleado_rut: string;
    empleado_nombre: string;
    estado: string;
    diferencias: {
      campo: string;
      plataforma: string;
      libro: string;
      diferencia: string;
    }[];
  }[];
}

interface Ejemplo {
  titulo: string;
  explica: string;
  entrada: Record<string, string>;
  resultado: Resultado;
}

const inputBase =
  "w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:border-cehta-green focus:outline-none focus:ring-2 focus:ring-cehta-green/20";
const labelBase = "mb-1 block text-xs font-medium uppercase tracking-wide text-ink-500";

function periodoActual(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────────────────
// Página
// ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "nomina", label: "Nómina del mes", icon: Users },
  { id: "calcular", label: "Calcular", icon: Calculator },
  { id: "parametros", label: "Parámetros del mes", icon: Settings2 },
  { id: "guia", label: "Guía y ejemplos", icon: BookOpenCheck },
] as const;

export default function RemuneracionesPage() {
  const { session } = useSession();
  const { data: empresas = [] } = useCatalogoEmpresas();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("nomina");
  const [periodo, setPeriodo] = useState(periodoActual());
  const [empresa, setEmpresa] = useState("");

  const access = useQuery({
    queryKey: ["rrhh-access"],
    queryFn: () =>
      apiClient.get<{ allowed: boolean }>("/rrhh/access", session),
    enabled: !!session,
  });

  const params = useQuery({
    queryKey: ["remun-params", periodo],
    queryFn: () =>
      apiClient.get<Parametros>(
        `/remuneraciones/parametros?periodo=${periodo}`,
        session,
      ),
    enabled: !!session && access.data?.allowed === true,
  });

  if (access.data && !access.data.allowed) {
    return (
      <div className="mx-auto max-w-lg py-20 text-center">
        <ShieldAlert className="mx-auto h-10 w-10 text-ink-300" strokeWidth={1.25} />
        <h1 className="mt-4 text-xl font-semibold text-ink-900">
          Remuneraciones es restringido
        </h1>
        <p className="mt-2 text-sm text-ink-500">
          Usa el mismo acceso que el módulo RRHH. Pedile a un admin que te
          agregue a la lista.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Remuneraciones</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-500">
            Liquidaciones calculadas por la plataforma y conciliadas contra el
            libro del contador. El motor no adivina: si falta un indicador del
            mes, lo pide.
          </p>
        </div>
        <div className="flex items-end gap-3">
          <div>
            <label className={labelBase} htmlFor="remun-periodo">Período</label>
            <input
              id="remun-periodo"
              type="month"
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
              className={inputBase}
            />
          </div>
          <div>
            <label className={labelBase} htmlFor="remun-empresa">Empresa</label>
            <select
              id="remun-empresa"
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              className={inputBase}
            >
              <option value="">Elegir…</option>
              {empresas.map((e) => (
                <option key={e.codigo} value={e.codigo}>{e.codigo}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {params.data && !params.data.listo_para_calcular && (
        <button
          type="button"
          onClick={() => setTab("parametros")}
          className="flex w-full items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-left"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.75} />
          <span className="text-sm text-ink-700">
            <span className="font-medium text-warning">
              Falta cargar la UF o la UTM de {periodo}.
            </span>{" "}
            Sin esos indicadores el motor se niega a calcular — es la
            protección contra resultados con datos vencidos. Tocá acá para ir
            a Parámetros.
          </span>
        </button>
      )}

      <div className="flex gap-1 overflow-x-auto border-b border-hairline">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors ${
              tab === id
                ? "border-cehta-green text-cehta-green"
                : "border-transparent text-ink-500 hover:text-ink-900"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>

      {tab === "nomina" && (
        <TabNomina periodo={periodo} empresa={empresa} />
      )}
      {tab === "calcular" && <TabCalcular periodo={periodo} empresa={empresa} />}
      {tab === "parametros" && (
        <TabParametros periodo={periodo} params={params.data} recargar={() => params.refetch()} />
      )}
      {tab === "guia" && <TabGuia periodo={periodo} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 1 · Nómina del mes
// ─────────────────────────────────────────────────────────────────────

function TabNomina({ periodo, empresa }: { periodo: string; empresa: string }) {
  const { session } = useSession();
  const queryClient = useQueryClient();
  const [generando, setGenerando] = useState(false);

  const liqs = useQuery({
    queryKey: ["remun-liqs", empresa, periodo],
    queryFn: () =>
      apiClient.get<{ items: LiquidacionItem[]; totales: Record<string, string> }>(
        `/remuneraciones/liquidaciones?empresa_codigo=${empresa}&periodo=${periodo}`,
        session,
      ),
    enabled: !!session && !!empresa,
  });

  const conc = useQuery({
    queryKey: ["remun-conc", empresa, periodo],
    queryFn: () =>
      apiClient.get<Conciliacion>(
        `/remuneraciones/conciliacion?empresa_codigo=${empresa}&periodo=${periodo}`,
        session,
      ),
    enabled: !!session && !!empresa,
  });

  async function generar() {
    setGenerando(true);
    try {
      const r = await apiClient.post<{
        creadas: unknown[];
        saltadas: unknown[];
        pendientes: { empleado_nombre: string; motivos: string[] }[];
      }>("/remuneraciones/generar-mes", { empresa_codigo: empresa, periodo }, session);
      const creadas = r.creadas.length;
      const pend = r.pendientes.length;
      toast.success(
        `${creadas} liquidación(es) generadas como borrador` +
          (pend ? ` · ${pend} pendientes por datos faltantes` : ""),
      );
      if (pend) {
        for (const p of r.pendientes.slice(0, 3)) {
          toast.error(`${p.empleado_nombre}: ${p.motivos[0]}`);
        }
      }
      await queryClient.invalidateQueries({ queryKey: ["remun-liqs"] });
      await queryClient.invalidateQueries({ queryKey: ["remun-conc"] });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "No se pudo generar");
    } finally {
      setGenerando(false);
    }
  }

  if (!empresa) {
    return (
      <p className="py-10 text-center text-sm text-ink-500">
        Elegí una empresa arriba para ver su nómina.
      </p>
    );
  }

  const items = liqs.data?.items ?? [];
  const resumen = conc.data?.resumen;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-500">
          {items.length
            ? `${items.length} liquidación(es) en ${periodo}`
            : "Sin liquidaciones para este período todavía."}
        </p>
        <button
          type="button"
          onClick={generar}
          disabled={generando}
          className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
        >
          {generando ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
          ) : (
            <Play className="h-4 w-4" strokeWidth={1.75} />
          )}
          Generar borradores del mes
        </button>
      </div>

      {liqs.isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : items.length > 0 ? (
        <div className="overflow-x-auto rounded-2xl border border-hairline">
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-2.5 text-left">Empleado</th>
                <th className="px-4 py-2.5 text-left">Estado</th>
                <th className="px-4 py-2.5 text-right">Haberes</th>
                <th className="px-4 py-2.5 text-right">Descuentos</th>
                <th className="px-4 py-2.5 text-right">Líquido</th>
                <th className="px-4 py-2.5 text-right">Costo empresa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {items.map((l) => (
                <tr key={l.liquidacion_id}>
                  <td className="px-4 py-2.5 text-ink-900">{l.empleado_nombre}</td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded-lg px-2 py-0.5 text-xs font-medium ${
                        l.estado === "CONFIRMADA"
                          ? "bg-cehta-green/10 text-cehta-green"
                          : "bg-surface-muted text-ink-500"
                      }`}
                    >
                      {l.estado}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{toCLP(l.total_haberes)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{toCLP(l.total_descuentos)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-ink-900">
                    {toCLP(l.liquido)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{toCLP(l.costo_empresa)}</td>
                </tr>
              ))}
            </tbody>
            {liqs.data?.totales && (
              <tfoot className="border-t border-hairline bg-surface-muted font-medium">
                <tr>
                  <td className="px-4 py-2.5" colSpan={2}>Totales</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {toCLP(liqs.data.totales.haberes)}
                  </td>
                  <td />
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {toCLP(liqs.data.totales.liquido)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {toCLP(liqs.data.totales.costo_empresa)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      ) : null}

      {/* Conciliación contra el libro del contador */}
      <div className="rounded-2xl border border-hairline p-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900">
          <BookOpenCheck className="h-4 w-4 text-cehta-green" strokeWidth={1.75} />
          Conciliación contra el libro del contador
        </h3>
        {conc.isLoading ? (
          <Skeleton className="mt-3 h-16 w-full" />
        ) : !conc.data?.hay_libro ? (
          <p className="mt-2 text-sm text-ink-500">{conc.data?.mensaje}</p>
        ) : (
          <div className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-lg bg-cehta-green/10 px-2.5 py-1 font-medium text-cehta-green">
                {resumen?.cuadran ?? 0} cuadran
              </span>
              <span className="rounded-lg bg-warning/10 px-2.5 py-1 font-medium text-warning">
                {resumen?.difieren ?? 0} difieren
              </span>
              <span className="rounded-lg bg-surface-muted px-2.5 py-1 text-ink-500">
                {resumen?.solo_plataforma ?? 0} sólo en plataforma ·{" "}
                {resumen?.solo_libro ?? 0} sólo en libro
              </span>
            </div>
            {conc.data.empleados
              .filter((e) => e.diferencias.length > 0)
              .map((e) => (
                <div key={e.empleado_rut} className="rounded-xl border border-warning/30 bg-warning/5 p-3">
                  <p className="text-sm font-medium text-ink-900">{e.empleado_nombre}</p>
                  <table className="mt-2 w-full text-xs">
                    <thead className="text-ink-500">
                      <tr>
                        <th className="text-left py-1">Campo</th>
                        <th className="text-right py-1">Plataforma</th>
                        <th className="text-right py-1">Libro MCG</th>
                        <th className="text-right py-1">Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.diferencias.map((d) => (
                        <tr key={d.campo}>
                          <td className="py-0.5">{d.campo}</td>
                          <td className="py-0.5 text-right tabular-nums">{toCLP(d.plataforma)}</td>
                          <td className="py-0.5 text-right tabular-nums">{toCLP(d.libro)}</td>
                          <td className="py-0.5 text-right font-medium tabular-nums text-warning">
                            {toCLP(d.diferencia)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-1.5 text-xs text-ink-500">
                    Una diferencia suele ser la AFP o el plan Isapre del
                    empleado: ajustala en Calcular y volvé a guardar.
                  </p>
                </div>
              ))}
            {resumen && resumen.difieren === 0 && resumen.cuadran > 0 && (
              <p className="flex items-center gap-1.5 text-sm text-cehta-green">
                <CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />
                Todo lo comparable cuadra con el contador.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 2 · Calcular
// ─────────────────────────────────────────────────────────────────────

const ENTRADA_INICIAL = {
  sueldo_base: "",
  dias_trabajados: "30",
  horas_extra: "0",
  comisiones: "0",
  bonos_imponibles: "0",
  gratificacion_tipo: "ART50_TOPE",
  gratificacion_monto_fijo: "0",
  colacion: "0",
  movilizacion: "0",
  cargas_familiares: "0",
  afp: "",
  salud_sistema: "FONASA",
  isapre_plan_uf: "0",
  tipo_contrato: "INDEFINIDO",
  apv_mensual: "0",
  anticipos: "0",
  otros_descuentos: "0",
  mutual_pct_override: "",
};

function TabCalcular({ periodo, empresa }: { periodo: string; empresa: string }) {
  const { session } = useSession();
  const [f, setF] = useState({ ...ENTRADA_INICIAL });
  const [rut, setRut] = useState("");
  const [nombre, setNombre] = useState("");
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const up = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  function entrada() {
    return {
      ...f,
      afp: f.afp || null,
      cargas_familiares: Number(f.cargas_familiares) || 0,
      mutual_pct_override: f.mutual_pct_override || null,
    };
  }

  async function calcular() {
    setOcupado(true);
    try {
      const r = await apiClient.post<{ resultado: Resultado }>(
        "/remuneraciones/calcular",
        { periodo, entrada: entrada() },
        session,
      );
      setResultado(r.resultado);
    } catch (err) {
      setResultado(null);
      toast.error(err instanceof ApiError ? err.detail : "No se pudo calcular");
    } finally {
      setOcupado(false);
    }
  }

  async function guardar() {
    if (!empresa || !rut.trim() || !nombre.trim()) {
      toast.error("Para guardar: elegí empresa arriba y completá RUT y nombre.");
      return;
    }
    setOcupado(true);
    try {
      await apiClient.post(
        "/remuneraciones/liquidaciones",
        {
          periodo,
          empresa_codigo: empresa,
          empleado_rut: rut.trim(),
          empleado_nombre: nombre.trim(),
          entrada: entrada(),
        },
        session,
      );
      toast.success(`Liquidación de ${nombre} guardada como borrador`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "No se pudo guardar");
    } finally {
      setOcupado(false);
    }
  }

  const num = (k: keyof typeof ENTRADA_INICIAL, label: string, extra?: string) => (
    <div>
      <label className={labelBase} htmlFor={`re-${k}`}>{label}</label>
      <input
        id={`re-${k}`}
        type="number"
        step="any"
        min="0"
        value={f[k]}
        onChange={(e) => up(k, e.target.value)}
        className={`${inputBase} tabular-nums`}
      />
      {extra && <p className="mt-1 text-xs text-ink-500">{extra}</p>}
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelBase} htmlFor="re-rut">RUT empleado</label>
            <input id="re-rut" value={rut} onChange={(e) => setRut(e.target.value)}
                   placeholder="12.345.678-9" className={inputBase} />
          </div>
          <div>
            <label className={labelBase} htmlFor="re-nombre">Nombre</label>
            <input id="re-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)}
                   placeholder="Para guardar la liquidación" className={inputBase} />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {num("sueldo_base", "Sueldo base")}
          {num("dias_trabajados", "Días trabajados")}
          {num("horas_extra", "Horas extra")}
          {num("comisiones", "Comisiones")}
          {num("bonos_imponibles", "Bonos imponibles")}
          <div>
            <label className={labelBase} htmlFor="re-grat">Gratificación</label>
            <select id="re-grat" value={f.gratificacion_tipo}
                    onChange={(e) => up("gratificacion_tipo", e.target.value)}
                    className={inputBase}>
              <option value="ART50_TOPE">Art. 50 (25 % con tope)</option>
              <option value="MONTO_FIJO">Convenida (monto fijo)</option>
              <option value="NINGUNA">Sin gratificación</option>
            </select>
          </div>
          {f.gratificacion_tipo === "MONTO_FIJO" &&
            num("gratificacion_monto_fijo", "Monto gratificación")}
          {num("colacion", "Colación")}
          {num("movilizacion", "Movilización")}
          {num("cargas_familiares", "Cargas familiares")}
          <div>
            <label className={labelBase} htmlFor="re-afp">AFP</label>
            <select id="re-afp" value={f.afp} onChange={(e) => up("afp", e.target.value)}
                    className={inputBase}>
              <option value="">Elegir…</option>
              {["CAPITAL", "CUPRUM", "HABITAT", "MODELO", "PLANVITAL", "PROVIDA", "UNO"].map(
                (a) => <option key={a} value={a}>{a}</option>,
              )}
            </select>
          </div>
          <div>
            <label className={labelBase} htmlFor="re-salud">Salud</label>
            <select id="re-salud" value={f.salud_sistema}
                    onChange={(e) => up("salud_sistema", e.target.value)}
                    className={inputBase}>
              <option value="FONASA">Fonasa (7 %)</option>
              <option value="ISAPRE">Isapre (plan UF)</option>
            </select>
          </div>
          {f.salud_sistema === "ISAPRE" && num("isapre_plan_uf", "Plan Isapre (UF)")}
          <div>
            <label className={labelBase} htmlFor="re-contrato">Contrato</label>
            <select id="re-contrato" value={f.tipo_contrato}
                    onChange={(e) => up("tipo_contrato", e.target.value)}
                    className={inputBase}>
              <option value="INDEFINIDO">Indefinido</option>
              <option value="PLAZO_FIJO">Plazo fijo</option>
            </select>
          </div>
          {num("apv_mensual", "APV mensual")}
          {num("anticipos", "Anticipos")}
          {num("otros_descuentos", "Otros descuentos")}
          {num("mutual_pct_override", "Mutual % (empresa)",
               "Vacío = usa el del período. AFIS paga 2,63 según su libro.")}
        </div>

        <div className="flex gap-3">
          <button type="button" onClick={calcular} disabled={ocupado || !f.sueldo_base}
                  className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700 disabled:opacity-60">
            {ocupado ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" strokeWidth={1.75} />}
            Calcular
          </button>
          <button type="button" onClick={guardar} disabled={ocupado || !resultado}
                  className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-4 py-2 text-sm font-medium text-ink-700 hover:border-cehta-green/40 hover:text-cehta-green disabled:opacity-50">
            Guardar como borrador
          </button>
        </div>
      </div>

      <div>
        {resultado ? (
          <Desglose r={resultado} />
        ) : (
          <p className="rounded-2xl border border-dashed border-hairline p-8 text-center text-sm text-ink-500">
            Completá el sueldo y apretá Calcular: el desglose aparece acá, con
            los mismos números que produciría la liquidación real.
          </p>
        )}
      </div>
    </div>
  );
}

function Fila({ label, valor, fuerte, negativo }: {
  label: string; valor: string; fuerte?: boolean; negativo?: boolean;
}) {
  if (!fuerte && (valor === "0" || valor === "0.00")) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 py-0.5 text-sm">
      <span className={fuerte ? "font-medium text-ink-900" : "text-ink-500"}>{label}</span>
      <span className={`tabular-nums ${fuerte ? "font-semibold text-ink-900" : negativo ? "text-negative" : "text-ink-900"}`}>
        {negativo ? "−" : ""}{toCLP(valor)}
      </span>
    </div>
  );
}

function Desglose({ r }: { r: Resultado }) {
  const s = (k: string) => String(r[k] ?? "0");
  return (
    <div className="space-y-3">
      {(r.advertencias as string[]).map((a) => (
        <p key={a} className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" strokeWidth={1.75} />
          {a}
        </p>
      ))}
      <div className="rounded-2xl border border-hairline p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Haberes</h4>
        <Fila label="Sueldo proporcional" valor={s("sueldo_proporcional")} />
        <Fila label="Horas extra" valor={s("horas_extra_monto")} />
        <Fila label="Comisiones" valor={s("comisiones")} />
        <Fila label="Bonos imponibles" valor={s("bonos_imponibles")} />
        <Fila label="Gratificación" valor={s("gratificacion")} />
        <Fila label="Total imponible" valor={s("total_imponible")} fuerte />
        <Fila label="Colación" valor={s("colacion")} />
        <Fila label="Movilización" valor={s("movilizacion")} />
        <Fila label="Asignación familiar" valor={s("asignacion_familiar")} />
        <Fila label="Total haberes" valor={s("total_haberes")} fuerte />
      </div>
      <div className="rounded-2xl border border-hairline p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Descuentos del trabajador</h4>
        <Fila label="AFP 10 %" valor={s("afp_cotizacion")} negativo />
        <Fila label="Comisión AFP" valor={s("afp_comision")} negativo />
        <Fila label="Salud 7 %" valor={s("salud_legal")} negativo />
        <Fila label="Adicional Isapre" valor={s("salud_adicional_isapre")} negativo />
        <Fila label="Cesantía 0,6 %" valor={s("afc_trabajador")} negativo />
        <Fila label="APV" valor={s("apv")} negativo />
        <Fila label="Impuesto único" valor={s("impuesto_unico")} negativo />
        <Fila label="Anticipos" valor={s("anticipos")} negativo />
        <Fila label="Otros" valor={s("otros_descuentos")} negativo />
        <Fila label="Total descuentos" valor={s("total_descuentos")} fuerte />
        <div className="mt-2 border-t border-hairline pt-2">
          <Fila label="LÍQUIDO A PAGAR" valor={s("liquido")} fuerte />
        </div>
        <p className="mt-1 text-xs text-ink-500">
          Base tributable: {toCLP(s("base_tributable"))}
        </p>
      </div>
      <div className="rounded-2xl border border-hairline p-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-500">Aportes del empleador</h4>
        <Fila label="Cesantía empleador" valor={s("afc_empleador")} />
        <Fila label="SIS" valor={s("sis")} />
        <Fila label="Mutual" valor={s("mutual")} />
        <Fila label="Reforma: cuenta individual" valor={s("reforma_cuenta_individual")} />
        <Fila label="Reforma: seguro social" valor={s("reforma_seguro_social")} />
        <Fila label="Costo empresa total" valor={s("costo_empresa")} fuerte />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 3 · Parámetros del mes
// ─────────────────────────────────────────────────────────────────────

function TabParametros({ periodo, params, recargar }: {
  periodo: string;
  params: Parametros | undefined;
  recargar: () => void;
}) {
  const { session } = useSession();
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [guardando, setGuardando] = useState(false);

  if (!params) return <Skeleton className="h-64 w-full rounded-2xl" />;

  const v = (k: keyof Parametros) => edit[k] ?? (params[k] as string | null) ?? "";

  async function guardar() {
    setGuardando(true);
    try {
      const body: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(edit)) {
        if (val !== "") body[k] = val;
      }
      await apiClient.put(`/remuneraciones/parametros/${periodo}`, body, session);
      toast.success("Parámetros guardados");
      setEdit({});
      recargar();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.detail : "No se pudo guardar");
    } finally {
      setGuardando(false);
    }
  }

  const campo = (k: keyof Parametros, label: string, ayuda?: string) => (
    <div>
      <label className={labelBase} htmlFor={`pm-${k}`}>{label}</label>
      <input
        id={`pm-${k}`}
        type="number"
        step="any"
        value={v(k)}
        onChange={(e) => setEdit((p) => ({ ...p, [k]: e.target.value }))}
        className={`${inputBase} tabular-nums`}
      />
      {ayuda && <p className="mt-1 text-xs text-ink-500">{ayuda}</p>}
    </div>
  );

  return (
    <div className="max-w-3xl space-y-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {campo("uf", "UF del mes", "Último día del mes — sii.cl")}
        {campo("utm", "UTM del mes", "La publica el SII")}
        {campo("ingreso_minimo", "Ingreso mínimo", "Tope gratificación = 4,75×IMM/12")}
        {campo("tope_imponible_uf", "Tope imponible (UF)", "AFP y salud")}
        {campo("tope_afc_uf", "Tope cesantía (UF)")}
        {campo("jornada_horas", "Jornada semanal (h)", "42 desde abril 2026 — ley 21.561")}
        {campo("sis_pct", "SIS % (empleador)", "1,62 según libro MCG")}
        {campo("mutual_pct", "Mutual % base", "El adicional va por empresa al calcular")}
        {campo("reforma_cuenta_individual_pct", "Reforma: cta. individual %")}
        {campo("reforma_seguro_social_pct", "Reforma: seguro social %", "Ley 21.735 — sube por calendario")}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">
          Comisiones AFP (% — verificar en Previred, cambian por licitación)
        </h4>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.entries(params.comisiones_afp).map(([afp, pct]) => (
            <div key={afp}>
              <label className={labelBase} htmlFor={`afp-${afp}`}>{afp}</label>
              <input
                id={`afp-${afp}`}
                type="number"
                step="0.01"
                defaultValue={pct}
                onBlur={async (e) => {
                  if (e.target.value === pct) return;
                  try {
                    await apiClient.put(
                      `/remuneraciones/parametros/${periodo}`,
                      { comisiones_afp: { [afp]: e.target.value } },
                      session,
                    );
                    toast.success(`Comisión ${afp} actualizada`);
                    recargar();
                  } catch {
                    toast.error(`No se pudo guardar ${afp}`);
                  }
                }}
                className={`${inputBase} tabular-nums`}
              />
            </div>
          ))}
        </div>
      </div>

      {params.notas && (
        <p className="rounded-xl bg-surface-muted px-3 py-2 text-xs text-ink-500">
          {params.notas}
        </p>
      )}

      <button
        type="button"
        onClick={guardar}
        disabled={guardando || Object.keys(edit).length === 0}
        className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white hover:bg-cehta-green-700 disabled:opacity-60"
      >
        {guardando ? "Guardando…" : "Guardar parámetros"}
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// 4 · Guía y ejemplos
// ─────────────────────────────────────────────────────────────────────

const TEORIA: { titulo: string; texto: string }[] = [
  {
    titulo: "Haberes: imponibles y no imponibles",
    texto:
      "Imponibles (cotizan y tributan): sueldo, horas extra, comisiones, bonos y gratificación. No imponibles: colación, movilización, viáticos y asignación familiar. La gratificación Art. 50 es el 25 % de lo devengado con tope de 4,75 ingresos mínimos al año (por eso casi siempre aparece el mismo monto topado).",
  },
  {
    titulo: "Descuentos del trabajador",
    texto:
      "AFP: 10 % + la comisión de SU administradora (cambia por AFP — por eso hay que saber cuál es). Salud: 7 % en Fonasa o el plan pactado en UF si es Isapre. Cesantía: 0,6 % sólo con contrato indefinido. Sobre lo que queda (la base tributable) corre el impuesto único por tramos de UTM.",
  },
  {
    titulo: "Aportes del empleador (no salen del bolsillo del trabajador)",
    texto:
      "Cesantía 2,4 % (indefinido) o 3,0 % (plazo fijo, todo del empleador) · SIS · mutual de seguridad (base + adicional según la actividad de la empresa) · y desde la ley 21.735, el aporte de la reforma previsional que sube por calendario. Sueldo líquido ≠ costo empresa: la diferencia son estos aportes.",
  },
  {
    titulo: "Los topes",
    texto:
      "Las cotizaciones se calculan hasta 87,8 UF de renta imponible (la cesantía hasta 131,9 UF). El impuesto único no topa. Por eso en rentas altas el porcentaje efectivo de descuento BAJA: la parte sobre el tope no cotiza.",
  },
];

function TabGuia({ periodo }: { periodo: string }) {
  const { session } = useSession();
  const ej = useQuery({
    queryKey: ["remun-ejemplos", periodo],
    queryFn: () =>
      apiClient.get<{ parametros_ilustrativos: boolean; ejemplos: Ejemplo[] }>(
        `/remuneraciones/ejemplos?periodo=${periodo}`,
        session,
      ),
    enabled: !!session,
  });
  const [abierto, setAbierto] = useState(0);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        {TEORIA.map((t) => (
          <div key={t.titulo} className="rounded-2xl border border-hairline p-4">
            <h3 className="text-sm font-semibold text-ink-900">{t.titulo}</h3>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{t.texto}</p>
          </div>
        ))}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink-900">
          Los ejemplos, calculados por el motor real
        </h3>
        <p className="mt-1 text-sm text-ink-500">
          Estos números no son texto estático: los produce EN VIVO el mismo
          motor que calcula las liquidaciones. Si el motor cambia, los
          ejemplos cambian con él.
        </p>
        {ej.data?.parametros_ilustrativos && (
          <p className="mt-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-ink-700">
            El período {periodo} aún no tiene UF/UTM cargadas: los ejemplos
            usan valores ilustrativos redondos (UF 40.000 · UTM 70.000) para
            mostrar la mecánica.
          </p>
        )}
        {ej.isLoading ? (
          <Skeleton className="mt-3 h-40 w-full rounded-2xl" />
        ) : (
          <div className="mt-3 space-y-2">
            {(ej.data?.ejemplos ?? []).map((e, i) => (
              <div key={e.titulo} className="rounded-2xl border border-hairline">
                <button
                  type="button"
                  onClick={() => setAbierto(abierto === i ? -1 : i)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span className="text-sm font-medium text-ink-900">{e.titulo}</span>
                  <span className="text-sm tabular-nums text-cehta-green">
                    líquido {toCLP(String(e.resultado.liquido))}
                  </span>
                </button>
                {abierto === i && (
                  <div className="border-t border-hairline p-4">
                    <p className="mb-3 text-sm text-ink-500">{e.explica}</p>
                    <Desglose r={e.resultado} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
