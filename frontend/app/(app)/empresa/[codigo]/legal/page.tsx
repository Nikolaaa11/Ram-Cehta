import { Scale, FolderLock, BellRing, FileSignature, ScanSearch, CheckCircle2 } from "lucide-react";
import { SectionLanding } from "@/app/(app)/_components/SectionLanding";

export default async function EmpresaLegalPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  return (
    <SectionLanding
      title={`Legal · ${codigo}`}
      subtitle={`Bóveda de documentos legales de ${codigo} con alertas automáticas, generador de templates y compliance dashboard.`}
      Icon={Scale}
      phase={4}
      phaseTitle="Bóveda Legal por empresa"
      phaseDescription={`Cuando esta sección esté lista, vas a poder ver y subir contratos, actas, declaraciones SII, permisos y pólizas de ${codigo}, con alertas automáticas de vencimientos.`}
      features={[
        { Icon: FolderLock, title: "Bóveda categorizada", description: "Contratos, actas, declaraciones SII, permisos en carpetas separadas" },
        { Icon: BellRing, title: "Alertas vencimiento", description: "Avisos 30/60/90 días antes con email + bell icon" },
        { Icon: FileSignature, title: "Templates", description: "Generador de documentos desde plantillas estándar" },
        { Icon: ScanSearch, title: "OCR + búsqueda", description: "Busca dentro de PDFs escaneados" },
        { Icon: CheckCircle2, title: "Compliance", description: "% de docs al día por categoría" },
      ]}
    />
  );
}
