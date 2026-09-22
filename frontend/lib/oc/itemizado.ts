/**
 * Cómo se muestra una línea de OC. Espejo de
 * backend/app/domain/value_objects/itemizado.py.
 *
 * Nicolás: "hay OC que no se están sumando bien". La ficha leía
 * `total_linea`, que el backend nunca guardaba (NULL en las 39 OC de
 * producción), así que imprimía "$0" en cada línea con el total correcto
 * abajo. El backend ya lo guarda y los datos viejos quedaron rellenados,
 * pero el fallback se queda: una línea sin importe se calcula, no se
 * muestra en cero.
 *
 * El redondeo delega en `redondearMonto` de lib/oc/totales.ts (HALF_UP
 * simétrico, como Python) para no tener dos redondeos distintos en el
 * front: `Math.round(-0,5)` en JavaScript da -0, y el backend da -1.
 */

import { decimalesDeMoneda, redondearMonto } from "@/lib/oc/totales";

export interface LineaOc {
  total_linea?: string | number | null;
  cantidad?: string | number | null;
  precio_unitario?: string | number | null;
}

/** Importe de la línea: el guardado, o cantidad x precio al paso de la moneda. */
export function importeLinea(it: LineaOc, moneda: string = "CLP"): number {
  if (it.total_linea != null && it.total_linea !== "") {
    const guardado = Number(it.total_linea);
    if (!Number.isNaN(guardado)) return guardado;
  }
  const cantidad = Number(it.cantidad ?? 1);
  const precio = Number(it.precio_unitario ?? 0);
  if (Number.isNaN(cantidad) || Number.isNaN(precio)) return 0;
  return redondearMonto(cantidad * precio, moneda);
}

/** Suma de la columna tal como se ve en pantalla. */
export function sumaItemizado(items: LineaOc[], moneda: string = "CLP"): number {
  return items.reduce((total, it) => total + importeLinea(it, moneda), 0);
}

/** Un importe de OC con el símbolo y los decimales de su moneda. */
export function montoLinea(valor: number, moneda: string = "CLP"): string {
  const m = (moneda || "CLP").toUpperCase();
  const decimales = decimalesDeMoneda(m);
  const num = valor.toLocaleString("es-CL", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
  if (m === "CLP") return `$${num}`;
  if (m === "USD") return `US$${num}`;
  return `${m} ${num}`;
}

/**
 * Precio unitario, con decimales SÓLO si los tiene (en pesos).
 *
 * Un precio neto sacado de un total con IVA es $67.142,86: redondeado a
 * $67.143, el que multiplica por la cantidad no llega al importe de la
 * línea. Con los decimales a la vista, la cuenta cuadra.
 */
export function precioUnitario(
  valor: string | number | null | undefined,
  moneda: string = "CLP",
): string {
  const n = Number(valor ?? 0);
  if (Number.isNaN(n)) return montoLinea(0, moneda);
  const m = (moneda || "CLP").toUpperCase();
  if (m !== "CLP") return montoLinea(n, m);
  const decimales = Number.isInteger(n) ? 0 : 2;
  return `$${n.toLocaleString("es-CL", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })}`;
}
