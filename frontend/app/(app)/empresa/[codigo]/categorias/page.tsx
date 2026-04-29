import { Surface } from "@/components/ui/surface";
import { serverApiGet } from "@/lib/api/server";
import { CategoriasBreakdownList } from "@/components/empresa/CategoriasBreakdown";
import type { CategoriaBreakdown } from "@/lib/api/schema";

/**
 * Categorías — V3 fase 6.
 *
 * Vista jerárquica concepto_general → concepto_detallado. Cada categoría
 * principal es expandible y muestra la tabla de sub-conceptos.
 */
export default async function CategoriasPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  const data = await serverApiGet<CategoriaBreakdown[]>(
    `/empresa/${codigo}/categorias`,
  );

  return (
    <div className="space-y-6">
      <Surface variant="glass">
        <Surface.Header>
          <Surface.Title>Categorías</Surface.Title>
          <Surface.Subtitle>
            Egresos y abonos agrupados por concepto general, con desglose en
            sub-categorías. Hace click en cualquier card para expandir.
          </Surface.Subtitle>
        </Surface.Header>
      </Surface>

      <CategoriasBreakdownList data={data} />
    </div>
  );
}
