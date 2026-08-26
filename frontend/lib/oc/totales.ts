/**
 * Los totales tributarios de una OC, calculados igual que en el servidor.
 *
 * # POR QUÉ EXISTE ESTE ARCHIVO
 *
 * Las dos pantallas de IA calculaban su vista previa así:
 *
 *     const iva = moneda === "CLP" ? neto * 0.19 : 0;
 *
 * Dos cosas mal. El 19 % está clavado, ignorando `iva_porcentaje`, que es
 * editable por OC. Y sobre todo: el servidor aplica IVA **también a la UF**
 * —es una unidad de cuenta chilena, no moneda extranjera— así que una OC en
 * UF mostraba IVA 0 en pantalla y salía con 19 % en el PDF. Ése es el
 * "los cálculos no me cuadran" que reportó el equipo.
 *
 * Corregir el literal no alcanzaba: vuelve a divergir en el próximo cambio.
 * Esta implementación está atada al backend por un snapshot compartido
 * (`backend/tests/fixtures/oc_totales_esperado.json`) que verifican las dos
 * suites. Si alguien toca una regla de un solo lado, una de las dos falla.
 *
 * La AUTORIDAD es `_derivar_totales_oc` en el backend. Acá se la espeja.
 *
 * # POR QUÉ NO SE USA `number`
 *
 * Es plata. `0.1 + 0.2 !== 0.3`, y el redondeo del IVA es HALF_UP sobre el
 * paso de la moneda: un error de un ulp justo en el límite cambia el impuesto
 * en un peso, y esa diferencia después no cuadra contra el PDF ni contra el
 * asiento contable. Todo va en enteros escalados con BigInt.
 */

/** Escala interna: 10 decimales alcanzan para 19 % y 15,25 % sin pérdida. */
const ESCALA = 10n ** 10n;

/** Un decimal exacto: `valor` es el número × 10^10. */
type Dec = bigint;

/** Texto -> Dec. Acepta "1.234,56" y "1234.56"; vacío o basura dan 0. */
export function aDec(v: string | number | null | undefined): Dec {
  if (v === null || v === undefined) return 0n;
  let t = String(v).trim();
  if (!t) return 0n;
  // Sólo se aceptan formas ya normalizadas (punto decimal). El texto que
  // teclea el operador pasa antes por `normalizarNumero` de pegar-items.ts.
  t = t.replace(/,/g, ".");
  const negativo = t.startsWith("-");
  if (negativo) t = t.slice(1);
  if (!/^\d*\.?\d*$/.test(t) || t === "" || t === ".") return 0n;

  const [ent = "", frac = ""] = t.split(".");
  // Se RECORTA la fracción a 10 dígitos en vez de redondearla: el redondeo
  // ocurre una sola vez, al final y sobre el paso de la moneda. Redondear
  // acá metería un segundo redondeo invisible.
  const fracPad = (frac + "0".repeat(10)).slice(0, 10);
  const magnitud = BigInt(ent || "0") * ESCALA + BigInt(fracPad);
  return negativo ? -magnitud : magnitud;
}

/** Dec -> texto, con `decimales` fijos. Sin notación científica. */
function aTexto(d: Dec, decimales: number): string {
  const negativo = d < 0n;
  const abs = negativo ? -d : d;
  const ent = abs / ESCALA;
  const frac = (abs % ESCALA).toString().padStart(10, "0").slice(0, decimales);
  const signo = negativo ? "-" : "";
  return decimales > 0 ? `${signo}${ent}.${frac}` : `${signo}${ent}`;
}

/**
 * Redondeo HALF_UP al paso de la moneda — el mismo que `Decimal.quantize`
 * con `ROUND_HALF_UP` en Python.
 *
 * `decimales` es 0 en pesos y 2 en UF/USD. HALF_UP y no el redondeo bancario
 * de JavaScript: `Math.round` es half-up sólo para positivos y el backend usa
 * HALF_UP siempre.
 */
