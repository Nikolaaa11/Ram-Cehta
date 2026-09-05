/**
 * Pegar gastos desde el Excel de Claudia (Ctrl+V sobre la grilla).
 *
 * Claudia lleva el registro real en `Registro de Egresos` de su Excel. Lo
 * que copia de ahí llega al portapapeles como texto con TABS entre columnas
 * y saltos de línea entre filas. Esto lo interpreta con el MISMO orden de
 * columnas de su planilla, con o sin la fila de encabezados:
 *
 *   REVTECH (16):  Fecha · Descripción · RUT Emisor · Tipo de Documento ·
 *                  Folio · Monto Neto · Impuesto · Total · Tipo de Egreso ·
 *                  Fuente · Proyecto · Subsidio · Cehta-Ptec · Cehta ·
 *                  Estado · Fecha de Pago
 *   TRONGKAI (17): igual hasta Total, después Tipo Financiamiento · Tipo de
 *                  Egreso · Proyecto · Trewaox · Subsidio · Cehta-Ptec ·
 *                  Cehta · Estado · Fecha de Pago
 *
 * Si viene la fila de encabezados, las columnas se reconocen POR NOMBRE
 * (tolerante a mayúsculas y acentos) y el orden deja de importar. Sin
 * encabezados, se asume el orden de arriba según cuántas columnas haya.
 *
 * # LO SUCIO QUE TRAE EL EXCEL DE VERDAD (medido en §1.2 del spec)
 *
 *  - Estados con símbolo: `✓ Pagado`, `◑ Pagado Parcial`, `✗ Pendiente`.
 *  - Montos con puntos de miles y coma decimal; totales con 4 decimales
 *    (conversiones desde UF). Se reusa `normalizarNumero` de las OC.
 *  - `Boletas` y `Boleta` para lo mismo, `liquidación` en minúscula.
 *  - Nombres con `\xa0` al final; folios numéricos; fechas `dd-mm-yyyy`.
 *
 * Las filas que la API rechazaría (fecha inválida, sin total, RUT inválido,
 * neto + impuesto ≠ total) se devuelven con `errores` en vez de tirarse:
 * `POST /batch` es todo-o-nada y la pantalla tiene que poder decir "estas 3
 * no van, ¿agrego las otras 12?".
 *
 * Funciones puras, sin React.
 */
import { normalizarNumero } from "@/lib/oc/pegar-items";
import { isValidRut, stripRut } from "@/lib/rut";
import { centavosADecimal, decimalACentavos } from "./reparto";
import {
  BATCH_MAX_FILAS,
  LARGO_MAX,
  type EgresoCreateFila,
  type EstadoPago,
  type Fuente,
  type TipoDocumento,
} from "./types";

export type ColumnaPegado =
  | "fecha"
  | "descripcion"
  | "rut_emisor"
  | "tipo_documento"
  | "folio"
  | "monto_neto"
  | "impuesto"
  | "total"
  | "tipo_egreso"
  | "fuente"
  | "proyecto"
  | "trewaox"
  | "subsidio"
  | "cehta_ptec"
  | "cehta"
  | "estado_pago"
  | "fecha_pago"
  | "ignorar";

/** Orden de la planilla de REVTECH (16 columnas). */
export const ORDEN_REVTECH: readonly ColumnaPegado[] = [
  "fecha",
  "descripcion",
  "rut_emisor",
  "tipo_documento",
  "folio",
  "monto_neto",
  "impuesto",
  "total",
  "tipo_egreso",
  "fuente",
  "proyecto",
  "subsidio",
  "cehta_ptec",
  "cehta",
  "estado_pago",
  "fecha_pago",
];

/** Orden de la planilla de TRONGKAI (17 columnas, con Trewaox). */
export const ORDEN_TRONGKAI: readonly ColumnaPegado[] = [
  "fecha",
  "descripcion",
  "rut_emisor",
  "tipo_documento",
  "folio",
  "monto_neto",
  "impuesto",
  "total",
  "fuente",
  "tipo_egreso",
  "proyecto",
  "trewaox",
  "subsidio",
  "cehta_ptec",
  "cehta",
  "estado_pago",
  "fecha_pago",
];

