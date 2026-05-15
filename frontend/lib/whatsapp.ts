/**
 * WhatsApp helpers — Round 8 QA marathon.
 *
 * Genera links `wa.me/{phone}?text=...` para abrir WhatsApp con un
 * mensaje pre-llenado. Sin API ni costos — abre la app del browser /
 * mobile del usuario.
 *
 * Patron de uso:
 *   const link = buildWaLink(proveedor.telefono, `Hola ${proveedor.contacto},
 *     te escribimos sobre la OC #${codigo}...`);
 *   <a href={link} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
 */

/** Normaliza un número chileno al formato internacional (+56 9 XXXXXXXX). */
export function normalizeChileanPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Strip all non-digits
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  // Si ya empieza con 56 (Chile), usar tal cual
  if (digits.startsWith("56") && digits.length >= 11) return digits;
  // Si es 9XXXXXXXX (celular chileno sin código país), prefijar 56
  if (digits.length === 9 && digits.startsWith("9")) return "56" + digits;
  // Si es 8 dígitos (sin el 9 al inicio), prefijar 569
  if (digits.length === 8) return "569" + digits;
  // Otros casos (fijo, internacional ya formateado): devolver tal cual
  return digits;
}

/**
 * Construye un link wa.me con phone normalizado y texto encoded.
 *
 * Retorna null si el phone es inválido — el caller debe esconder el
 * botón en ese caso.
 *
 * @param phone - número en cualquier formato (con/sin código, con guiones, etc.)
 * @param text - mensaje pre-llenado (será URL-encoded)
 */
export function buildWaLink(
  phone: string | null | undefined,
  text: string,
): string | null {
  const normalized = normalizeChileanPhone(phone);
  if (!normalized) return null;
  const encoded = encodeURIComponent(text);
  return `https://wa.me/${normalized}?text=${encoded}`;
}

/**
 * Templates pre-armados para casos de uso comunes.
 * El caller pasa los datos y obtiene el mensaje listo para encode.
 */
export const waMessages = {
  contactarProveedor: (params: {
    contacto?: string | null;
    asunto: string;
  }) => {
    const saludo = params.contacto ? `Hola ${params.contacto}` : "Hola";
    return `${saludo}, te escribimos de Cehta Capital sobre ${params.asunto}. ¿Tenés un minuto para revisar?`;
  },

  confirmarTransferencia: (params: {
    nombre?: string | null;
    monto: number;
    codigo: string;
    glosa?: string;
  }) => {
    const saludo = params.nombre ? `Hola ${params.nombre}` : "Hola";
    const montoStr = params.monto.toLocaleString("es-CL");
    const glosaStr = params.glosa ? ` (${params.glosa})` : "";
    return `${saludo}, te confirmamos transferencia por $${montoStr} CLP correspondiente al voucher ${params.codigo}${glosaStr}. Gracias.`;
  },

  recordatorioVencimiento: (params: {
    contacto?: string | null;
    numero: string;
    vencimiento: string;
  }) => {
    const saludo = params.contacto ? `Hola ${params.contacto}` : "Hola";
    return `${saludo}, te recordamos que la factura ${params.numero} vence el ${params.vencimiento}. ¿Podés confirmar el pago?`;
  },

  compartirInformeLP: (params: {
    nombre?: string | null;
    periodo: string;
    url: string;
  }) => {
    const saludo = params.nombre ? `Hola ${params.nombre}` : "Hola";
    return `${saludo}, te compartimos el informe del fondo del ${params.periodo}. Podés verlo acá: ${params.url}`;
  },
};
