import { FolderOpen, FileText, Image, FileSpreadsheet, Cloud } from "lucide-react";
import { SectionLanding } from "@/app/(app)/_components/SectionLanding";

export default async function EmpresaDocumentosPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  return (
    <SectionLanding
      title={`Documentos · ${codigo}`}
      subtitle={`Archivos generales de ${codigo}: estatutos, financieros, reportes generados.`}
      Icon={FolderOpen}
      phase={4}
      phaseTitle="Bóveda de Documentos"
      phaseDescription={`Acceso unificado a 01-Información General, 04-Financiero y 07-Reportes Generados de ${codigo} en Dropbox.`}
      features={[
        { Icon: FileText, title: "Información General", description: "Estatutos, RUT, constitución" },
        { Icon: FileSpreadsheet, title: "Financiero", description: "Balances, EE.FF., cartolas bancarias" },
        { Icon: Image, title: "Multimedia", description: "Logos, fotos, branding" },
        { Icon: Cloud, title: "Sync Dropbox", description: "Cambios en Dropbox se reflejan auto" },
      ]}
    />
  );
}