function redondear(d: Dec, decimales: number): Dec {
  const factor = 10n ** BigInt(10 - decimales);
  const negativo = d < 0n;
  const abs = negativo ? -d : d;
  const resto = abs % factor;
  let salida = abs - resto;
  // `>= mitad` sube: eso es HALF_UP. Con `>` sería HALF_DOWN y el IVA de
  // ciertos montos saldría un peso abajo del que imprime el PDF.
  if (resto * 2n >= factor) salida += factor;
  return negativo ? -salida : salida;
}

/** Multiplicación exacta de dos Dec. */
function mul(a: Dec, b: Dec): Dec {
  return (a * b) / ESCALA;
}

// ---------------------------------------------------------------------------
// Las reglas — espejo de app/domain/value_objects/retencion.py
// ---------------------------------------------------------------------------

export type TipoDocumentoOC =
  | "FACTURA"
  | "FACTURA_EXENTA"
  | "BOLETA"
  | "HONORARIOS";

/** Los tipos que admiten IVA. Exenta y honorarios no. */
const TIPOS_AFECTOS: readonly string[] = ["FACTURA", "BOLETA"];
/** El único que admite retención de segunda categoría. */
const TIPOS_CON_RETENCION: readonly string[] = ["HONORARIOS"];
/**
 * Monedas sobre las que la API calcula IVA.
 *
 * La UF **sí** entra: es una unidad de cuenta chilena (pesos indexados), no
 * moneda extranjera, y una OC pactada en UF es una operación afecta. El dólar
 * queda afuera a propósito — exportación/importación tiene otro tratamiento.
 */
const MONEDAS_AFECTAS: readonly string[] = ["CLP", "UF"];

export interface EntradaTotales {
  /** Suma del itemizado: Σ(cantidad × precio unitario). En honorarios, BRUTO. */
  neto: string | number;
  moneda: string;
  tipoDocumento: string;
  ivaPorcentaje: string | number;
  retencionPorcentaje: string | number;
}

export interface TotalesOC {
  /** Los seis, como texto exacto. Nunca `number`: es plata. */
  neto: string;
  ivaPorcentaje: string;
  iva: string;
  total: string;
  retencionPorcentaje: string;
  retencionMonto: string;
  /** Lo que efectivamente se transfiere. En honorarios, total − retención. */
  totalAPagar: string;
}

/** Decimales de la moneda: el peso no tiene centavos, la UF y el dólar sí. */
export function decimalesDeMoneda(moneda: string): number {
  return (moneda || "CLP").toUpperCase() === "CLP" ? 0 : 2;
}

/**
 * Los totales de una OC.
 *
 * Espeja `_derivar_totales_oc`. Devuelve strings porque son los mismos que
 * verifica el snapshot compartido: convertirlos a `number` para mostrarlos es
 * responsabilidad de quien pinta, y ahí un error de un ulp ya no cambia plata.
 *
 * No lanza: una pantalla de vista previa no puede romperse porque el operador
 * dejó un campo a medio escribir. Las combinaciones que el backend rechaza
 * con 422 (retención en una factura afecta) acá se normalizan igual que allá
 * —la retención baja a 0— y el 422 llega recién al confirmar, que es donde
 * corresponde.
 */
