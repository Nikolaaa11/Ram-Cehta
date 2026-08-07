// Nombre de archivo canónico del PDF de una Orden de Compra.
//
// ESPEJO EXACTO de backend/app/services/oc_filename_util.py — si cambiás una
// regla acá, cambiala allá (y al revés). No es cosmética: las descargas de OC
// van por blob y `a.download` PISA el Content-Disposition del backend, así que
// si divergen el usuario ve SIEMPRE el nombre del frontend y el del backend
// queda como mentira muerta. Antes divergían: los dos armaban `oc-...` en
// minúscula y los dos duplicaban el prefijo sobre números que ya empiezan con
// "OC" (quedaba 'oc-OC0041-....pdf').
//
// Reglas (idénticas al backend):
//  1. Siempre empieza con "OC" en MAYÚSCULA.
//  2. Si el número ya empieza con "OC" no se duplica el prefijo, solo se
//     normaliza a mayúscula. "Empieza con OC" = OC seguido de algo que no sea
//     letra, para no confundir 'OCTUBRE-01' con el prefijo.
//  3. Se sanitizan los caracteres ilegales de Windows (\ / : * ? " < > | y los
//     de control) — el numero_oc lo tipea el usuario.
//  4. Los espacios colapsan a "_" (hay números reales con espacios, ej.
//     'OC0041-PAN001-Comercializadora los Canelos jv').

// Set + charCodeAt en vez de una regex con rangos \u00xx: el rango de control
// dentro de una clase de caracteres es justo lo que más se rompe al copiar
// este archivo entre herramientas, y así queda legible.
const INVALID_FS_CHARS = new Set(["\\", "/", ":", "*", "?", '"', "<", ">", "|"]);

function sanitizeFsChars(value: string): string {
  return Array.from(value, (ch) =>
    INVALID_FS_CHARS.has(ch) || ch.charCodeAt(0) < 32 ? "-" : ch,
  ).join("");
}

// Clase ENUMERADA y no `\s`: `\s` no significa lo mismo en JavaScript que en
// Python, y este archivo tiene que producir exactamente el mismo nombre que
// backend/app/services/oc_filename_util.py (si difieren, el adjunto del mail y
// el archivo descargado quedan con nombres distintos). JS matchea U+FEFF y no
// U+0085; Python al revés. Los dos aparecen en la vida real: U+FEFF viene de un
// pegado desde Excel/CSV con BOM y U+0085 de un "…" mal decodificado como
// latin-1. Mantener sincronizado con `_WHITESPACE` del helper de Python.
const WHITESPACE = /[ \t\n\r\f\v\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+/g;
// "OC" al inicio solo si NO lo sigue una letra (el flag `i` también aplica a
// la clase del lookahead, así que cubre mayúsculas y minúsculas).
const OC_PREFIX = /^oc(?![a-z])/i;
// Basura de borde: Windows no tolera punto ni espacio final.
const EDGE_JUNK = /^[_\-. ]+|[_\-. ]+$/g;
const MAX_STEM = 120;
const FALLBACK_STEM = "OC";

function ocStem(numeroOc: string | number | null | undefined): string {
  // Chequeo explícito de null/undefined, no `||`: un numero_oc 0 es legítimo
  // y con `||` lo perderíamos.
  const raw =
    numeroOc === null || numeroOc === undefined ? "" : String(numeroOc).trim();
  if (!raw) return FALLBACK_STEM;

  let core = sanitizeFsChars(raw).replace(WHITESPACE, "_");
  core = core.replace(EDGE_JUNK, "");
  if (!core) return FALLBACK_STEM;

  // Ya trae el prefijo: no lo duplicamos, solo lo forzamos a mayúscula.
  const stem = OC_PREFIX.test(core) ? `OC${core.slice(2)}` : `OC-${core}`;
  return stem.slice(0, MAX_STEM).replace(EDGE_JUNK, "") || FALLBACK_STEM;
}

/**
 * Nombre del PDF de la OC tal como lo ve el usuario al descargarlo.
 *
 * ocPdfFilename("OC-FLUJO-COMPLETO-9901") → "OC-FLUJO-COMPLETO-9901.pdf"
 * ocPdfFilename("1234")                   → "OC-1234.pdf"
 */
export function ocPdfFilename(
  numeroOc: string | number | null | undefined,
): string {
  return `${ocStem(numeroOc)}.pdf`;
}
