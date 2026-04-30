"use client";

/**
 * Agente Secretaria — V4 fase 6.
 *
 * Componente que vive abajo del calendario en `/calendario` (y opcionalmente
 * en `/entregables`). Lista los entregables que vencen en los **próximos 60
 * días**, ordenados por fecha asc, agrupados por mes, con la información
 * detallada que cada uno debe contener para entregarse correctamente.
 *
 * Caso de uso: la secretaria/asistente abre la app cada lunes, mira el
 * panel y sabe exactamente qué tiene que preparar para los próximos 2
 * meses + qué información concretamente lleva cada documento.
 *
 * UI:
 * - Header con count "23 entregables en los próximos 60 días"
 * - Filter pills: Todos · Esta semana · Próx. 30 días · Próx. 60 días
 * - Tarjetas agrupadas por mes con expand para detalle
 * - Por cada entregable: información requerida + cómo prepararlo
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  Sparkles,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import {
  type EntregableRead,
  useEntregables,
  useUpdateEntregable,
} from "@/hooks/use-entregables";

type Rango = "semana" | "mes" | "dos_meses" | "tres_meses";

const RANGO_DIAS: Record<Rango, number> = {
  semana: 7,
  mes: 30,
  dos_meses: 60,
  tres_meses: 90,
};

const RANGO_LABEL: Record<Rango, string> = {
  semana: "Próx. 7 días",
  mes: "Próx. 30 días",
  dos_meses: "Próx. 60 días",
  tres_meses: "Próx. 90 días",
};

const MES_NOMBRES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

/**
 * Información requerida por cada tipo de entregable. Esto es la guía
 * operativa para la secretaria — qué tiene que tener cada documento.
 *
 * El match es por id_template (los del seed). Si no matchea, cae al
 * default genérico.
 */
