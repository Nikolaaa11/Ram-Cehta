import { Target, GanttChartSquare, TrendingUp, BookOpen, AlertTriangle } from "lucide-react";
import { SectionLanding } from "@/app/(app)/_components/SectionLanding";

export default async function EmpresaAvancePage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  return (
    <SectionLanding
      title={`Avance · ${codigo}`}
      subtitle={`Roadmap, hitos, KPIs operativos y reportes semanales de ${codigo}.`}
      Icon={Target}
      phase={3}
      phaseTitle="Estado de Avance del proyecto"
      phaseDescription={`Visualización del Roadmap.xlsx de ${codigo} en formato Gantt con hitos completados, KPIs operativos y narrativa semanal.`}
      features={[
        { Icon: GanttChartSquare, title: "Gantt Chart", description: "Timeline visual con fases y hitos" },
        { Icon: TrendingUp, title: "KPIs operativos", description: "Ingresos vs proyectado, gastos por fase" },
        { Icon: BookOpen, title: "Reportes Semanales", description: "Narrativa de avances y bloqueos" },
        { Icon: AlertTriangle, title: "Riesgos", description: "Lista priorizada con owner y mitigación" },
      ]}
    />
  );
}
