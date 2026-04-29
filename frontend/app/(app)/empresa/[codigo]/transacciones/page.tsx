import { Surface } from "@/components/ui/surface";
import { serverApiGet } from "@/lib/api/server";
import { TransaccionesTable } from "@/components/empresa/TransaccionesTable";
import type { TransaccionRecienteItem } from "@/lib/api/schema";

/**
 * Últimas Transacciones de la empresa — V3 fase 6.
 *
 * Tabla paginada con filtros locales (proyecto/concepto/búsqueda) y export
 * CSV. Trae los últimos 100 movimientos por default — la paginación full
 * server-side es trabajo de fase posterior cuando agreguemos el endpoint
 * `/transacciones?page=N&size=K`.
 */
export default async function TransaccionesPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  const data = await serverApiGet<TransaccionRecienteItem[]>(
    `/empresa/${codigo}/transacciones-recientes?limit=100`,
  );

  return (
    <div className="space-y-6">
      <Surface variant="glass">
        <Surface.Header>
          <Surface.Title>Últimas Transacciones</Surface.Title>
          <Surface.Subtitle>
            Movimientos contables más recientes de la empresa con respaldos en
            Drive/Dropbox cuando están disponibles.
          </Surface.Subtitle>
        </Surface.Header>
      </Surface>

      <TransaccionesTable data={data} />
    </div>
  );
}
