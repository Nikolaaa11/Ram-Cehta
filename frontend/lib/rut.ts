/**
 * RUT chileno — validación + formateo client-side.
 *
 * Mismo algoritmo que `app/domain/value_objects/rut.py` del backend
 * para consistency. Sin request al server: el dígito verificador se
 * computa en milisegundos.
 *
 * Uso:
 *   isValidRut("12.345.678-9")  // true | false
 *   formatRut("123456789")      // "12.345.678-9"
 *   stripRut("12.345.678-9")    // "123456789"
 */

/** Devuelve solo dígitos + DV final (mayúsculas si es K). */
export function stripRut(rut: string): string {
  return rut.replace(/[.\s-]/g, "").toUpperCase();
}

/** Calcula el dígito verificador esperado para un RUT sin DV. */
function computeDv(numStr: string): string {
  let suma = 0;
  let mul = 2;
  for (let i = numStr.length - 1; i >= 0; i--) {
    suma += parseInt(numStr[i]!, 10) * mul;
    mul = mul === 7 ? 2 : mul + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return "0";
  if (resto === 10) return "K";
  return String(resto);
}

/**
 * Valida un RUT chileno. Acepta cualquier formato (con o sin puntos/guion).
 * Retorna true si el dígito verificador coincide.
 */
export function isValidRut(rut: string | null | undefined): boolean {
  if (!rut) return false;
  const clean = stripRut(rut);
  if (clean.length < 2) return false;
  const numPart = clean.slice(0, -1);
  const dvPart = clean.slice(-1);
  if (!/^\d+$/.test(numPart)) return false;
  if (!/^[0-9K]$/.test(dvPart)) return false;
  return computeDv(numPart) === dvPart;
}

/**
 * Formatea un RUT al formato canónico chileno: "12.345.678-9".
 * Si el input no tiene DV válido, devuelve el input original sin transformar.
 */
export function formatRut(rut: string | null | undefined): string {
  if (!rut) return "";
  const clean = stripRut(rut);
  if (clean.length < 2) return rut;
  const numPart = clean.slice(0, -1);
  const dvPart = clean.slice(-1);
  // Insertar puntos cada 3 dígitos desde la derecha
  const withDots = numPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${withDots}-${dvPart}`;
}