const INFO_REQUERIDA: Record<string, string[]> = {
  cmf_trimestral: [
    "Listado actualizado de partícipes con RUT, nombre y monto invertido",
    "Valor activos y pasivos del Fondo en CLP al cierre del trimestre",
    "Denominación oficial del Fondo: 'FIP CEHTA ESG'",
    "Valorización de cuotas según IFRS",
    "Subir al portal CMF antes de las 23:59 del día hábil del plazo",
  ],
  cmf_inscripcion_vigente: [
    "Verificar inscripción N° 619 de AFIS S.A. en Registro Especial CMF",
    "Si vence: solicitar renovación con 30 días de anticipación",
    "Documentos: estatutos vigentes, certificado de vigencia AFIS",
  ],
  corfo_rendicion_semestral: [
    "Detalle de TODAS las inversiones del semestre",
    "Transferencias Fondo → empresa beneficiaria con montos y fechas",
    "Estado actual de cada empresa beneficiaria (CSL, RHO, DTE, REVTECH, EVOQUE, TRONGKAI)",
    "Comprobantes de transferencia bancaria",
    "Subir vía portal CORFO + correo a contraparte CORFO",
  ],
  corfo_balance_medio_ano: [
    "Balance provisorio del Fondo + AFIS S.A. al 30 de junio (S1) o 31 de diciembre (S2)",
    "No requiere auditoría externa, sí firma del contador",
    "Conciliación bancaria adjunta",
    "Estado de resultados acumulado del semestre",
  ],
  corfo_eeff_anuales: [
    "EEFF AUDITADOS por firma externa inscrita en CMF",
    "Balance General + Estado de Resultados + Estado de Cambios en Patrimonio + Flujo de Caja",
    "Notas a los EEFF firmadas por auditor",
    "Plazo: 180 días tras cierre = 30 junio del año siguiente",
    "Subir vía portal CORFO + entregar copia firmada física",
  ],
  corfo_evaluacion_bienal: [
    "Métricas de cumplimiento del Programa FT (cada 2 años)",
    "Indicadores ESG por empresa beneficiaria",
    "Empleos generados, inversión apalancada, sectores impactados",
    "Coordinar reunión con contraparte CORFO para presentación",
  ],
  corfo_pago_comision_mensual: [
    "Cálculo: 2.5% anual sobre (aportes + Línea CORFO) ÷ 12",
    "Más IVA 19%",
    "Pago vía cargo automático a Línea CORFO",
    "Confirmar el cargo dentro de los 5 primeros días hábiles del mes",
  ],
  uaf_roe_trimestral: [
    "Reporte de Operaciones en Efectivo > UF 450",
    "Listado de operaciones sospechosas (si aplica)",
    "Si no hubo operaciones: enviar reporte negativo con la firma del oficial de cumplimiento",
    "Subir vía portal UAF",
  ],
  ifrs_valorizacion_mensual: [
    "Valorización de cada empresa del portafolio según criterios IFRS 13",
    "Si tiene valor de mercado: usar precio observable",
    "Si no tiene mercado: aplicar metodología DCF / múltiplos comparables",
    "Documentar supuestos y referencias usadas",
    "Disponible en oficinas para aportantes (papel firmado por gerencia)",
  ],
  auditoria_eeff_anual: [
    "Coordinar con auditores externos (Deloitte/PwC/EY/KPMG según contrato)",
    "Entregar a auditores: balance, libros contables, conciliaciones, contratos",
    "Plazo: 15 días antes de Asamblea Ordinaria (15 abril)",
    "Cartas de gerencia, representaciones, confirmaciones bancarias",
  ],
  auditoria_designacion_anual: [
    "Comité de Vigilancia propone terna de auditores",
    "Asamblea Ordinaria aprueba la designación",
    "Carta de aceptación firmada por el auditor designado",
    "Subir designación a CMF",
  ],
  asamblea_ordinaria_anual: [
    "Citación con 15 días de anticipación (formal, vía notarial)",
    "Tabla: aprobación EEFF, elección Comité Vigilancia, designación auditores, cuenta gestión",
    "Acta firmada por presidente y secretario",
    "Lista de asistencia con quórum (mínimo según reglamento)",
    "Acuerdos protocolizados ante notario",
  ],
  comite_vigilancia_sesion_mensual: [
    "Mínimo 1 sesión al mes — quórum: unanimidad de los 3 miembros titulares",
    "Tabla: revisión de inversiones, riesgos, cumplimiento normativo",
    "Acta firmada por todos los presentes",
    "Archivar en libro de actas del Fondo",
  ],
  comite_inversiones_sesion_trimestral: [
    "Mínimo cada 3 meses durante los primeros 3 años del Fondo",
    "5 miembros, quórum por mayoría",
    "Tabla: aprobación de inversiones, desinversiones, política de inversión",
    "Acta firmada con detalle de votación por miembro",
  ],
  informe_cartera_mensual: [
    "Detalle de cada inversión del Fondo al cierre del mes",
    "Por cada empresa: monto invertido, % de participación, valorización IFRS, estado operacional",
    "Disponible en oficina para aportantes (papel firmado)",
  ],
  informe_anual_aportantes: [
    "EEFF del ejercicio anual",
    "Memoria Anual del Fondo (gestión, contexto, hitos)",
    "Detalle de gastos del Fondo durante el año",
    "Distribución de comisiones cobradas",
    "Enviar por correo a cada aportante registrado",
  ],
  memoria_anual_fondo: [
    "Hitos del año: nuevas inversiones, desinversiones, eventos relevantes",
    "Contexto macro y sectorial (renovables, sostenibilidad)",
    "Fotos / gráficos / proyecciones",
    "Disponible 15 días antes de Asamblea Ordinaria",
    "Edición y diseño profesional (PDF + impresa para Asamblea)",
  ],
  // ─── Templates de la migración 0023 ──────────────────────────────────
  sii_f22_anual: [
    "F22 Operación Renta para AFIS S.A.",
    "F22 individual para cada empresa del portafolio (CSL, RHO, DTE, REVTECH, EVOQUE, TRONGKAI)",
    "Plazo: 30 abril",
    "Si hay impuestos a pagar: coordinar transferencia con tesorería",
  ],
  sii_dj_personas_relacionadas: [
    "DJ 1907: operaciones con partes relacionadas (Chile y exterior)",
    "Listado: nombre + RUT/TIN + país + tipo operación + monto + precio transferencia",
    "Plazo: junio (típicamente último día hábil)",
    "Si superan UTAs definidas: análisis de precios de transferencia",
  ],
  sii_ppm_mensual: [
    "Tasa PPM aplicada al ingreso del mes",
    "Se incluye en el F29 mensual junto al IVA",
    "Plazo: día 12 del mes siguiente",
  ],
  sii_iva_mensual: [
    "IVA débito: facturas emitidas en el mes",
    "IVA crédito: facturas recibidas en el mes",
    "Diferencia: a pagar (débito > crédito) o a remanente (crédito > débito)",
    "Se declara en F29 mensual día 12",
  ],
  citacion_asamblea_ordinaria: [
    "Carta notarial con 15 días corridos de anticipación",
    "Detalle de tabla de la Asamblea",
    "Lugar, fecha, hora exactos",
    "Adjuntos: EEFF auditados + Memoria Anual",
    "Enviar a TODOS los aportantes por carta certificada o vía registrada",
  ],
  cuenta_gestion_anual: [
    "Cuenta razonada de la gestión del año",
    "Decisiones de inversión tomadas durante el período",
    "Resultados frente a presupuesto y mandato del Fondo",
    "Análisis de riesgos materializados y mitigados",
    "Presentar oralmente en la Asamblea + entregar copia escrita",
  ],
  politica_inversion_revision_anual: [
    "Comité de Inversiones revisa la política vigente",
    "Considera: cambios de mercado, nuevas oportunidades sectoriales, performance del portfolio",
    "Si hay cambios materiales: actualizar Reglamento Interno (requiere Asamblea Extraordinaria)",
    "Acta del Comité documentando la revisión",
  ],
  reporte_esg_anual: [
    "Métricas ambientales por empresa: emisiones, agua, residuos",
    "Métricas sociales: empleos creados, género, inclusión, salud y seguridad",
    "Métricas de gobernanza: independencia directorios, ética, transparencia",
    "KPIs vs benchmarks GRI / SASB",
    "Diseño profesional para inversionistas LP",
  ],
  registro_participes_mensual: [
    "Listado actualizado de partícipes (RUT, nombre, monto invertido, % cuotas)",
    "Cambios del mes: ingresos, rescates, transferencias",
    "Conciliación con cuentas bancarias del Fondo",
    "Disponible en oficina para Comité Vigilancia",
  ],
  comision_administracion_calculo: [
    "Cálculo: activos netos del Fondo × 2.5% ÷ 12",
    "+ IVA 19%",
    "Factura emitida por AFIS S.A. al Fondo",
    "Documentación archivada para auditoría",
  ],
  uaf_capacitacion_anual: [
    "Capacitación obligatoria sobre LA/FT (mínimo 8 horas)",
    "Personal: oficial de cumplimiento + todos los empleados",
    "Constancia firmada de asistencia",
    "Material de capacitación archivado",
  ],
  uaf_revision_politica_la_ft: [
    "Revisar Manual de Prevención de LA/FT",
    "Aprobación por Directorio AFIS",
    "Si hay cambios: comunicar a UAF",
    "Acta del Directorio adjunta",
  ],
  cierre_ejercicio_anual: [
    "Inventario de activos al 31 dic",
    "Conciliaciones bancarias finales",
    "Ajustes de cierre (provisiones, devengamientos)",
    "Libros contables impresos y firmados",
  ],
  inventario_activos_anual: [
    "Listado de inversiones, cuotas, derechos sociales",
    "Valor IFRS de cada activo al 31 dic",
    "Documentación de respaldo (escrituras, contratos, certificados)",
    "Insumo para EEFF auditados",
  ],
  reporte_litigios_anual: [
    "Listado de litigios activos del Fondo",
    "Litigios de empresas beneficiarias (que afecten al Fondo)",
    "Estimación de contingencias",
    "Carta de abogados externos confirmando los litigios",
    "Insumo para nota a EEFF",
  ],
  informe_avance_empresas_beneficiarias_trimestral: [
    "Por cada empresa beneficiaria: KPIs operativos del trimestre",
    "Avance vs plan de negocios original",
    "Hitos cumplidos / atrasados",
    "Riesgos materializados",
    "Insumo para Comité Vigilancia + reportes CORFO",
  ],
  informacion_comisiones_aportantes_mensual: [
    "Detalle mensual de comisiones cobradas",
    "Disponible en oficina para aportantes",
    "Carpeta física firmada por gerencia",
  ],
  comite_vigilancia_informe_anual: [
    "Informe de gestión del Comité del año anterior",
    "Sesiones realizadas, asistencia, acuerdos",
    "Auditoría interna del cumplimiento normativo",
    "Presentar en Asamblea Ordinaria",
  ],
};

