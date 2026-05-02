"use client";

/**
 * SmartInsights — V4 fase 7.10.
 *
 * Card con insights derivadas del estado actual de entregables. Usa
 * lógica template-based (no LLM) para generar bullets accionables como:
 *   - "Tu peor compliance está en DTE (grade D)"
 *   - "Esta semana tenés 3 críticos: 2 CMF + 1 SII"
 *   - "Faltan 3 días para el cierre F29 mensual"
 *
 * El día que tengamos AI tools (V5), esto se reemplaza con un endpoint
 * que devuelva insights generadas por LLM con contexto + few-shot.
 */
import { useMemo } from "react";
import {
  AlertTriangle,
  Lightbulb,
  Sparkles,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import {
  useComplianceGradeReport,
  useEntregables,
} from "@/hooks/use-entregables";

type Insight = {
  id: string;
  tone: "critical" | "warning" | "info" | "positive";
  Icon: typeof Sparkles;
  text: React.ReactNode;
  action?: { label: string; href: string };
};

export function SmartInsights() {
  const today = new Date();
  const en30d = new Date(today);
  en30d.setDate(today.getDate() + 30);

  const { data: entregables = [] } = useEntregables({
    desde: today.toISOString().slice(0, 10),
    hasta: en30d.toISOString().slice(0, 10),
  });
  const { data: compliance } = useComplianceGradeReport();

  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];

    const pendientes = entregables.filter(
      (e) => e.estado !== "entregado" && e.estado !== "no_entregado",
    );
    const vencidos = pendientes.filter((e) => e.nivel_alerta === "vencido");
    const hoy = pendientes.filter((e) => e.nivel_alerta === "hoy");
    const criticos = pendientes.filter((e) => e.nivel_alerta === "critico");

    // Insight 1 — vencidos
    if (vencidos.length > 0) {
      const porCat: Record<string, number> = {};
      for (const e of vencidos) {
        porCat[e.categoria] = (porCat[e.categoria] ?? 0) + 1;
      }
      const breakdown = Object.entries(porCat)
        .sort(([, a], [, b]) => b - a)
        .map(([cat, n]) => `${n} ${cat}`)
        .join(" + ");
      out.push({
        id: "vencidos",
        tone: "critical",
        Icon: AlertTriangle,
        text: (
          <>
            Tenés <strong>{vencidos.length} entregables vencidos</strong>{" "}
            ({breakdown}). Cada uno requiere explicación documentada en el
            acta del Comité de Vigilancia.
          </>
        ),
        action: { label: "Ver vencidos", href: "/entregables/reporte" },
      });
    }

    // Insight 2 — hoy + críticos
    const urgentesHoyOCritico = hoy.length + criticos.length;
    if (urgentesHoyOCritico > 0) {
      out.push({
        id: "hoy-critico",
        tone: "warning",
        Icon: AlertTriangle,
        text: (
          <>
            Esta semana tenés{" "}
            <strong>{urgentesHoyOCritico} críticos</strong>{" "}
            {hoy.length > 0 && `(${hoy.length} vencen hoy)`}. Resolver antes
            del fin de semana.
          </>
        ),
        action: { label: "Ver pipeline", href: "/entregables" },
      });
    }

    // Insight 3 — peor empresa
    if (compliance && compliance.empresas.length > 0) {
      const conRiesgo = compliance.empresas.filter(
        (e) => e.grade === "F" || e.grade === "D",
      );
      if (conRiesgo.length > 0) {
        const peor = conRiesgo[conRiesgo.length - 1]!;
        out.push({
          id: "peor-empresa",
          tone: "warning",
          Icon: TrendingDown,
          text: (
            <>
              Compliance YTD más bajo:{" "}
              <strong>{peor.empresa_codigo} (grade {peor.grade})</strong>{" "}
              con {peor.tasa_a_tiempo.toFixed(0)}% de entregas a tiempo (
              {peor.entregados_a_tiempo} de {peor.total}).
            </>
          ),
          action: {
            label: `Ver ${peor.empresa_codigo}`,
            href: `/empresa/${peor.empresa_codigo}`,
          },
        });
      } else {
        // Todas en B o mejor → felicitar
        const mejor = compliance.empresas[0];
        if (mejor) {
          out.push({
            id: "todas-bien",
            tone: "positive",
            Icon: TrendingUp,
            text: (
              <>
                Compliance del portfolio en buen estado: promedio{" "}
                <strong>
                  {compliance.promedio_cumplimiento.toFixed(1)}%
                </strong>
                . Mejor: {mejor.empresa_codigo} (grade {mejor.grade}).
              </>
            ),
          });
        }
      }
    }

    // Insight 4 — próximo cierre F29 si aplica
    const f29Items = pendientes.filter(
      (e) =>
        e.id_template?.toLowerCase().includes("f29") ||
        e.nombre?.toLowerCase().includes("f29"),
    );
    if (f29Items.length > 0) {
      const next = f29Items.sort((a, b) =>
        a.fecha_limite.localeCompare(b.fecha_limite),
      )[0];
      if (next && next.dias_restantes !== null) {
        const dias = next.dias_restantes;
        if (dias >= 0 && dias <= 12) {
          out.push({
            id: "f29-proximo",
            tone: dias <= 3 ? "warning" : "info",
            Icon: Lightbulb,
            text: (
              <>
                Próximo cierre F29:{" "}
                <strong>
                  {dias === 0 ? "hoy" : `en ${dias} día${dias !== 1 ? "s" : ""}`}
                </strong>{" "}
                ({next.nombre}). El día 12 es el plazo máximo SII.
              </>
            ),
            action: { label: "Ver detalle", href: "/entregables" },
          });
        }
      }
    }

    // Insight 5 — semana sin urgencias
    if (
      vencidos.length === 0 &&
      hoy.length === 0 &&
      criticos.length === 0 &&
      pendientes.length > 0
    ) {
      out.push({
        id: "tranquilo",
        tone: "positive",
        Icon: Sparkles,
        text: (
          <>
            Sin urgencias esta semana. Buen momento para adelantar trabajo en
            los <strong>{pendientes.length} pendientes próximos</strong> y
            cargar adjuntos.
          </>
        ),
      });
    }

    return out.slice(0, 4);
  }, [entregables, compliance]);

  if (insights.length === 0) return null;

  return (
    <Surface variant="glass" className="border border-cehta-green/20">
      <Surface.Header className="border-b border-hairline pb-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-cehta-green/15 text-cehta-green">
            <Lightbulb className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div>
            <Surface.Title>Insights inteligentes</Surface.Title>
            <Surface.Subtitle>
              Análisis automático de tu pipeline regulatorio
            </Surface.Subtitle>
          </div>
        </div>
      </Surface.Header>

      <ul className="mt-3 space-y-2">
        {insights.map((insight) => {
          const tone = insight.tone;
          const ringClass =
            tone === "critical"
              ? "border-negative/30 bg-negative/5"
              : tone === "warning"
                ? "border-warning/30 bg-warning/5"
                : tone === "positive"
                  ? "border-positive/30 bg-positive/5"
                  : "border-info/30 bg-info/5";
          const iconColor =
            tone === "critical"
              ? "text-negative"
              : tone === "warning"
                ? "text-warning"
                : tone === "positive"
                  ? "text-positive"
                  : "text-info";
          return (
            <li
              key={insight.id}
              className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${ringClass}`}
            >
              <insight.Icon
                className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`}
                strokeWidth={1.75}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-700">{insight.text}</p>
                {insight.action && (
                  <a
                    href={insight.action.href}
                    className="mt-1 inline-block text-[11px] font-medium text-cehta-green hover:underline"
                  >
                    {insight.action.label} →
                  </a>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Surface>
  );
}
