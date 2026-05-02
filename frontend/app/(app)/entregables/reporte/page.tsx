"use client";

/**
 * Reporte Regulatorio Imprimible — V4 fase 6.
 *
 * Vista pensada para llevar directamente a actas del Comité de Vigilancia.
 * El layout (sidebar + header) ya tiene `print:hidden`, así que un Ctrl+P
 * directo del navegador devuelve un documento limpio listo para PDF.
 *
 * Secciones (en orden de prioridad para acta CV):
 *   1. Cabecera con identificación del Fondo + fecha de generación
 *   2. Resumen ejecutivo (4 KPIs grandes)
 *   3. Tasa de cumplimiento YTD con gauge visual
 *   4. Vencidos sin entregar (rojo, primero — necesita explicación en acta)
 *   5. Próximos 30 días (planning)
 *   6. Counts por estado (totales agregados)
 *   7. Pie de página con nota de compliance
 *
 * Compliance: nada de TIR/IRR, sin montos USD del portafolio. Solo
 * gobernanza y cumplimiento normativo.
 */
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileSignature,
  FileSpreadsheet,
  Printer,
  Sparkles,
} from "lucide-react";
import { useSession } from "@/hooks/use-session";
import { ActaGeneradoraDialog } from "@/components/entregables/ActaGeneradoraDialog";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { FileLink } from "@/components/shared/FileLink";
import {
  type EntregableRead,
  useReporteRegulatorio,
} from "@/hooks/use-entregables";

const CATEGORIA_BG: Record<string, string> = {
  CMF: "bg-purple-100 text-purple-800 print:bg-white print:text-purple-900",
  CORFO: "bg-cehta-green/15 text-cehta-green print:bg-white",
  UAF: "bg-red-100 text-red-800 print:bg-white",
  SII: "bg-orange-100 text-orange-800 print:bg-white",
  INTERNO: "bg-blue-100 text-blue-800 print:bg-white",
  AUDITORIA: "bg-gray-100 text-gray-800 print:bg-white",
  ASAMBLEA: "bg-yellow-100 text-yellow-800 print:bg-white",
  OPERACIONAL: "bg-emerald-100 text-emerald-800 print:bg-white",
};

