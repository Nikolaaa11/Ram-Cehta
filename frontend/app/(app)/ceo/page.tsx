import {
  LineChart,
  Wallet,
  Activity,
  BarChart3,
  Sparkles,
  Lightbulb,
} from "lucide-react";
import { SectionLanding } from "../_components/SectionLanding";

export const metadata = {
  title: "Dashboard CEO · Cehta Capital",
};

export default function CeoDashboardPage() {
  return (
    <SectionLanding
      title="Dashboard CEO"
      subtitle="Vista consolidada de las 9 empresas del portfolio. KPIs unificados, comparador de salud, insights generados por AI."
      Icon={LineChart}
      phase={2}
      phaseTitle="Vista ejecutiva consolidada"
      phaseDescription="Una sola pantalla para entender la salud del fondo: AUM, flujos, alertas y acciones prioritarias del CEO."
      features={[
        {
          title: "KPIs Hero",
          description: "AUM consolidado, flujos netos, deltas MoM",
          Icon: Wallet,
        },
        {
          title: "Heatmap Salud",
          description: "Matriz empresas × KPIs con semáforos",
          Icon: Activity,
        },
        {
          title: "Comparador",
          description: "Scoreboard de las 9 empresas en columnas",
          Icon: BarChart3,
        },
        {
          title: "Insights AI",
          description: "Resumen semanal generado por Claude",
          Icon: Sparkles,
        },
        {
          title: "Acciones Recomendadas",
          description: "Top 3 cosas a revisar",
          Icon: Lightbulb,
        },
      ]}
    />
  );
}
