/**
 * Helpers de extracción de datos desde texto libre (cuerpo de emails,
 * descripciones, etc.). Útil para pre-llenar forms en V5+ con info que
 * la AI sugirió.
 *
 * No reemplaza al document analyzer del backend (que usa Claude para
 * facturas PDF). Estos helpers son heurísticos rápidos sin LLM:
 *   - extractMontoFromText: busca el primer monto CLP plausible
 *   - extractRutFromText:   busca el primer RUT chileno bien formateado
 */
import { isValidRut } from "./rut";

/**
 * Extrae el primer monto en pesos chilenos del texto.
 *
 * Soporta:
 *   - "$1.234.567"  → 1234567
 *   - "$ 1.500.000" → 1500000
 *   - "CLP 850.000" → 850000
 *   - "850000"      → 850000  (si está aislado)
 *   - "$1.000"      → 1000
 *
 * Retorna `null` si no encuentra un monto plausible. Cap a 9 dígitos
 * (max ~$999M CLP) para evitar matchear años o IDs.
 */
export function extractMontoFromText(text: string | null | undefined): number | null {
  if (!text) return null;
  // Patrón: opcional $/CLP, luego dígitos con puntos como separador miles.
  // Cap a 9 dígitos integer para no matchear años (4 dígitos) o IDs largos.
  const re = /(?:\$|CLP)\s?([\d]{1,3}(?:\.\d{3}){0,3})\b/g;
  const match = re.exec(text);
  if (match) {
    const numStr = match[1]!.replace(/\./g, "");
    const n = parseInt(numStr, 10);
    if (!Number.isNaN(n) && n >= 1000 && n <= 999_999_999) {
      return n;
    }
  }
  // Fallback: número aislado de 4-9 dígitos sin separadores
  const re2 = /\b(\d{5,9})\b/;
  const m2 = re2.exec(text);
  if (m2) {
    const n = parseInt(m2[1]!, 10);
    if (!Number.isNaN(n) && n >= 10000) return n;
  }
  return null;
}

/**
 * Extrae el primer RUT chileno válido del texto.
 *
 * Acepta formatos:
 *   - "12.345.678-9"
 *   - "12345678-9"
 *   - "RUT: 12345678-K"
 *
 * Retorna el RUT formateado canónicamente (`12.345.678-9`) o `null`
 * si no encuentra ninguno con DV válido.
 */
export function extractRutFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const re = /\b(\d{1,2}\.?\d{3}\.?\d{3}[-\s]?[\dKk])\b/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const candidate = match[1]!;
    if (isValidRut(candidate)) {
      // Devolver formato canónico
      const clean = candidate.replace(/[.\s-]/g, "").toUpperCase();
      const numPart = clean.slice(0, -1);
      const dv = clean.slice(-1);
      const withDots = numPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
      return `${withDots}-${dv}`;
    }
  }
  return null;
}

/**
 * Extrae el primer folio de factura del texto. Busca patrones como:
 *   - "Factura 1234"
 *   - "Boleta N° 5678"
 *   - "Folio: 9876"
 *   - "OC-001234"
 *
 * Retorna el número como string (preserva ceros a la izquierda) o null.
 */
export function extractFolioFromText(text: string | null | undefined): string | null {
  if (!text) return null;
  const re = /(?:factura|boleta|folio|oc[\s-]?n[°º\.]?)\s*[:#\-]?\s*(\d{3,8})/i;
  const m = re.exec(text);
  return m ? m[1]! : null;
}
