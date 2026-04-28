import { AlertCircle, AlertTriangle, Clock, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  nivel?: string | null;
  diasParaVencer?: number | null;
}

/**
 * Badge de alerta para vencimiento de documentos legales.
 *
 * Niveles vienen del backend (`core.v_legal_alerts`):
 *  - vencido  → danger + icono alert
 *  - critico  (≤30d) → danger + icono alert
 *  - proximo  (≤90d) → warning + icono clock
 *  - ok       → success
 */
export function AlertBadge({ nivel, diasParaVencer }: Props) {
  if (!nivel) {
    return <span className="text-xs text-ink-500">Sin vigencia</span>;
  }

  if (nivel === "vencido") {
    return (
      <Badge variant="danger">
        <AlertCircle className="h-3 w-3" strokeWidth={1.75} />
        Vencido {diasParaVencer != null ? `${Math.abs(diasParaVencer)}d` : ""}
      </Badge>
    );
  }

  if (nivel === "critico") {
    return (
      <Badge variant="danger">
        <AlertTriangle className="h-3 w-3" strokeWidth={1.75} />
        {diasParaVencer != null ? `Vence en ${diasParaVencer}d` : "Crítico"}
      </Badge>
    );
  }

  if (nivel === "proximo") {
    return (
      <Badge variant="warning">
        <Clock className="h-3 w-3" strokeWidth={1.75} />
        {diasParaVencer != null ? `Vence en ${diasParaVencer}d` : "Próximo"}
      </Badge>
    );
  }

  return (
    <Badge variant="success">
      <CheckCircle2 className="h-3 w-3" strokeWidth={1.75} />
      Vigente
    </Badge>
  );
}
