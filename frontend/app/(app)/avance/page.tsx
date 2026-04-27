import {
  Target,
  GanttChartSquare,
  TrendingUp,
  BookOpen,
  AlertTriangle,
} from "lucide-react";
import { SectionLanding } from "../_components/SectionLanding";

export const metadata = {
  title: "Avance Empresas · Cehta Capital",
};

export default function AvancePage() {
  return (
    <SectionLanding
      title="Avance por Empresa"
      subtitle="Estado de avance, hitos y riesgos por cada empresa del portfolio. Gantt charts, KPIs operativos, narrativa semanal."
      Icon={Target}
      phase={3}
      phaseTitle="Tracking operativo del portfolio"
      phaseDescription="Cada empresa con su roadmap visible: fases, hitos, ingresos vs proyectado y riesgos priorizados con owner y mitigación."
      features={[
        {
          title: "Gantt Chart",
          description: "Timeline visual con fases y hitos",
          Icon: GanttChartSquare,
        },
        {
          title: "KPIs Operativos",
          description: "Ingresos vs proyectado, gastos por fase",
          Icon: TrendingUp,
        },
        {
          title: "Reportes Semanales",
          description: "Narrativa de avances y bloqueos",
          Icon: BookOpen,
        },
        {
          title: "Riesgos",
          description: "Lista priorizada con owner y mitigación",
          Icon: AlertTriangle,
        },
      ]}
    />
  );
}
