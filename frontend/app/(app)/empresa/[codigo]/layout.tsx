import { notFound } from "next/navigation";
import { serverApiGet } from "@/lib/api/server";
import type { EmpresaCatalogo } from "@/lib/api/schema";
import { EmpresaHeader } from "@/components/empresa/EmpresaHeader";
import { EmpresaTabs } from "@/components/empresa/EmpresaTabs";

/**
 * Layout para todas las rutas /empresa/[codigo]/* — V3 fase 2.
 *
 * Pre-fetches el catálogo de empresas y valida que el codigo existe.
 * Si no existe, retorna 404. Si existe, renderiza header con info de
 * la empresa + tabs sticky para navegar entre sub-secciones.
 *
 * El sidebar gestiona la navegación entre empresas; las tabs son para
 * sub-secciones dentro de UNA empresa.
 */
export default async function EmpresaLayout({
  params,
  children,
}: {
  params: Promise<{ codigo: string }>;
  children: React.ReactNode;
}) {
  const { codigo } = await params;

  let empresas: EmpresaCatalogo[] = [];
  try {
    empresas = await serverApiGet<EmpresaCatalogo[]>("/catalogos/empresas");
  } catch {
    notFound();
  }

  const empresa = empresas.find(
    (e) => e.codigo.toLowerCase() === codigo.toLowerCase(),
  );
  if (!empresa) notFound();

  return (
    <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-6">
      <EmpresaHeader empresa={empresa} />
      <EmpresaTabs codigo={empresa.codigo} />
      <div className="mt-6">{children}</div>
    </div>
  );
}
