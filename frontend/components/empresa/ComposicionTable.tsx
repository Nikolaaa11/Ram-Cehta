import { Surface } from "@/components/ui/surface";
import { toCLP } from "@/lib/format";
import { cn } from "@/lib/utils";
import { netoTone, tipoStyle } from "@/lib/empresa/colors";
import type { ComposicionRow } from "@/lib/api/schema";

/**
 * Tabla "Composición Completa CC" con dot de color por categoría, montos
 * tabular-nums y badges de tipo (Capital/Operacional/Tesoreria/Ajuste/Financiero).
 *
 * El neto colorea automáticamente: positivo en verde, negativo en rojo, cero
 * en gris. El frontend NO calcula nada — sólo presenta lo que el backend ya
 * agregó.
 */
export function ComposicionTable({ rows }: { rows: ComposicionRow[] }) {
  if (rows.length === 0) {
    return (
      <Surface>
        <Surface.Header>
          <Surface.Title>Composición Completa CC</Surface.Title>
          <Surface.Subtitle>Sin movimientos registrados.</Surface.Subtitle>
        </Surface.Header>
      </Surface>
    );
  }

  return (
    <Surface aria-label="Composición Completa CC">
      <Surface.Header>
        <Surface.Title>Composición Completa CC</Surface.Title>
        <Surface.Subtitle>
          Egresos, abonos y neto por categoría · {rows.length}{" "}
          {rows.length === 1 ? "fila" : "filas"}
        </Surface.Subtitle>
      </Surface.Header>
      <Surface.Body className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-[11px] font-medium uppercase tracking-wide text-ink-500">
              <th className="py-2 pr-4 font-medium">Categoría</th>
              <th className="py-2 pr-4 text-right font-medium">Egresos</th>
              <th className="py-2 pr-4 text-right font-medium">Abonos</th>
              <th className="py-2 pr-4 text-right font-medium">Neto</th>
              <th className="py-2 pr-4 font-medium">Tipo</th>
              <th className="py-2 text-right font-medium">Mov.</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((row) => {
              const style = tipoStyle(row.tipo);
              const netoVal = Number(row.neto);
              const netoStyle = netoTone(netoVal);
              return (
                <tr
                  key={row.categoria}
                  className="transition-colors duration-150 ease-apple hover:bg-ink-100/30"
                >
                  <td className="py-3 pr-4">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className={cn(
                          "inline-block h-2 w-2 shrink-0 rounded-full",
                          style.dot,
                        )}
                        aria-hidden
                      />
                      <span className="text-ink-900">{row.categoria}</span>
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink-900">
                    {toCLP(row.egresos)}
                  </td>
                  <td className="py-3 pr-4 text-right tabular-nums text-ink-900">
                    {toCLP(row.abonos)}
                  </td>
                  <td
                    className={cn(
                      "py-3 pr-4 text-right tabular-nums font-medium",
                      netoStyle.className,
                    )}
                  >
                    {netoStyle.prefix}
                    {toCLP(netoVal)}
                  </td>
                  <td className="py-3 pr-4">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium tracking-tight",
                        style.badge,
                      )}
                    >
                      {style.label}
                    </span>
                  </td>
                  <td className="py-3 text-right tabular-nums text-ink-500">
                    {row.transaction_count}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Surface.Body>
    </Surface>
  );
}
