/**
 * Pegar ítems de OC desde Excel / Google Sheets.
 *
 * Nicolás pidió cargar los ítems "como si estuvieras añadiendo cosas a un
 * excel, que se pueda pegar todo más rápido". Cuando copiás celdas de Excel,
 * el portapapeles trae texto plano con TABS entre columnas y saltos de línea
 * entre filas. Esto lo interpreta.
 *
 * # POR QUÉ NO ALCANZA CON split("\t")
 *
 * Tres cosas rompen la versión ingenua, y las tres pasan con datos chilenos
 * reales:
 *
 *  1. **Los números vienen formateados.** Excel copia `$1.234.567` o
 *     `1.234.567,89`, no `1234567.89`. En Chile el punto es separador de
 *     MILES y la coma es el decimal — exactamente al revés que en inglés.
 *     Interpretar `1.234` como mil doscientos treinta y cuatro o como uno
 *     coma doscientos treinta y cuatro cambia el monto por mil.
 *  2. **Una celda con saltos de línea viene entre comillas.** Una descripción
 *     de dos renglones llega como `"Retiro de residuos\nsegún protocolo"`, y
 *     cortar por `\n` la parte en dos ítems rotos.
 *  3. **Puede venir la fila de encabezados.** Si el operador seleccionó
 *     también el título de la tabla, se cuela un ítem "Descripción / Precio".
 *
 * Funciones puras, sin React: se pueden probar sin montar nada.
 */

/** Una fila ya interpretada, en el formato del formulario (todo string). */
export interface ItemPegado {
  descripcion: string;
  unidad: string;
  precio_unitario: string;
  cantidad: string;
}

/**
 * Convierte un número escrito a la chilena en algo que `Number()` entiende.
 *
 * Reglas, en orden:
 *  - Se tiran símbolos de moneda, espacios y separadores invisibles.
 *  - Si hay coma Y punto, el que aparece MÁS A LA DERECHA es el decimal
 *    (`1.234,56` → coma; `1,234.56` → punto). Es la única regla que resuelve
 *    los dos formatos sin preguntar de qué locale vino.
 *  - Si hay UNA sola coma, es decimal: en Chile nadie usa la coma para miles.
 *  - Si hay UN solo punto, es ambiguo: `1.234` son mil doscientos treinta y
 *    cuatro pesos, pero `1.5` es uno y medio. Se resuelve por la cantidad de
 *    dígitos que siguen — exactamente 3 ⇒ miles, cualquier otra ⇒ decimal.
 *    `1.50` (2 dígitos) es un decimal; `1.234` (3) son miles.
 *  - Varios puntos ⇒ todos son miles (`1.234.567`).
 *
 * Devuelve "" si no queda ningún dígito, para que el campo se vea vacío en
 * vez de mostrar NaN o un 0 que nadie escribió.
 */