function formatFecha(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function formatFechaCorta(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
  });
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("es-CL", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ReporteRegulatorioPage() {
  const { data, isLoading, isError, error } = useReporteRegulatorio();
  const { session } = useSession();
  const [actaOpen, setActaOpen] = useState(false);

  const downloadExcel = async () => {
    if (!session) return;
    const apiBase =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
    try {
      const res = await fetch(`${apiBase}/entregables/reporte-cv.xlsx`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `reporte-cv-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch {
      // Fallback silencioso — el botón "Imprimir" sigue disponible
    }
  };

  const tasaColor = useMemo(() => {
    if (!data) return "text-ink-500";
    if (data.tasa_cumplimiento_ytd >= 95) return "text-positive";
    if (data.tasa_cumplimiento_ytd >= 85) return "text-warning";
    return "text-negative";
  }, [data]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[920px] space-y-4 px-6 py-6">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="mx-auto max-w-[920px] px-6 py-6">
        <Surface padding="default">
          <p className="text-sm text-negative">
            Error cargando reporte: {error?.message ?? "desconocido"}
          </p>
        </Surface>
      </div>
    );
  }

  const { estados, proximos_30d, vencidos_sin_entregar, tasa_cumplimiento_ytd } =
    data;
  const totalEntregables =
    estados.pendiente +
    estados.en_proceso +
    estados.entregado +
    estados.no_entregado;

  return (
    <div className="mx-auto max-w-[920px] space-y-6 px-6 py-6 print:max-w-full print:px-0 print:py-0">
      {/* Toolbar — solo en pantalla, oculta al imprimir */}
      <div className="flex items-center justify-between gap-4 print:hidden">
        <a
          href="/entregables"
          className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-100/40"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.75} />
          Volver a entregables
        </a>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActaOpen(true)}
            title="Generar borrador de acta CV con AI"
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green/10 px-3 py-2 text-sm font-medium text-cehta-green ring-1 ring-cehta-green/30 transition-colors hover:bg-cehta-green/15"
          >
            <Sparkles className="h-4 w-4" strokeWidth={1.75} />
            Generar acta con AI
          </button>
          <button
            type="button"
            onClick={downloadExcel}
            className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-2 text-sm font-medium text-ink-700 transition-colors hover:bg-ink-50"
          >
            <FileSpreadsheet className="h-4 w-4" strokeWidth={1.75} />
            Excel multi-sheet
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700"
          >
            <Printer className="h-4 w-4" strokeWidth={1.75} />
            Imprimir / PDF
          </button>
        </div>
      </div>

      <ActaGeneradoraDialog open={actaOpen} onOpenChange={setActaOpen} />

      {/* Cabecera del documento */}
      <header className="space-y-2 border-b border-ink-300 pb-4 print:border-ink-900">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-500">
          Reporte Regulatorio · Comité de Vigilancia
        </p>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
          FIP CEHTA ESG
        </h1>
        <p className="text-sm text-ink-700">
          Administradora: <strong>AFIS S.A.</strong> · RUT 77.423.556-6 ·
          Inscripción CMF N° 619
        </p>
        <p className="text-xs text-ink-500">
          Documento generado el {formatDateTime(data.generado_at)}
        </p>
      </header>

      {/* Resumen ejecutivo — 4 KPIs */}
      <section className="grid grid-cols-2 gap-3 print:grid-cols-4 md:grid-cols-4">
        <KpiCard
          label="Total entregables"
          value={String(totalEntregables)}
          subtitle="Año en curso + próximos"
          icon={<CalendarClock className="h-4 w-4" strokeWidth={1.75} />}
        />
        <KpiCard
          label="Vencidos s/ entregar"
          value={String(vencidos_sin_entregar.length)}
          subtitle={
            vencidos_sin_entregar.length > 0
              ? "Requiere explicación"
              : "Sin pendientes"
          }
          icon={<AlertTriangle className="h-4 w-4" strokeWidth={1.75} />}
          tone={vencidos_sin_entregar.length > 0 ? "negative" : "positive"}
        />
        <KpiCard
          label="Próximos 30 días"
          value={String(proximos_30d.length)}
          subtitle="Pipeline corto"
          icon={<Clock className="h-4 w-4" strokeWidth={1.75} />}
          tone="info"
        />
        <KpiCard
          label="Tasa cumplimiento YTD"
          value={`${tasa_cumplimiento_ytd.toFixed(1)}%`}
          subtitle={`${data.entregados_ytd} de ${data.total_ytd} entregados a tiempo`}
          icon={<CheckCircle2 className="h-4 w-4" strokeWidth={1.75} />}
          tone={
            tasa_cumplimiento_ytd >= 95
              ? "positive"
              : tasa_cumplimiento_ytd >= 85
                ? "warning"
                : "negative"
          }
        />
      </section>

      {/* Gauge tasa cumplimiento */}
      <section className="rounded-2xl border border-hairline bg-white p-5 print:border-ink-300 print:rounded-none">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-500">
            Tasa de cumplimiento YTD
          </h2>
          <span className={`text-2xl font-bold tabular-nums ${tasaColor}`}>
            {tasa_cumplimiento_ytd.toFixed(1)}%
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-ink-100">
          <div
            className={`h-full transition-all ${
              tasa_cumplimiento_ytd >= 95
                ? "bg-positive"
                : tasa_cumplimiento_ytd >= 85
                  ? "bg-warning"
                  : "bg-negative"
            }`}
            style={{
              width: `${Math.min(100, Math.max(0, tasa_cumplimiento_ytd))}%`,
            }}
          />
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-ink-500">
          <span>0%</span>
          <span>85% ⓘ aceptable</span>
          <span>95% ⓘ óptimo</span>
          <span>100%</span>
        </div>
      </section>

      {/* Vencidos — primero, requiere explicación en acta */}
      {vencidos_sin_entregar.length > 0 && (
        <SeccionTabla
          titulo="Vencidos sin entregar"
          subtitle="Estos entregables superaron su fecha límite y siguen sin cerrar. Cada uno debe tener explicación documentada para el acta."
          tone="negative"
          items={vencidos_sin_entregar}
        />
      )}

      {/* Próximos 30 días */}
      <SeccionTabla
        titulo="Próximos 30 días"
        subtitle="Pipeline operativo del mes — tabla de seguimiento."
        tone="info"
        items={proximos_30d}
      />

      {/* Counts por estado */}
      <section className="rounded-2xl border border-hairline bg-white p-5 print:border-ink-300 print:rounded-none">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-ink-500">
          Distribución por estado
        </h2>
        <div className="grid grid-cols-2 gap-2 text-sm md:grid-cols-4">
          <EstadoBlock label="Pendiente" value={estados.pendiente} tone="ink" />
          <EstadoBlock label="En proceso" value={estados.en_proceso} tone="info" />
          <EstadoBlock label="Entregado" value={estados.entregado} tone="positive" />
          <EstadoBlock
            label="No entregado"
            value={estados.no_entregado}
            tone="negative"
          />
        </div>
      </section>

      {/* Pie con nota de compliance */}
      <footer className="space-y-1 border-t border-ink-300 pt-4 text-[10px] text-ink-500 print:border-ink-900">
        <p>
          <strong>Nota de compliance.</strong> Este reporte es de uso interno
          para gobernanza del Fondo (Comité de Vigilancia y Comité de
          Inversiones). No incluye TIR, rentabilidades, ni montos USD del
          portafolio — la información sensible se gestiona en canales
          oficiales hacia partícipes según Reglamento Interno del FIP CEHTA
          ESG.
        </p>
        <p>
          Página generada automáticamente desde la plataforma de gobernanza
          interna. Para detalles de cualquier entregable individual, consultar
          la vista web en /entregables o el archivo de respaldo en Dropbox.
        </p>
      </footer>
    </div>
  );
}

function KpiCard({
  label,
  value,
  subtitle,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  subtitle: string;
  icon: React.ReactNode;
  tone?: "default" | "positive" | "negative" | "warning" | "info";
}) {
  const toneClass =
    tone === "positive"
      ? "border-positive/30 bg-positive/5 print:border-positive/60"
      : tone === "negative"
        ? "border-negative/30 bg-negative/5 print:border-negative/60"
        : tone === "warning"
          ? "border-warning/30 bg-warning/5 print:border-warning/60"
          : tone === "info"
            ? "border-info/30 bg-info/5 print:border-info/60"
            : "border-hairline bg-white print:border-ink-300";
  const accentText =
    tone === "positive"
      ? "text-positive"
      : tone === "negative"
        ? "text-negative"
        : tone === "warning"
          ? "text-warning"
          : tone === "info"
            ? "text-info"
            : "text-ink-900";

  return (
    <div
      className={`rounded-2xl border p-4 print:rounded-none ${toneClass}`}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        {icon}
        {label}
      </div>
      <p className={`mt-1.5 text-3xl font-bold tabular-nums ${accentText}`}>
        {value}
      </p>
      <p className="text-[10px] text-ink-500">{subtitle}</p>
    </div>
  );
}

function SeccionTabla({
  titulo,
  subtitle,
  tone,
  items,
}: {
  titulo: string;
  subtitle: string;
  tone: "negative" | "info";
  items: EntregableRead[];
}) {
  const headerTone =
    tone === "negative"
      ? "border-negative/30 bg-negative/5 text-negative print:border-negative/60"
      : "border-info/30 bg-info/5 text-info print:border-info/60";

  return (
    <section className="overflow-hidden rounded-2xl border border-hairline bg-white print:rounded-none print:border-ink-300 print:break-inside-avoid">
      <header className={`border-b px-5 py-3 ${headerTone}`}>
        <h2 className="text-sm font-bold uppercase tracking-wider">
          {titulo} ({items.length})
        </h2>
        <p className="mt-0.5 text-[11px] opacity-80">{subtitle}</p>
      </header>
      {items.length === 0 ? (
        <p className="px-5 py-4 text-xs text-ink-500">— Ninguno —</p>
      ) : (
        <table className="min-w-full divide-y divide-hairline text-xs print:text-[10px]">
          <thead className="bg-ink-50/50 text-[9px] uppercase tracking-wider text-ink-500">
            <tr>
              <th className="px-3 py-2 text-left">Fecha</th>
              <th className="px-3 py-2 text-left">Categoría</th>
              <th className="px-3 py-2 text-left">Entregable</th>
              <th className="hidden px-3 py-2 text-left lg:table-cell print:table-cell">
                Período
              </th>
              <th className="hidden px-3 py-2 text-left md:table-cell print:table-cell">
                Responsable
              </th>
              <th className="px-3 py-2 text-right">Días</th>
              <th className="hidden px-3 py-2 text-left sm:table-cell print:table-cell">
                Estado
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {items.map((e) => {
              const dias = e.dias_restantes ?? 0;
              return (
                <tr key={e.entregable_id}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium tabular-nums">
                    {formatFechaCorta(e.fecha_limite)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                        CATEGORIA_BG[e.categoria] ??
                        "bg-ink-100 text-ink-700"
                      }`}
                    >
                      {e.categoria}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-900">
                    <p className="font-medium">{e.nombre}</p>
                    {e.referencia_normativa && (
                      <p className="text-[9px] italic text-ink-400">
                        {e.referencia_normativa}
                      </p>
                    )}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 font-mono text-[10px] text-ink-700 lg:table-cell print:table-cell">
                    {e.periodo}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-[10px] text-ink-700 md:table-cell print:table-cell">
                    {e.responsable}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums ${
                      dias < 0
                        ? "text-negative"
                        : dias <= 5
                          ? "text-warning"
                          : "text-ink-700"
                    }`}
                  >
                    {dias < 0
                      ? `${Math.abs(dias)}d vencido`
                      : dias === 0
                        ? "HOY"
                        : `${dias}d`}
                  </td>
                  <td className="hidden whitespace-nowrap px-3 py-2 text-[10px] capitalize sm:table-cell print:table-cell">
                    {e.estado.replace("_", " ")}
                    {e.estado === "no_entregado" && e.motivo_no_entrega && (
                      <p className="mt-0.5 text-[9px] italic text-ink-500">
                        Motivo: {e.motivo_no_entrega}
                      </p>
                    )}
                    {e.adjunto_url && (
                      <div className="mt-1 print:mt-0.5">
                        <FileLink
                          url={e.adjunto_url}
                          variant="inline"
                          className="text-[9px]"
                        />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

function EstadoBlock({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "ink" | "info" | "positive" | "negative";
}) {
  const toneClass =
    tone === "info"
      ? "text-info"
      : tone === "positive"
        ? "text-positive"
        : tone === "negative"
          ? "text-negative"
          : "text-ink-900";
  return (
    <div className="rounded-xl border border-hairline px-3 py-2 print:rounded-none print:border-ink-300">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </p>
      <p className={`text-xl font-bold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}
