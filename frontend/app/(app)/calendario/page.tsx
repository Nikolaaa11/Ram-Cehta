import {
  CalendarDays,
  Calendar,
  FileText,
  ShieldCheck,
  Bell,
} from "lucide-react";
import { SectionLanding } from "../_components/SectionLanding";

export const metadata = {
  title: "Calendario · Cehta Capital",
};

export default function CalendarioPage() {
  return (
    <SectionLanding
      title="Calendario & Reportes Auto"
      subtitle="Calendario unificado con eventos del reglamento interno, agentes que generan borradores y notificaciones automáticas."
      Icon={CalendarDays}
      phase={2}
      phaseTitle="Compliance en piloto automático"
      phaseDescription="F29, reportes a LPs, comités y vencimientos tributarios. Borradores listos antes de cada hito y alertas para no perder nada."
      features={[
        {
          title: "Calendar view",
          description: "Mes/semana con eventos F29, reportes LP, comités",
          Icon: Calendar,
        },
        {
          title: "Auto-Reportes",
          description: "Borradores generados antes del vencimiento",
          Icon: FileText,
        },
        {
          title: "Validador Compliance",
          description: "Checks nightly del SII y alertas",
          Icon: ShieldCheck,
        },
        {
          title: "Notificaciones",
          description: "Bell icon + email diario con resumen",
          Icon: Bell,
        },
      ]}
    />
  );
}
