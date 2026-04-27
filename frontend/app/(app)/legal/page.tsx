import {
  Scale,
  FolderLock,
  BellRing,
  FileSignature,
  ScanSearch,
  CheckCircle2,
} from "lucide-react";
import { SectionLanding } from "../_components/SectionLanding";

export const metadata = {
  title: "Legal · Cehta Capital",
};

export default function LegalPage() {
  return (
    <SectionLanding
      title="Legal"
      subtitle="Bóveda de documentos legales por empresa con alertas automáticas, generador de templates y compliance dashboard."
      Icon={Scale}
      phase={4}
      phaseTitle="Bóveda legal con expiry tracking"
      phaseDescription="Contratos, estatutos y actas separados por empresa. OCR para búsqueda dentro de PDFs y alertas de vencimiento a 30/60/90 días."
      features={[
        {
          title: "Bóveda por Empresa",
          description: "Contratos, estatutos, actas separados",
          Icon: FolderLock,
        },
        {
          title: "Alertas Vencimiento",
          description: "Avisos 30/60/90 días antes",
          Icon: BellRing,
        },
        {
          title: "Templates",
          description: "Generador de docs desde plantillas",
          Icon: FileSignature,
        },
        {
          title: "OCR Búsqueda",
          description: "Busca dentro de PDFs escaneados",
          Icon: ScanSearch,
        },
        {
          title: "Compliance Dashboard",
          description: "% docs al día por empresa",
          Icon: CheckCircle2,
        },
      ]}
    />
  );
}
