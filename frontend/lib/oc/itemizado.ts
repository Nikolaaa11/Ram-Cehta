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
 */

export interface LineaOc {
  total_linea?: string | number | null;
  cantidad?: string | number | null;
  precio_unitario?: string | number | null;
}

/** Importe de la línea: el guardado, o cantidad x precio redondeado a peso. */
export function importeLinea(it: LineaOc): number {
  if (it.total_linea != null && it.total_linea !== "") {
    const guardado = Number(it.total_linea);
    if (!Number.isNaN(guardado)) return guardado;
  }
  const cantidad = Number(it.cantidad ?? 1);
  const precio = Number(it.precio_unitario ?? 0);
  if (Number.isNaN(cantidad) || Number.isNaN(precio)) return 0;
  return Math.round(cantidad * precio);
}

/** Suma de la columna tal como se ve en pantalla. */
export function sumaItemizado(items: LineaOc[]): number {
  return items.reduce((total, it) => total + importeLinea(it), 0);
}

/**
 * Precio unitario en pesos, con dos decimales SÓLO si los tiene.
 *
 * Un precio neto sacado de un total con IVA es $67.142,86: redondeado a
 * $67.143, el que multiplica por la cantidad no llega al importe de la
 * línea. Con los decimales a la vista, la cuenta cuadra.
 */
export function precioUnitario(valor: string | number | null | undefined): string {
  const n = Number(valor ?? 0);
  if (Number.isNaN(n)) return "$0";
  const decimales = Number.isInteger(n) ? 0 : 2;
  return `$${n.toLocaleString("es-CL", {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  })}`;
}
