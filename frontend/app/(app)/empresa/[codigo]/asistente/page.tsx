import { Sparkles, MessageSquare, Brain, Zap, FileEdit, Lightbulb } from "lucide-react";
import { SectionLanding } from "@/app/(app)/_components/SectionLanding";

export default async function EmpresaAsistentePage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  return (
    <SectionLanding
      title={`AI Asistente · ${codigo}`}
      subtitle={`Chat con todo el contexto de ${codigo}: financiero, legal, operativo. Pregúntale lo que sea.`}
      Icon={Sparkles}
      phase={3}
      phaseTitle="AI con conocimiento de la empresa"
      phaseDescription={`Claude conectado al contexto completo de ${codigo} (movimientos, OCs, F29, contratos, roadmap) vía pgvector + embeddings. Cada usuario solo accede al contexto de SU empresa.`}
      features={[
        { Icon: MessageSquare, title: "Chat persistente", description: "Conversaciones guardadas, reanudables" },
        { Icon: Brain, title: "Contexto completo", description: "Movs, OCs, F29, docs legales en memoria" },
        { Icon: Zap, title: "Análisis rápido", description: "Cashflow, gastos por categoría" },
        { Icon: FileEdit, title: "Borrador reportes", description: "Genera drafts de reportes mensuales" },
        { Icon: Lightbulb, title: "Brainstorm", description: "Ideas estratégicas basadas en KPIs" },
      ]}
    />
  );
}