const INFO_DEFAULT = [
  "Revisar el artículo de Reglamento Interno citado en la referencia",
  "Coordinar con el responsable indicado",
  "Archivar copia firmada del documento entregado",
  "Subir el adjunto a la plataforma desde el detalle del entregable",
];

interface Props {
  /** Si se pasa, filtra a una sola empresa. Default: todas. */
  empresaCodigo?: string;
}

export function AgenteSecretaria({ empresaCodigo }: Props) {
  const [rango, setRango] = useState<Rango>("dos_meses");
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const hoy = new Date();
  const hasta = new Date(hoy);
  hasta.setDate(hasta.getDate() + RANGO_DIAS[rango]);

  const desdeISO = hoy.toISOString().slice(0, 10);
  const hastaISO = hasta.toISOString().slice(0, 10);

  const { data: entregables = [], isLoading } = useEntregables({
    desde: desdeISO,
    hasta: hastaISO,
  });

  const updateMut = useUpdateEntregable();

  // Filtrar: solo no-entregados, opcionalmente por empresa, ordenar por fecha
  const filtered = useMemo(() => {
    return entregables
      .filter((e) => e.estado !== "entregado")
      .filter(
        (e) =>
          !empresaCodigo ||
          e.extra?.empresa_codigo === empresaCodigo ||
          e.subcategoria === empresaCodigo,
      )
      .sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite));
  }, [entregables, empresaCodigo]);

  // Agrupar por mes
  const agrupados = useMemo(() => {
    const map = new Map<string, EntregableRead[]>();
    for (const e of filtered) {
      const d = new Date(e.fecha_limite + "T00:00:00");
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const stats = useMemo(() => {
    let critico = 0;
    let urgente = 0;
    for (const e of filtered) {
      if (
        e.nivel_alerta === "vencido" ||
        e.nivel_alerta === "hoy" ||
        e.nivel_alerta === "critico"
      )
        critico++;
      else if (e.nivel_alerta === "urgente" || e.nivel_alerta === "proximo")
        urgente++;
    }
    return { total: filtered.length, critico, urgente };
  }, [filtered]);

  const handleMarcarEntregado = async (e: EntregableRead) => {
    if (!confirm(`¿Marcar "${e.nombre}" como entregado?`)) return;
    await updateMut.mutateAsync({
      id: e.entregable_id,
      body: {
        estado: "entregado",
        fecha_entrega_real: new Date().toISOString().slice(0, 10),
      },
    });
  };

  return (
    <Surface variant="glass" className="border border-cehta-green/30">
      <Surface.Header className="border-b border-hairline pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cehta-green/15 text-cehta-green">
              <Sparkles className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div>
              <Surface.Title>Agente Secretaria</Surface.Title>
              <Surface.Subtitle>
                Lo que hay que entregar próximamente · información que necesita
                cada documento
              </Surface.Subtitle>
            </div>
          </div>
          <div className="inline-flex rounded-xl bg-ink-100/50 p-0.5 ring-1 ring-hairline">
            {(["semana", "mes", "dos_meses", "tres_meses"] as Rango[]).map(
              (r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRango(r)}
                  className={`rounded-lg px-3 py-1 text-[11px] font-medium transition-all duration-150 ease-apple ${
                    rango === r
                      ? "bg-white text-ink-900 shadow-card/40"
                      : "text-ink-600 hover:bg-white/40"
                  }`}
                >
                  {RANGO_LABEL[r]}
                </button>
              ),
            )}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ink-100/60 px-2.5 py-1 font-medium text-ink-700">
            <CalendarClock className="h-3 w-3" strokeWidth={2} />
            {stats.total} entregable{stats.total !== 1 ? "s" : ""}
          </span>
          {stats.critico > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-negative/15 px-2.5 py-1 font-bold text-negative">
              <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
              {stats.critico} crítico{stats.critico !== 1 ? "s" : ""} (≤5 días)
            </span>
          )}
          {stats.urgente > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-2.5 py-1 font-medium text-warning">
              {stats.urgente} urgente{stats.urgente !== 1 ? "s" : ""} (≤15
              días)
            </span>
          )}
        </div>
      </Surface.Header>

      {/* Body */}
      <div className="mt-4">
        {isLoading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="rounded-xl border border-positive/20 bg-positive/5 p-4 text-center">
            <CheckCircle2
              className="mx-auto mb-2 h-8 w-8 text-positive"
              strokeWidth={1.5}
            />
            <p className="text-sm font-semibold text-positive">
              Sin entregables pendientes en {RANGO_LABEL[rango].toLowerCase()}
            </p>
            <p className="mt-1 text-xs text-ink-500">
              Buen trabajo. Volvé a chequear el lunes que viene.
            </p>
          </div>
        )}

        {!isLoading && filtered.length > 0 && (
          <div className="space-y-3">
            {agrupados.map(([mesKey, items]) => {
              const [year, month] = mesKey.split("-");
              const mesNombre =
                MES_NOMBRES[parseInt(month ?? "1") - 1] ?? "";
              return (
                <div key={mesKey}>
                  <p className="mb-2 px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-400">
                    {mesNombre} {year}
                  </p>
                  <div className="space-y-1.5">
                    {items.map((e) => (
                      <SecretariaRow
                        key={e.entregable_id}
                        entregable={e}
                        expanded={expandedId === e.entregable_id}
                        onToggle={() =>
                          setExpandedId(
                            expandedId === e.entregable_id
                              ? null
                              : e.entregable_id,
                          )
                        }
                        onMarcarEntregado={() => handleMarcarEntregado(e)}
                        isPending={updateMut.isPending}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Surface>
  );
}

function SecretariaRow({
  entregable: e,
  expanded,
  onToggle,
  onMarcarEntregado,
  isPending,
}: {
  entregable: EntregableRead;
  expanded: boolean;
  onToggle: () => void;
  onMarcarEntregado: () => void;
  isPending: boolean;
}) {
  const info = INFO_REQUERIDA[e.id_template] ?? INFO_DEFAULT;
  const dias = e.dias_restantes ?? 0;
  const isCritico =
    e.nivel_alerta === "vencido" ||
    e.nivel_alerta === "hoy" ||
    e.nivel_alerta === "critico";

  const fecha = new Date(e.fecha_limite + "T00:00:00").toLocaleDateString(
    "es-CL",
    { day: "2-digit", month: "short" },
  );

  return (
    <div
      className={`rounded-xl border transition-colors ${
        isCritico
          ? "border-negative/30 bg-negative/5"
          : "border-hairline bg-white"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-ink-50/40"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-400" strokeWidth={2} />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-400" strokeWidth={2} />
        )}
        <div className="flex shrink-0 flex-col items-center gap-0.5 rounded-lg bg-ink-50 px-2 py-1">
          <span className="text-[9px] font-bold uppercase text-ink-500">
            {fecha.split(" ")[1]}
          </span>
          <span
            className={`text-base font-bold tabular-nums ${
              isCritico ? "text-negative" : "text-ink-900"
            }`}
          >
            {fecha.split(" ")[0]}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-ink-100/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-700">
              {e.categoria}
            </span>
            <span
              className={`text-[11px] font-semibold ${
                isCritico
                  ? "text-negative"
                  : e.nivel_alerta === "urgente" ||
                      e.nivel_alerta === "proximo"
                    ? "text-warning"
                    : "text-ink-500"
              }`}
            >
              {dias < 0
                ? `Vencido ${Math.abs(dias)}d`
                : dias === 0
                  ? "HOY"
                  : `En ${dias} día${dias !== 1 ? "s" : ""}`}
            </span>
          </div>
          <p className="mt-0.5 line-clamp-1 text-sm font-medium text-ink-900">
            {e.nombre}
          </p>
          <p className="line-clamp-1 text-[11px] text-ink-500">
            {e.responsable} · {e.periodo}
          </p>
        </div>
      </button>

      {/* Detalle expandido — qué información debe contener */}
      {expanded && (
        <div className="border-t border-hairline bg-ink-50/30 px-4 py-3">
          {e.descripcion && (
            <p className="mb-3 text-xs italic text-ink-600">{e.descripcion}</p>
          )}
          <div className="mb-3">
            <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-cehta-green">
              <ClipboardCheck className="h-3 w-3" strokeWidth={2.5} />
              Información requerida
            </p>
            <ul className="space-y-1">
              {info.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 rounded bg-white px-2 py-1 text-xs text-ink-700"
                >
                  <span className="mt-0.5 inline-block h-1 w-1 shrink-0 rounded-full bg-cehta-green" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          {e.referencia_normativa && (
            <p className="mb-3 flex items-start gap-1.5 text-[10px] italic text-ink-400">
              <FileText
                className="mt-0.5 h-2.5 w-2.5 shrink-0"
                strokeWidth={1.75}
              />
              {e.referencia_normativa}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onMarcarEntregado}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-positive px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-positive/90 disabled:opacity-50"
            >
              <CheckCircle2 className="h-3 w-3" strokeWidth={2} />
              Marcar entregado
            </button>
            <a
              href={`/entregables`}
              className="text-xs font-medium text-cehta-green hover:underline"
            >
              Ver detalle completo →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
