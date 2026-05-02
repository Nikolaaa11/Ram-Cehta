"use client";

/**
 * EntregablesEmpresaWidget — V4 fase 7.7.
 *
 * Bloque que aparece en `/empresa/[codigo]` mostrando los entregables
 * regulatorios filtrados por esa empresa. Match contra:
 *   - `subcategoria == codigo`        (legacy)
 *   - `extra->>empresa_codigo == codigo` (nuevo)
 *
 * Pensado para que cuando navegues a CSL/RHO/DTE veas en una mirada qué
 * documentos del Reglamento te tocan a vos esta semana / próximos días.
 */
import { useState } from "react";
import {
  ArrowRight,
  Award,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useComplianceGradeEmpresa,
  useEntregables,
} from "@/hooks/use-entregables";
import { useSession } from "@/hooks/use-session";
import { ActaGeneradoraDialog } from "@/components/entregables/ActaGeneradoraDialog";
import { FileLink } from "@/components/shared/FileLink";
import { cn } from "@/lib/utils";

interface Props {
  empresaCodigo: string;
}

const ALERTA_BG = {
  vencido: "bg-negative/15 text-negative",
  hoy: "bg-negative/20 text-negative animate-pulse",
  critico: "bg-negative/10 text-negative",
  urgente: "bg-warning/15 text-warning",
  proximo: "bg-warning/10 text-warning",
  en_rango: "bg-info/10 text-info",
  normal: "bg-ink-100/40 text-ink-500",
} as const;

function formatFechaCorta(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("es-CL", {
    day: "2-digit",
    month: "short",
  });
}