export interface EgresoPegado {
  /** Número de fila dentro de lo pegado (1 = primera fila de datos). */
  fila: number;
  /** ISO `yyyy-mm-dd`, o "" si no se pudo interpretar. */
  fecha: string;
  fecha_original: string;
  descripcion: string;
  /** Normalizado sin puntos y con guion ("76642280-2"), o "". */
  rut_emisor: string;
  tipo_documento: TipoDocumento;
  tipo_documento_original: string;
  folio: string;
  /** Decimal con 2 decimales ("94352.00") o "". */
  monto_neto: string;
  impuesto: string;
  total: string;
  tipo_egreso: string;
  fuente: string;
  proyecto: string;
  /** Todo-o-nada: las 4 fuentes o `null`. */
  reparto: Record<Fuente, string> | null;
  estado_pago: EstadoPago;
  fecha_pago: string;
  /** Motivos por los que la API rechazaría esta fila. Vacío = se puede crear. */
  errores: string[];
  /** Cosas que se interpretaron con una suposición (no bloquean). */
  avisos: string[];
}

export interface ResultadoPegado {
  /** Todas las filas, válidas e inválidas (ver `errores`). */
  filas: EgresoPegado[];
  conEncabezado: boolean;
  /** El mapeo de columnas que se usó. */
  columnas: ColumnaPegado[];
}

// ── Helpers de texto ─────────────────────────────────────────────────────

function limpiar(s: string | undefined): string {
  return (s ?? "").replace(/\u00a0/g, " ").replace(/^"|"$/g, "").trim();
}

function sinAcentos(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function clave(s: string): string {
  return sinAcentos(limpiar(s).toLowerCase()).replace(/\s+/g, " ");
}

/** Parte una línea respetando las comillas de Excel. */
function partirLinea(linea: string, sep: string): string[] {
  const celdas: string[] = [];
  let actual = "";
  let dentro = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      if (dentro && linea[i + 1] === '"') {
        actual += '"';
        i++;
      } else {
        dentro = !dentro;
      }
    } else if (c === sep && !dentro) {
      celdas.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  celdas.push(actual);
  return celdas;
}

/** Separa en filas sin cortar dentro de una celda entre comillas. */
function partirFilas(texto: string): string[] {
  const filas: string[] = [];
  let actual = "";
  let dentro = false;
  const t = texto.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"') {
      if (dentro && t[i + 1] === '"') {
        actual += '""';
        i++;
      } else {
        dentro = !dentro;
        actual += c;
      }
    } else if (c === "\n" && !dentro) {
      filas.push(actual);
      actual = "";
    } else {
      actual += c;
    }
  }
  if (actual) filas.push(actual);
  return filas;
}

// ── Interpretación de cada tipo de celda ─────────────────────────────────

/**
 * `dd-mm-yyyy`, `dd/mm/yyyy`, `dd.mm.yyyy`, `dd-mm-yy` o `yyyy-mm-dd`
 * (con o sin hora atrás) → ISO. "" si no es una fecha real.
 */