export function normalizarNumero(crudo: string): string {
  if (!crudo) return "";
  // Símbolos de moneda, espacios normales y duros, y comillas de Excel.
  let t = crudo.replace(/[$€£\s "']/g, "").trim();
  if (!t) return "";

  const negativo = t.startsWith("-");
  t = t.replace(/^[+-]/, "");
  if (!/\d/.test(t)) return "";

  const ultimaComa = t.lastIndexOf(",");
  const ultimoPunto = t.lastIndexOf(".");

  let decimal = "";
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    decimal = ultimaComa > ultimoPunto ? "," : ".";
  } else if (ultimaComa >= 0) {
    decimal = ",";
  } else if (ultimoPunto >= 0) {
    const digitosDespues = t.length - ultimoPunto - 1;
    const puntos = (t.match(/\./g) ?? []).length;
    // Un solo punto seguido de exactamente 3 dígitos es separador de miles
    // ("1.234"). Cualquier otra cantidad de dígitos es un decimal ("1.5",
    // "1.50", "1.2345"). Con más de un punto, todos son miles.
    decimal = puntos === 1 && digitosDespues !== 3 ? "." : "";
  }

  let entero: string;
  let fraccion = "";
  if (decimal) {
    const corte = t.lastIndexOf(decimal);
    entero = t.slice(0, corte);
    fraccion = t.slice(corte + 1);
  } else {
    entero = t;
  }
  entero = entero.replace(/[.,]/g, "");
  fraccion = fraccion.replace(/[^\d]/g, "");

  if (!entero && !fraccion) return "";
  const signo = negativo ? "-" : "";
  return fraccion ? `${signo}${entero || "0"}.${fraccion}` : `${signo}${entero}`;
}

/**
 * Quita los decimales que no aportan: "1.00" → "1", "2.50" → "2.5".
 *
 * Nicolás: "que si no tienen decimales se vea solo el número". La API
 * devuelve NUMERIC, así que una cantidad de 1 vuelve como "1.0000" y llenaba
 * el campo de ceros.
 */
export function limpiarCeros(valor: string): string {
  if (!valor || !valor.includes(".")) return valor;
  const limpio = valor.replace(/0+$/, "").replace(/\.$/, "");
  return limpio === "" || limpio === "-" ? "0" : limpio;
}

/**
 * Parte una línea pegada respetando las comillas de Excel.
 *
 * Excel encierra entre comillas cualquier celda que contenga el separador o
 * un salto de línea, y escapa las comillas internas duplicándolas.
 */
function partirLinea(linea: string, sep: string): string[] {
  const celdas: string[] = [];
  let actual = "";
  let dentroDeComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (dentroDeComillas && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        dentroDeComillas = !dentroDeComillas;
      }
    } else if (c === sep && !dentroDeComillas) {
      celdas.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  celdas.push(actual);
  return celdas;
}

/**
 * Separa el texto pegado en filas, sin cortar dentro de una celda entre
 * comillas (una descripción de varios renglones es UNA fila).
 */
function partirFilas(texto: string): string[] {
  const filas: string[] = [];
  let actual = "";
  let dentroDeComillas = false;
  const t = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"') {
      if (dentroDeComillas && t[i + 1] === '"') {
        actual += '""';
        i++;
      } else {
        dentroDeComillas = !dentroDeComillas;
        actual += c;
      }
    } else if (c === "\n" && !dentroDeComillas) {
      filas.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  if (actual) filas.push(actual);
  return filas;
}

/** ¿Esta fila es el encabezado de la tabla y no un ítem? */
function esEncabezado(celdas: string[]): boolean {
  const texto = celdas.join(" ").toLowerCase();
  const rotulos = [
    "descripcion",
    "descripción",
    "detalle",
    "glosa",
    "precio",
    "p. unit",
    "unitario",
    "cantidad",
    "cant.",
    "unidad",
    "item",
    "ítem",
  ];
  const aciertos = rotulos.filter((r) => texto.includes(r)).length;
  // Dos o más rótulos y ninguna cifra: es el encabezado, no un ítem cuya
  // descripción casualmente diga "cantidad".
  return aciertos >= 2 && !/\d/.test(texto);
}

/**
 * Interpreta lo pegado desde Excel.
 *
 * Columnas esperadas, en este orden: **Descripción · Cantidad · Unidad ·
 * Precio unitario**. Es el orden en que están los campos en pantalla, para
 * que armar la planilla sea copiar lo que se ve.
 *
 * Tolera de 1 a 4 columnas: con una sola, todo es descripción. Las que
 * falten quedan vacías y la persona las completa.
 *
 * Si una sola línea sin tabs viene pegada, NO se interpreta como ítem
 * (devuelve lista vacía): es el caso de alguien pegando una palabra dentro
 * de un campo, y ahí el pegado normal del navegador tiene que ganar.
 */
export function parsearItemsPegados(texto: string): ItemPegado[] {
  if (!texto || !texto.trim()) return [];

  const hayTabs = texto.includes("\t");
  const hayVariasFilas = /\n/.test(texto.trim());
  // Sin tabs y de una sola línea es un pegado común y corriente: que lo
  // maneje el navegador.
  if (!hayTabs && !hayVariasFilas) return [];

  // Excel usa TAB. Un CSV exportado usa ";" en configuración regional
  // chilena. Se elige el que realmente aparezca.
  const sep = hayTabs ? "\t" : texto.includes(";") ? ";" : "\t";

  const items: ItemPegado[] = [];
  for (const linea of partirFilas(texto)) {
    if (!linea.trim()) continue;
    const celdas = partirLinea(linea, sep).map((c) => c.trim());
    if (esEncabezado(celdas)) continue;

    const [descripcion = "", cantidad = "", unidad = "", precio = ""] = celdas;
    const desc = descripcion.trim();
    const cant = limpiarCeros(normalizarNumero(cantidad));
    const prec = limpiarCeros(normalizarNumero(precio));

    // Fila completamente vacía: se saltea en vez de crear un ítem fantasma.
    if (!desc && !cant && !prec && !unidad.trim()) continue;

    items.push({
      descripcion: desc,
      // La unidad es texto libre; si en esa columna vino un número, es que
      // el orden de columnas no era el esperado. Se deja vacía antes que
      // poner "50" como unidad de medida.
      unidad: /^\d+([.,]\d+)?$/.test(unidad.trim()) ? "" : unidad.trim(),
      precio_unitario: prec,
      cantidad: cant,
    });
  }
  return items;
}