export function calcularTotalesOC(e: EntradaTotales): TotalesOC {
  const tipo = (e.tipoDocumento || "FACTURA").toUpperCase();
  const moneda = (e.moneda || "CLP").toUpperCase();
  const decimales = decimalesDeMoneda(moneda);

  // 1. La regla de la moneda se aplica sobre el PORCENTAJE, no sobre el monto.
  //    Si se pisara el monto, la fila quedaría con `iva_porcentaje = 19` e
  //    `iva = 0` y el PDF imprimiría "IVA 19% ......... 0".
  const ivaPedido = MONEDAS_AFECTAS.includes(moneda)
    ? aDec(e.ivaPorcentaje)
    : 0n;

  // 2. Normalización de tasas por tipo de documento.
  const ivaEfectivo = TIPOS_AFECTOS.includes(tipo) ? ivaPedido : 0n;
  const retEfectiva = TIPOS_CON_RETENCION.includes(tipo)
    ? aDec(e.retencionPorcentaje)
    : 0n;

  // 3. El peso no tiene centavos: el neto se redondea ANTES de calcular, y
  //    ese valor redondeado es el que se persiste. Sin esto quedaba un neto
  //    con centavos y un total entero, o sea la fila contradiciendo la
  //    identidad total = neto + iva.
  let neto = aDec(e.neto);
  if (moneda === "CLP") neto = redondear(neto, 0);

  // 4. Los montos.
  const cien = aDec("100");
  const iva = redondear(mul(neto, (ivaEfectivo * ESCALA) / cien), decimales);
  const total = neto + iva;
  // La retención va sobre el BRUTO (= el neto), no sobre el total con IVA. En
  // honorarios son el mismo número porque el IVA es 0, pero escribirlo sobre
  // el neto deja explícita cuál es la base imponible.
  const retencionMonto = redondear(
    mul(neto, (retEfectiva * ESCALA) / cien),
    decimales,
  );
  // El líquido sale por RESTA: así `total_a_pagar + retencion == total`
  // cierra exacto siempre, sin depender de dos redondeos independientes.
  const totalAPagar = total - retencionMonto;

  // Los porcentajes se emiten como los emite Python: sin ceros de relleno
  // (`19`, `12.5`, `15.25`), que es lo que guarda el snapshot.
  const pct = (d: Dec): string => {
    const t = aTexto(d, 10).replace(/0+$/, "").replace(/\.$/, "");
    return t === "" || t === "-" ? "0" : t;
  };

  // Cuántos decimales lleva cada cifra. NO es "los de la moneda": se espeja
  // cómo se comporta `Decimal` en Python, porque el snapshot compartido
  // guarda el texto exacto que produce el backend.
  //
  //   · `neto` conserva los decimales del DATO DE ENTRADA (Decimal preserva
  //     el exponente). Un neto de "1000" en UF sigue siendo "1000", no
  //     "1000.00"; y si el itemizado sumó 1234,567 UF, el neto guarda sus
  //     tres decimales — el backend sólo cuantiza en CLP.
  //   · `total` = neto + iva, y sumar dos Decimal deja el exponente MÁS
  //     fino de los dos: max(decimales del neto, decimales de la moneda).
  const netoDec = moneda === "CLP" ? 0 : contarDecimales(e.neto);
  const totalDec = Math.max(netoDec, decimales);

  return {
    neto: aTexto(neto, netoDec),
    ivaPorcentaje: pct(ivaEfectivo),
    iva: aTexto(iva, decimales),
    total: aTexto(total, totalDec),
    retencionPorcentaje: pct(retEfectiva),
    retencionMonto: aTexto(retencionMonto, decimales),
    // total − retención: mismo exponente que el total, por la misma regla.
    totalAPagar: aTexto(totalAPagar, totalDec),
  };
}

/**
 * Cuántos decimales trae escritos un número.
 *
 * El backend NO cuantiza el neto fuera de CLP: si el itemizado suma
 * 1234,567 UF, el neto queda con sus TRES decimales y el total también
 * (1469,137). Sólo el IVA y la retención se redondean al paso de la moneda.
 * Y al revés: un neto de "1000" en UF sigue imprimiéndose "1000", no
 * "1000.00" — `Decimal` en Python conserva el exponente del dato original.
 */
function contarDecimales(neto: string | number): number {
  const t = String(neto ?? "").trim().replace(/,/g, ".");
  const punto = t.indexOf(".");
  if (punto < 0) return 0;
  return Math.min(t.length - punto - 1, 10);
}

/**
 * Suma del itemizado: Σ(cantidad × precio unitario), exacta.
 *
 * Es la "B" del contrato — la base de todo lo demás. Se calcula acá y no con
 * `reduce` sobre floats por la misma razón que el resto del archivo.
 */
export function sumarItemizado(
  items: readonly { cantidad: string | number; precio_unitario: string | number }[],
): string {
  let acc = 0n;
  for (const it of items) {
    acc += mul(aDec(it.cantidad), aDec(it.precio_unitario));
  }
  // 10 decimales y después se recorta lo que no aporta: el consumidor manda
  // esto a `calcularTotalesOC`, que redondea según la moneda.
  const t = aTexto(acc, 10).replace(/0+$/, "").replace(/\.$/, "");
  return t === "" || t === "-" ? "0" : t;
}
