/**
 * Registro central de ayuda contextual — Round 152i.
 *
 * Mapea cada ruta de la plataforma a un instructivo corto y práctico.
 * El HelpButton flotante lee el pathname actual y muestra el match más
 * específico. 100% aditivo: agregar/editar ayuda acá NO toca ninguna página.
 *
 * Para agregar ayuda a un módulo nuevo: añadí una entrada al array HELP_ENTRIES
 * con su `match` (prefijo de ruta), título, qué es, pasos y tips.
 */

export interface HelpEntry {
  /** Prefijo de ruta. El match más largo gana (ej. "/vouchers/corfo" > "/vouchers"). */
  match: string;
  title: string;
  /** Qué es / para qué sirve — 1-2 frases. */
  what: string;
  /** Pasos prácticos (cómo se usa). */
  steps?: string[];
  /** Tips o advertencias. */
  tips?: string[];
  /** Link a la guía HTML completa relevante. */
  guide?: { label: string; href: string };
}

export const HELP_ENTRIES: HelpEntry[] = [
  // ─── Vouchers (más específicos primero) ─────────────────────────────
  {
    match: "/vouchers/corfo",
    title: "Voucher CORFO",
    what: "Formulario dedicado al subsidio CORFO 2026 ($3.000MM) de REVTECH y TRONGKAI, con reparto editable CORFO/P-tec/Empresa.",
    steps: [
      "Elegí la empresa coejecutora (REVTECH o TRONGKAI).",
      "Bifurcá según Factura Electrónica o Factura Afecta.",
      "Ajustá el reparto % entre CORFO / P-tec / Empresa.",
      "El IVA siempre se imputa a la corporativa, no al subsidio.",
    ],
    tips: ["El dashboard de 'dónde están las platas' está en Admin → Subsidio CORFO."],
    guide: { label: "Guía de Vouchers", href: "/ayuda/vouchers.html#corfo" },
  },
  {
    match: "/vouchers/importar",
    title: "Importar voucher desde archivo (IA)",
    what: "Subí una factura (foto, PDF, DOCX, XLSX) y la IA extrae los datos y precarga el formulario. Revisás y confirmás.",
    steps: [
      "Elegí la empresa receptora.",
      "Arrastrá el archivo o pegá una imagen del portapapeles.",
      "Esperá 5–20 seg mientras la IA lo lee (aplica OCR si es escaneo).",
      "Revisá los campos precargados y confirmá para crear el voucher.",
    ],
    tips: ["Para cargar MUCHOS vouchers de golpe, usá el template Excel y la página /vouchers/import."],
    guide: { label: "Guía de Vouchers", href: "/ayuda/vouchers.html#crear" },
  },
  {
    match: "/vouchers/import",
    title: "Carga masiva de vouchers (CSV)",
    what: "Sube muchos vouchers de una sola vez desde un CSV. Ideal para cargar el histórico contable.",
    steps: [
      "Descargá el template Excel (botón en /vouchers/importar).",
      "Una fila = una línea contable; mismo voucher_ref agrupa líneas.",
      "Exportá a CSV UTF-8 con separador ;",
      "Subí el CSV y clic en 'Validar (dry-run)' — revisa sin escribir.",
      "Si está OK, clic en 'Importar' — crea todo en DRAFT.",
    ],
    tips: ["Cada línea: debe XOR haber. La suma de débitos = créditos por voucher_ref."],
    guide: { label: "Guía de Vouchers", href: "/ayuda/vouchers.html#bulk" },
  },
  {
    match: "/vouchers/nuevo",
    title: "Crear voucher manual",
    what: "Formulario para crear un comprobante contable línea por línea, con validación de cuadre en tiempo real.",
    steps: [
      "Completá la cabecera: empresa, tipo, fecha, glosa, proveedor.",
      "Agregá las líneas con su cuenta + monto en debe o haber.",
      "Verificá que la suma del debe = suma del haber (cuadrado).",
      "Guardá en DRAFT o enviá a aprobación.",
    ],
    guide: { label: "Guía de Vouchers", href: "/ayuda/vouchers.html#crear" },
  },
  {
    match: "/vouchers",
    title: "Vouchers contables",
    what: "El corazón del sistema. Comprobantes con partida doble (debe = haber) e imputación triple (cuenta × proyecto × área).",
    steps: [
      "Filtrá por estado: DRAFT, PENDING, APPROVED, EXECUTED, SYNCED.",
      "Click en un voucher para ver detalle, líneas y adjuntos.",
      "Los pagados quedan en EXECUTED; los enviados a Nubox en SYNCED.",
    ],
    tips: ["Ningún pago sale sin 2 firmas. Ver el ciclo de vida completo en la guía."],
    guide: { label: "Guía de Vouchers", href: "/ayuda/vouchers.html#ciclo" },
  },
  {
    match: "/transferencias",
    title: "Confirmar pagos · Planilla",
    what: "Vouchers aprobados (APPROVED) listos para transferir. Genera la planilla Excel para cargar al banco.",
    steps: [
      "Marcá los vouchers APPROVED que querés pagar.",
      "Clic en 'Excel transferencia' → descarga la planilla del banco.",
      "Cargá la planilla en el portal del banco y transferí.",
      "Volvé y clic en 'Marcar Pagados' (podés adjuntar comprobante).",
    ],
    tips: ["El comprobante de pago es opcional pero recomendado para auditoría."],
    guide: { label: "Guía de Vouchers", href: "/ayuda/vouchers.html#pagar" },
  },
  {
    match: "/aprobaciones",
    title: "Aprobaciones",
    what: "Cola de vouchers esperando tu firma. Cada pago necesita 2 firmas antes de ejecutarse.",
    steps: [
      "Revisá el voucher: empresa, monto, glosa, líneas.",
      "Firmá si está correcto, o rechazá (vuelve a DRAFT para corregir).",
      "Con 2 firmas, el voucher pasa a APPROVED y se puede pagar.",
    ],
    tips: ["Victoria y Benja (GG de las 10) pueden firmar cuando un gerente titular no está."],
    guide: { label: "Guía de Vouchers", href: "/ayuda/vouchers.html#firmar" },
  },
  {
    match: "/mis-pendientes",
    title: "Mis pendientes",
    what: "Tu bandeja personal: vouchers que requieren tu acción (creados por vos o asignados a vos).",
  },
  {
    match: "/action-center",
    title: "Action Center",
    what: "Tu vista de 'qué tengo que hacer hoy': todo lo que requiere tu intervención, en un solo lugar.",
  },

  // ─── Empresas ───────────────────────────────────────────────────────
  {
    match: "/empresa",
    title: "Ficha de empresa",
    what: "Toda la información de una de las 10 entidades, organizada en 14 pestañas.",
    steps: [
      "Resumen / Flujo / Transacciones / Categorías → operación contable.",
      "Valuación / KPIs / Impact → métricas institucionales (portfolio).",
      "Compliance / Tributario → cumplimiento y SII.",
      "Trabajadores / Legal / Avance / Documentos → soporte.",
      "AI Asistente → chat sobre los documentos (requiere indexar).",
    ],
    guide: { label: "Guía de la Plataforma", href: "/ayuda/plataforma.html#empresas" },
  },

  // ─── SII / Tributario ───────────────────────────────────────────────
  {
    match: "/admin/sii",
    title: "Integración SII",
    what: "Conexión con el SII. Las 9 empresas tienen credenciales cifradas y validadas (login OK 9/9). La descarga automática del RCV está rota temporalmente porque el SII cambió su endpoint en 2025 — mientras tanto, usar el flujo manual.",
    steps: [
      "Probar login → verifica que la clave SII funcione (esto SÍ anda).",
      "Para traer compras/ventas: ir al SII web, descargar el CSV del RCV, y subirlo en 'Importar CSV RCV' acá.",
      "Conciliar → matchea documentos SII con vouchers locales.",
      "F29 estimado → calcula el formulario a partir del RCV importado.",
    ],
    tips: [
      "Sincronizar RCV (botón 'Sincronizar') va a fallar con 404 hasta que actualicemos el endpoint nuevo del SII.",
      "El flujo manual con CSV funciona perfecto. Es 2 clicks más, nada más.",
    ],
    guide: { label: "Guía de la Plataforma", href: "/ayuda/plataforma.html#sii" },
  },
  {
    match: "/admin/nubox-api",
    title: "Nubox API REST oficial",
    what: "Integración API REST con Nubox (Factura electrónica + Administración). CONECTADO en UAT (certificación) para las 10 empresas — devuelve 216 docs de prueba. Falta el par de credenciales de PRODUCCIÓN para emitir DTEs reales.",
    steps: [
      "✅ UAT (certificación) activo — podés probar emisión y sincronización sin afectar SII real.",
      "Para activar PRODUCCIÓN: pedir a Nubox el partner_token + api_key del ambiente 'environment-pyme'.",
      "Cargar el par PROD via /admin/nubox-api/credentials/{empresa}.",
      "Cambiar environment='production' y base_url='https://api.pyme.nubox.com/nbxpymapi-environment-pyme'.",
      "Probar con /admin/nubox-api/test/{empresa} → debe responder 200.",
      "Sincronizar ventas con /admin/nubox-api/sync-sales/{empresa}?periodo=YYYY-MM.",
    ],
    tips: [
      "El cliente usa Bearer + X-Api-Key headers. NUNCA loguea los tokens en plaintext (cifrados con Fernet).",
      "UAT está disponible L-V 11:00-00:00 GMT. Si responde 503, es ventana de mantenimiento.",
    ],
  },
  {
    match: "/admin/nubox",
    title: "Nubox — Libro de Remuneraciones (scraping)",
    what: "Bajada automática del libro de remuneraciones mensual desde el portal Nubox. INERTE — falta cargar usuario+contraseña Nubox de cada empresa.",
    steps: [
      "Cargar credenciales Nubox (user+pwd web) en core.empresa_credenciales con sistema='nubox'.",
      "Probar login.",
      "Sincronizar remuneraciones mensual.",
    ],
    tips: ["Alternativa: el botón 'Importar Excel' acepta el libro descargado manualmente desde Nubox web."],
  },
  {
    match: "/admin/nubox-exports",
    title: "Exportar vouchers a Nubox (CSV)",
    what: "Genera un CSV con los vouchers APPROVED del período para que el contador externo los suba a Nubox. NO requiere credenciales Nubox — funciona ya hoy.",
    steps: [
      "Filtrar por empresa + rango de fechas.",
      "Clic en 'Generar batch' → CSV se descarga, los vouchers quedan marcados como EXPORTED.",
      "El contador sube el CSV en Nubox web.",
      "Volver acá y confirmar con los folios Nubox → vouchers pasan a SYNCED.",
    ],
  },

  // ─── Dashboard Institucional ────────────────────────────────────────
  {
    match: "/dashboard/inversionistas",
    title: "Vista Inversionistas (LP)",
    what: "El PCAP (Partner Capital Account Statement) estándar ILPA para cada Limited Partner.",
    tips: ["Vacío hasta cargar la data real del fondo con el template oficial."],
  },
  {
    match: "/dashboard/directorio",
    title: "Dashboard Institucional",
    what: "Vista nivel directorio + LPs (CORFO). Estándar ILPA v2.0 + IRIS+ v5.3. 5 pestañas: Overview, Capital, Companies, Impact, Compliance.",
    tips: [
      "Está vacío hasta cargar data real (antes tenía números demo que se borraron).",
      "Para llenarlo: usar Template_Data_Fondo_REAL.xlsx + script de import.",
    ],
    guide: { label: "Guía de la Plataforma", href: "/ayuda/plataforma.html#dashboard" },
  },
  {
    match: "/dashboard",
    title: "Dashboard operativo",
    what: "Vista general de la operación diaria: pendientes, vencimientos, actividad reciente.",
  },

  // ─── Contabilidad ───────────────────────────────────────────────────
  {
    match: "/admin/plan-cuentas",
    title: "Plan de cuentas",
    what: "Las 2.120 cuentas contables por empresa. La base de toda imputación en los vouchers.",
  },
  {
    match: "/admin/nubox-exports",
    title: "Exportar a Nubox",
    what: "Envía los asientos contables a Nubox (la contabilidad oficial que lleva el contador externo).",
    tips: ["Exportá una vez por semana o al cierre de mes. Los vouchers pasan a SYNCED."],
  },
  {
    match: "/admin/conciliacion",
    title: "Conciliación bancaria",
    what: "Matchea los movimientos del banco (cartolas) con los vouchers locales.",
  },

  // ─── Proveedores / Movimientos ──────────────────────────────────────
  {
    match: "/proveedores",
    title: "Proveedores",
    what: "228 proveedores con RUT, datos bancarios y de contacto. Se usan al crear vouchers de compra/egreso.",
  },
  {
    match: "/movimientos",
    title: "Movimientos bancarios",
    what: "2.550 movimientos de las cartolas. Se concilian con los vouchers para cerrar el círculo contable.",
  },
  {
    match: "/calendario",
    title: "Calendario",
    what: "Vencimientos y obligaciones tributarias y legales del fondo y las empresas.",
  },

  // ─── Documentos / Reportes ──────────────────────────────────────────
  {
    match: "/legal",
    title: "Legal",
    what: "855 documentos legales por empresa (contratos, certificados), sincronizados desde Dropbox.",
  },
  {
    match: "/reportes",
    title: "Reportes",
    what: "Reportes contables, EEFF, tributarios, de portafolio y del fondo. Para análisis y entrega a terceros.",
  },

  // ─── Admin ──────────────────────────────────────────────────────────
  {
    match: "/admin/usuarios",
    title: "Usuarios",
    what: "Crear, editar y resetear claves de los usuarios. Asignar roles globales (admin/finance).",
    tips: ["No borres usuarios que dejaron el equipo: desactivalos para mantener la auditoría."],
  },
  {
    match: "/admin/marcha-blanca",
    title: "Checklist marcha blanca",
    what: "Estado en vivo: ¿estamos listos para operar? Bloqueantes vs importantes vs nice-to-have.",
  },
  {
    match: "/admin",
    title: "Administración",
    what: "Configuración del sistema y herramientas de monitoreo. Solo para administradores.",
    guide: { label: "Guía de la Plataforma", href: "/ayuda/plataforma.html#admin" },
  },

  // ─── Fallback general (raíz) — debe ir ÚLTIMO ───────────────────────
  {
    match: "/",
    title: "Plataforma Cehta Capital",
    what: "Sistema operativo del FIP CEHTA ESG: pagos, contabilidad, documentos y reportes de las 10 entidades.",
    tips: ["Usá el botón de ayuda (?) en cualquier página para ver instrucciones del módulo donde estés."],
    guide: { label: "Guía completa de la Plataforma", href: "/ayuda/plataforma.html" },
  },
];

/** Fallback garantizado (tipado fuerte para noUncheckedIndexedAccess). */
const FALLBACK_HELP: HelpEntry = {
  match: "/",
  title: "Plataforma Cehta Capital",
  what: "Sistema operativo del FIP CEHTA ESG: pagos, contabilidad, documentos y reportes de las 10 entidades.",
  tips: ["Usá el botón de ayuda (?) en cualquier página para ver instrucciones del módulo donde estés."],
  guide: { label: "Guía completa de la Plataforma", href: "/ayuda/plataforma.html" },
};

/** Devuelve el instructivo más específico para una ruta dada. */
export function getHelpForPath(pathname: string): HelpEntry {
  // Ordenar por longitud de match descendente → el más específico gana.
  const sorted = [...HELP_ENTRIES].sort((a, b) => b.match.length - a.match.length);
  const found = sorted.find((e) =>
    e.match === "/" ? pathname === "/" || pathname === "" : pathname.startsWith(e.match),
  );
  return found ?? FALLBACK_HELP;
}