export function EntregablesEmpresaWidget({ empresaCodigo }: Props) {
  // Filtramos backend-side por empresa + próximos 90 días
  const today = new Date();
  const en90d = new Date(today);
  en90d.setDate(today.getDate() + 90);

  const { data: entregables = [], isLoading } = useEntregables({
    empresa: empresaCodigo,
    desde: today.toISOString().slice(0, 10),
    hasta: en90d.toISOString().slice(0, 10),
  });
  const { data: compliance } = useComplianceGradeEmpresa(empresaCodigo);
  const { session } = useSession();
  const [actaOpen, setActaOpen] = useState(false);

  const downloadReporteCV = async () => {
    if (!session) return;
    const apiBase =
      process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
    try {
      const res = await fetch(
        `${apiBase}/entregables/reporte-cv.xlsx?empresa=${encodeURIComponent(empresaCodigo)}`,
        { headers: { Authorization: `Bearer ${session.access_token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `reporte-cv-${empresaCodigo.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      toast.success(`Reporte CV de ${empresaCodigo} descargado`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Error descargando Excel",
      );
    }
  };

  // Solo no-entregados, ordenados por fecha
  const items = entregables
    .filter((e) => e.estado !== "entregado" && e.estado !== "no_entregado")
    .sort((a, b) => a.fecha_limite.localeCompare(b.fecha_limite));

  return (
    <Surface>
      <Surface.Header className="border-b border-hairline pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-cehta-green/15 text-cehta-green">
              <ClipboardList className="h-4 w-4" strokeWidth={1.75} />
            </span>
            <div>
              <Surface.Title>Entregables de {empresaCodigo}</Surface.Title>
              <Surface.Subtitle>
                Próximos 90 días ·{" "}
                {isLoading
                  ? "cargando…"
                  : `${items.length} pendientes`}
              </Surface.Subtitle>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {compliance && compliance.total > 0 && (
              <ComplianceBadge
                grade={compliance.grade}
                tasa={compliance.tasa_a_tiempo}
                total={compliance.total}
                entregadosATiempo={compliance.entregados_a_tiempo}
              />
            )}
            <button
              type="button"
              onClick={() => setActaOpen(true)}
              title={`Generar acta CV con AI para ${empresaCodigo}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-cehta-green/10 px-3 py-1.5 text-xs font-medium text-cehta-green ring-1 ring-cehta-green/30 transition-colors hover:bg-cehta-green/15"
            >
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} />
              Acta AI
            </button>
            <button
              type="button"
              onClick={downloadReporteCV}
              title={`Descargar reporte CV Excel de ${empresaCodigo}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" strokeWidth={1.5} />
              Excel CV
            </button>
            <a
              href={`/entregables?empresa=${empresaCodigo}`}
              className="inline-flex items-center gap-1.5 rounded-xl border border-hairline bg-white px-3 py-1.5 text-xs font-medium text-ink-700 transition-colors hover:bg-ink-50"
            >
              <FileText className="h-3.5 w-3.5" strokeWidth={1.5} />
              Ver todos
              <ArrowRight className="h-3 w-3" strokeWidth={1.5} />
            </a>
          </div>
        </div>
      </Surface.Header>

      {isLoading ? (
        <div className="mt-3 space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-3 rounded-xl border border-positive/20 bg-positive/5 p-4 text-center">
          <p className="text-sm font-semibold text-positive">
            Sin entregables para {empresaCodigo} en próximos 90 días
          </p>
          <p className="mt-0.5 text-[11px] text-ink-500">
            O ya están todos entregados, o no hay templates específicos
            asignados a esta empresa.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-1.5">
          {items.slice(0, 6).map((e) => {
            const nivel = e.nivel_alerta ?? "normal";
            const dias = e.dias_restantes ?? 0;
            return (
              <div
                key={e.entregable_id}
                className="flex items-start gap-3 rounded-xl border border-hairline bg-white px-3 py-2"
              >
                <span
                  className={cn(
                    "inline-flex h-9 w-12 shrink-0 flex-col items-center justify-center rounded-md text-[10px]",
                    ALERTA_BG[nivel],
                  )}
                >
                  <span className="font-bold">
                    {formatFechaCorta(e.fecha_limite)}
                  </span>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-ink-100/60 px-1.5 py-0.5 text-[10px] font-bold uppercase text-ink-700">
                      {e.categoria}
                    </span>
                    <span className="text-[11px] font-semibold text-ink-500">
                      {dias < 0
                        ? `Vencido ${Math.abs(dias)}d`
                        : dias === 0
                          ? "HOY"
                          : `En ${dias}d`}
                    </span>
                    <span className="text-[10px] text-ink-400">
                      {e.periodo}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-sm font-medium text-ink-900">
                    {e.nombre}
                  </p>
                  {e.adjunto_url && (
                    <div className="mt-1">
                      <FileLink
                        url={e.adjunto_url}
                        variant="inline"
                        className="text-[10px]"
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {items.length > 6 && (
            <a
              href={`/entregables?empresa=${empresaCodigo}`}
              className="block py-1 text-center text-[11px] font-medium text-cehta-green hover:underline"
            >
              Ver {items.length - 6} entregable
              {items.length - 6 !== 1 ? "s" : ""} más →
            </a>
          )}
        </div>
      )}

      <ActaGeneradoraDialog
        open={actaOpen}
        onOpenChange={setActaOpen}
        defaultEmpresa={empresaCodigo}
      />
    </Surface>
  );
}

const GRADE_COLOR: Record<string, string> = {
  A: "bg-positive/15 text-positive ring-positive/25",
  B: "bg-cehta-green/15 text-cehta-green ring-cehta-green/25",
  C: "bg-info/15 text-info ring-info/25",
  D: "bg-warning/15 text-warning ring-warning/25",
  F: "bg-negative/15 text-negative ring-negative/25",
};

function ComplianceBadge({
  grade,
  tasa,
  total,
  entregadosATiempo,
}: {
  grade: string;
  tasa: number;
  total: number;
  entregadosATiempo: number;
}) {
  return (
    <div
      title={`Compliance YTD: ${entregadosATiempo} de ${total} a tiempo (${tasa.toFixed(1)}%)`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1 ring-1",
        GRADE_COLOR[grade] ?? "bg-ink-100 text-ink-700 ring-hairline",
      )}
    >
      <Award className="h-3.5 w-3.5" strokeWidth={2} />
      <span className="text-[10px] font-semibold uppercase tracking-wider">
        Compliance
      </span>
      <span className="text-base font-bold leading-none">{grade}</span>
      <span className="text-[10px] tabular-nums">
        {tasa.toFixed(0)}%
      </span>
    </div>
  );
}
