import { Surface } from "@/components/ui/surface";
import { serverApiGet } from "@/lib/api/server";
import { FlujoMensualChart } from "@/components/empresa/FlujoMensualChart";
import type { FlujoMensualPoint } from "@/lib/api/schema";

/**
 * Flujo Mensual de una empresa — V3 fase 6.
 *
 * Time series Real + Proyectado de los últimos 12 meses con tres vistas
 * tabuladas: Real (área), Proyectado (línea punteada) y Acumulado (saldo).
 */
export default async function FlujoMensualPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = await params;
  const points = await serverApiGet<FlujoMensualPoint[]>(
    `/empresa/${codigo}/flujo-mensual?meses=12`,
  );

  return (
    <div className="space-y-6">
      <Surface variant="glass">
        <Surface.Header>
          <Surface.Title>Flujo Mensual</Surface.Title>
          <Surface.Subtitle>
            Abonos, egresos, flujo neto y saldo acumulado por período tributario.
          </Surface.Subtitle>
        </Surface.Header>
      </Surface>

      <FlujoMensualChart data={points} />
    </div>
  );
}