export function parsearFecha(crudo: string): string {
  const t = limpiar(crudo);
  if (!t) return "";
  let y: number;
  let m: number;
  let d: number;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/.exec(t);
  if (match) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T].*)?$/.exec(t);
    if (!match) return "";
    d = Number(match[1]);
    m = Number(match[2]);
    const yy = match[3]!;
    y = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return "";
  // Date.UTC "corrige" 31/02 a 03/03: si no vuelve igual, no era una fecha.
  const fecha = new Date(Date.UTC(y, m - 1, d));
  if (
    fecha.getUTCFullYear() !== y ||
    fecha.getUTCMonth() !== m - 1 ||
    fecha.getUTCDate() !== d
  ) {
    return "";
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Monto pegado → decimal con 2 decimales ("1.234.567,5" → "1234567.50") o "". */
export function parsearMonto(crudo: string): string {
  const n = normalizarNumero(limpiar(crudo));
  if (!n) return "";
  const c = decimalACentavos(n);
  return c === null ? "" : centavosADecimal(c);
}

/** `Boletas`/`Boleta` → BOLETA, `liquidación` → LIQUIDACION, etc. */
export function parsearTipoDocumento(crudo: string): {
  codigo: TipoDocumento;
  reconocido: boolean;
} {
  const k = clave(crudo).replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  if (!k) return { codigo: "OTRO", reconocido: true };
  if (k.includes("honorario")) return { codigo: "BOLETA_HONORARIO", reconocido: true };
  if (k.includes("exenta")) return { codigo: "FACTURA_EXENTA", reconocido: true };
  if (k.includes("factura")) return { codigo: "FACTURA", reconocido: true };
  if (k.includes("boleta")) return { codigo: "BOLETA", reconocido: true };
  if (k.includes("liquidacion")) return { codigo: "LIQUIDACION", reconocido: true };
  if (k.includes("ejecutor")) return { codigo: "CO_EJECUTOR", reconocido: true };
  if (k.includes("invoice")) return { codigo: "INVOICE", reconocido: true };
  if (k === "otro" || k === "otros") return { codigo: "OTRO", reconocido: true };
  return { codigo: "OTRO", reconocido: false };
}

/** `✓ Pagado` → PAGADO, `◑ Pagado Parcial` → PARCIAL, `✗ Pendiente` → PENDIENTE. */
export function parsearEstadoPago(crudo: string): {
  codigo: EstadoPago;
  reconocido: boolean;
} {
  const t = limpiar(crudo);
  if (!t) return { codigo: "PENDIENTE", reconocido: true };
  const k = clave(t);
  if (t.includes("◑") || k.includes("parcial")) return { codigo: "PARCIAL", reconocido: true };
  if (t.includes("✗") || t.includes("✕") || k.includes("pend")) {
    return { codigo: "PENDIENTE", reconocido: true };
  }
  if (t.includes("✓") || t.includes("✔") || k.includes("pag")) {
    return { codigo: "PAGADO", reconocido: true };
  }
  return { codigo: "PENDIENTE", reconocido: false };
}

/** "76.642.280-2" / "76642280-2" / "766422802" → "76642280-2"; "" si vacío. */
export function parsearRut(crudo: string): string {
  const s = stripRut(limpiar(crudo));
  if (!s) return "";
  if (s.length < 2) return s;
  return `${s.slice(0, -1)}-${s.slice(-1)}`;
}

// ── Encabezados ──────────────────────────────────────────────────────────

/** Reconoce el nombre de una columna de la planilla. `ignorar` si no. */
export function columnaPorNombre(nombre: string): ColumnaPegado {
  const k = clave(nombre);
  if (!k) return "ignorar";
  if (k.includes("fecha") && k.includes("pago")) return "fecha_pago";
  if (k.includes("fecha")) return "fecha";
  if (k.includes("descripci") || k === "glosa" || k === "detalle") return "descripcion";
  if (k.includes("rut")) return "rut_emisor";
  if (k.includes("tipo") && k.includes("doc")) return "tipo_documento";
  if (k.includes("folio") || k.includes("n° doc") || k.includes("numero doc")) return "folio";
  if (k.includes("neto")) return "monto_neto";
  if (k.includes("impuesto") || k.includes("patronal") || k === "iva") return "impuesto";
  if (k.includes("total")) return "total";
  if (k.includes("tipo") && k.includes("egreso")) return "tipo_egreso";
  if (k.includes("financiamiento") || k.includes("fuente")) return "fuente";
  if (k.includes("proyecto")) return "proyecto";
  if (k.includes("trewaox")) return "trewaox";
  if (k.includes("subsidio") || k.includes("corfo")) return "subsidio";
  if (k.includes("ptec") || k.includes("p-tec") || k.includes("p tec")) return "cehta_ptec";
  if (k.includes("cehta")) return "cehta";
  if (k.includes("estado")) return "estado_pago";
  return "ignorar";
}

/** ¿Esta fila es el encabezado y no un gasto? Tres rótulos reconocidos y sin fecha. */
function esEncabezado(celdas: string[]): boolean {
  const reconocidas = celdas.filter((c) => columnaPorNombre(c) !== "ignorar").length;
  const tieneFecha = celdas.some((c) => parsearFecha(c) !== "");
  return reconocidas >= 3 && !tieneFecha;
}

function ordenPorDefecto(nColumnas: number): ColumnaPegado[] {
  return nColumnas >= ORDEN_TRONGKAI.length ? [...ORDEN_TRONGKAI] : [...ORDEN_REVTECH];
}

// ── El parser ────────────────────────────────────────────────────────────

/**
 * Interpreta lo pegado. Devuelve lista vacía si es un pegado común (una
 * sola línea sin tabs): ahí tiene que ganar el pegado normal del navegador.
 */
export function parsearEgresosPegados(texto: string): ResultadoPegado {
  const vacio: ResultadoPegado = { filas: [], conEncabezado: false, columnas: [] };
  if (!texto || !texto.trim()) return vacio;

  const hayTabs = texto.includes("\t");
  const hayVariasFilas = /\n/.test(texto.trim());
  if (!hayTabs && !hayVariasFilas) return vacio;
  const sep = hayTabs ? "\t" : texto.includes(";") ? ";" : "\t";

  const lineas = partirFilas(texto).filter((l) => l.trim() !== "");
  if (lineas.length === 0) return vacio;

  const primera = partirLinea(lineas[0]!, sep).map(limpiar);
  let columnas: ColumnaPegado[];
  let conEncabezado = false;
  let datos: string[];
  if (esEncabezado(primera)) {
    conEncabezado = true;
    columnas = primera.map(columnaPorNombre);
    datos = lineas.slice(1);
  } else {
    columnas = ordenPorDefecto(primera.length);
    datos = lineas;
  }

  const filas: EgresoPegado[] = [];
  let n = 0;
  for (const linea of datos) {
    const celdas = partirLinea(linea, sep).map(limpiar);
    if (celdas.every((c) => c === "")) continue;
    n += 1;
    filas.push(interpretarFila(n, celdas, columnas));
  }
  return { filas, conEncabezado, columnas };
}

function interpretarFila(
  fila: number,
  celdas: string[],
  columnas: ColumnaPegado[],
): EgresoPegado {
  const v: Partial<Record<ColumnaPegado, string>> = {};
  columnas.forEach((col, i) => {
    if (col === "ignorar") return;
    // Si el mismo rótulo aparece dos veces, gana el primero con contenido.
    const celda = celdas[i] ?? "";
    if (v[col] === undefined || (v[col] === "" && celda !== "")) v[col] = celda;
  });

  const errores: string[] = [];
  const avisos: string[] = [];

  const fecha_original = v.fecha ?? "";
  const fecha = parsearFecha(fecha_original);
  if (!fecha) {
    errores.push(
      fecha_original ? `Fecha "${fecha_original}" no es una fecha válida` : "Falta la fecha",
    );
  }

  const descripcion = v.descripcion ?? "";
  if (!descripcion) errores.push("Falta la descripción");

  // Los largos máximos de la API: una fila que los excede tumbaría el
  // batch entero (es todo-o-nada), así que se marca acá y no se manda.
  const largos: Array<[string, string, number]> = [
    ["Descripción", descripcion, LARGO_MAX.descripcion],
    ["Folio", v.folio ?? "", LARGO_MAX.folio],
    ["Tipo de egreso", v.tipo_egreso ?? "", LARGO_MAX.tipo_egreso],
    ["Fuente", v.fuente ?? "", LARGO_MAX.fuente],
    ["Proyecto", v.proyecto ?? "", LARGO_MAX.proyecto],
  ];
  for (const [etiqueta, valor, max] of largos) {
    if (valor.length > max) {
      errores.push(`${etiqueta} tiene ${valor.length} caracteres y el máximo es ${max}`);
    }
  }

  const rut_emisor = parsearRut(v.rut_emisor ?? "");
  if (rut_emisor && !isValidRut(rut_emisor)) {
    errores.push(`RUT "${v.rut_emisor}" inválido (dígito verificador no coincide)`);
  }

  const tipo_documento_original = v.tipo_documento ?? "";
  const tipoDoc = parsearTipoDocumento(tipo_documento_original);
  if (!tipoDoc.reconocido) {
    avisos.push(`Tipo de documento "${tipo_documento_original}" no reconocido: queda como OTRO`);
  }

  const monto_neto = parsearMonto(v.monto_neto ?? "");
  const impuesto = parsearMonto(v.impuesto ?? "");
  const total = parsearMonto(v.total ?? "");
  if (!total) {
    errores.push("Falta el total");
  } else if (decimalACentavos(total)! < 0) {
    errores.push("El total no puede ser negativo");
  }
  if (monto_neto && impuesto && total) {
    // La API exige neto + impuesto = total si vienen los dos. El Excel tiene
    // 46 filas de TRONGKAI que no cumplen; acá se marcan, no se maquillan.
    const suma = decimalACentavos(monto_neto)! + decimalACentavos(impuesto)!;
    if (suma !== decimalACentavos(total)) {
      errores.push("Neto + impuesto no suman el total");
    }
  }

  const fuentes: Record<Fuente, string> = {
    subsidio: parsearMonto(v.subsidio ?? ""),
    cehta_ptec: parsearMonto(v.cehta_ptec ?? ""),
    cehta: parsearMonto(v.cehta ?? ""),
    trewaox: parsearMonto(v.trewaox ?? ""),
  };
  const algunaFuente = Object.values(fuentes).some((x) => x !== "");
  const reparto: Record<Fuente, string> | null = algunaFuente
    ? {
        subsidio: fuentes.subsidio || "0.00",
        cehta_ptec: fuentes.cehta_ptec || "0.00",
        cehta: fuentes.cehta || "0.00",
        trewaox: fuentes.trewaox || "0.00",
      }
    : null;
  if (reparto && total) {
    const suma =
      decimalACentavos(reparto.subsidio)! +
      decimalACentavos(reparto.cehta_ptec)! +
      decimalACentavos(reparto.cehta)! +
      decimalACentavos(reparto.trewaox)!;
    if (suma !== decimalACentavos(total)) {
      // La API rechaza un reparto que no cierra. Mejor avisar y crear el
      // gasto SIN clasificar (queda en ámbar) que perder la fila entera.
      avisos.push("El reparto por fuente no suma el total: el gasto queda sin clasificar");
    }
  }

  const estado = parsearEstadoPago(v.estado_pago ?? "");
  if (!estado.reconocido) {
    avisos.push(`Estado "${v.estado_pago}" no reconocido: queda PENDIENTE`);
  }
  const fecha_pago_original = v.fecha_pago ?? "";
  const fecha_pago = parsearFecha(fecha_pago_original);
  if (fecha_pago_original && !fecha_pago) {
    avisos.push(`Fecha de pago "${fecha_pago_original}" no válida: se omite`);
  }

  return {
    fila,
    fecha,
    fecha_original,
    descripcion,
    rut_emisor,
    tipo_documento: tipoDoc.codigo,
    tipo_documento_original,
    folio: v.folio ?? "",
    monto_neto,
    impuesto,
    total,
    tipo_egreso: v.tipo_egreso ?? "",
    fuente: v.fuente ?? "",
    proyecto: v.proyecto ?? "",
    reparto,
    estado_pago: estado.codigo,
    fecha_pago,
    errores,
    avisos,
  };
}

/** Suma de los totales de las filas dadas, en centavos. */
export function totalPegado(filas: EgresoPegado[]): number {
  return filas.reduce((acc, f) => acc + (decimalACentavos(f.total) ?? 0), 0);
}

/**
 * Fila pegada → cuerpo de `POST /claudia/egresos/batch` (sin empresa).
 * Sólo tiene sentido para filas sin `errores`.
 */
export function egresoPegadoAFila(p: EgresoPegado): EgresoCreateFila {
  const repartoCuadra = (() => {
    if (!p.reparto || !p.total) return false;
    const suma =
      decimalACentavos(p.reparto.subsidio)! +
      decimalACentavos(p.reparto.cehta_ptec)! +
      decimalACentavos(p.reparto.cehta)! +
      decimalACentavos(p.reparto.trewaox)!;
    return suma === decimalACentavos(p.total);
  })();
  const observaciones: string[] = [];
  if (p.tipo_documento_original && p.tipo_documento === "OTRO") {
    const k = clave(p.tipo_documento_original);
    if (k !== "otro" && k !== "otros") {
      observaciones.push(`Tipo de documento original: ${p.tipo_documento_original}`);
    }
  }
  if (p.reparto && !repartoCuadra) {
    observaciones.push(
      `Reparto pegado que no cuadra: Subsidio ${p.reparto.subsidio} · P-tec ${p.reparto.cehta_ptec} · Cehta ${p.reparto.cehta} · Trewaox ${p.reparto.trewaox}`,
    );
  }
  const fila: EgresoCreateFila = {
    fecha: p.fecha,
    descripcion: p.descripcion,
    rut_emisor: p.rut_emisor || null,
    tipo_documento: p.tipo_documento,
    folio: p.folio || null,
    monto_neto: p.monto_neto || null,
    impuesto: p.impuesto || null,
    total: p.total,
    tipo_egreso: p.tipo_egreso || null,
    fuente: p.fuente || null,
    proyecto: p.proyecto || null,
    estado_pago: p.estado_pago,
    fecha_pago: p.fecha_pago || null,
    // Las observaciones las arma esta función (no vienen del Excel): se
    // recortan al máximo de la API por si el tipo original era enorme.
    observaciones: observaciones.length
      ? observaciones.join("\n").slice(0, LARGO_MAX.observaciones)
      : null,
    origen: "PASTE",
  };
  if (repartoCuadra && p.reparto) fila.reparto = p.reparto;
  return fila;
}

/**
 * Parte las filas en lotes de a `BATCH_MAX_FILAS` para `POST /batch`.
 *
 * El batch es todo-o-nada por llamada y acepta 500 como máximo; con más
 * filas la pantalla manda un POST por lote, en orden, y avisa que la
 * garantía pasa a ser por lote (si falla el tercero, los dos primeros ya
 * quedaron guardados).
 */
export function trocearLotes<T>(filas: readonly T[], tamano: number = BATCH_MAX_FILAS): T[][] {
  const n = Math.max(1, Math.trunc(tamano));
  const lotes: T[][] = [];
  for (let i = 0; i < filas.length; i += n) lotes.push(filas.slice(i, i + n));
  return lotes;
}
