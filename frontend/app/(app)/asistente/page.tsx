import {
  Sparkles,
  MessageSquare,
  Brain,
  Zap,
  FileEdit,
  Lightbulb,
} from "lucide-react";
import { SectionLanding } from "../_components/SectionLanding";

export const metadata = {
  title: "AI Asistente · Cehta Capital",
};

export default function AsistentePage() {
  return (
    <SectionLanding
      title="AI Asistente"
      subtitle="Chat AI por empresa con todo el contexto financiero, legal y operativo. Pregúntale cualquier cosa sobre tu empresa para apoyar decisiones."
      Icon={Sparkles}
      phase={3}
      phaseTitle="Tu copiloto por empresa"
      phaseDescription="Movimientos, OCs, F29 y documentos legales en memoria. Genera análisis, drafts de reportes y brainstorms basados en tus propios datos."
      features={[
        {
          title: "Chat Inteligente",
          description: "Conversaciones persistentes con Claude",
          Icon: MessageSquare,
        },
        {
          title: "Contexto Empresa",
          description: "Movimientos, OCs, F29, docs legales en memoria",
          Icon: Brain,
        },
        {
          title: "Análisis",
          description: "Flujo de caja, gastos por categoría, comparativas",
          Icon: Zap,
        },
        {
          title: "Borrador Reportes",
          description: "Genera drafts de reportes mensuales",
          Icon: FileEdit,
        },
        {
          title: "Brainstorm",
          description: "Ideas de mejora basadas en tus KPIs",
          Icon: Lightbulb,
        },
      ]}
    />
  );
}
