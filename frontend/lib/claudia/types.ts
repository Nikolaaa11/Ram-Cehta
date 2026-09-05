/**
 * Tipos del registro de egresos CORFO (la sección de Claudia).
 *
 * Espejo campo por campo del contrato §3.3 de
 * `docs/MEGAPROMPT_REGISTRO_EGRESOS_CLAUDIA.md`. Se escriben a mano porque
 * el backend se construye en paralelo y `types/api.ts` se regenera recién
 * al cierre: mientras tanto esta es la única fuente de verdad del front.
 *
 * Regla de la plataforma: la plata viaja como string decimal ("94352.00"),
 * nunca como float. Acá los montos son `string`; la aritmética se hace en
 * centavos enteros en `lib/claudia/reparto.ts`.
 */

export type Fuente = "subsidio" | "cehta_ptec" | "cehta" | "trewaox";

export type RepartoEstado = "SIN_CLASIFICAR" | "OK" | "DESCUADRADO";

export type TipoDocumento =
  | "FACTURA"
  | "FACTURA_EXENTA"
  | "BOLETA"
  | "BOLETA_HONORARIO"
  | "LIQUIDACION"
  | "CO_EJECUTOR"
  | "INVOICE"
  | "OTRO";

export type EstadoPago = "PAGADO" | "PARCIAL" | "PENDIENTE";

export type OrigenEgreso = "UI" | "PASTE" | "IMPORT_EXCEL";

/** Los 4 montos por fuente, como string decimal. */
export type RepartoMontos = Record<Fuente, string>;

/** Los 11 campos oficiales CORFO que viven en la misma fila. */
export interface EgresoCorfo {
  cuenta: string | null;
  item: string | null;
  fuente_financiamiento: string | null;
  etapa: string | null;
  fecha_recepcion: string | null;
  monto_rendir: string | null;
  monto_cancelado: string | null;
  forma_pago: string | null;
  glosa: string | null;
  receptor_rut: string | null;
  receptor_nombre: string | null;
}

export interface EgresoRead {
  egreso_id: number;
  empresa_codigo: string;
  periodo: string;
  fecha: string;
  descripcion: string;
  rut_emisor: string | null;
  tipo_documento: TipoDocumento;
  folio: string | null;
  monto_neto: string | null;
  impuesto: string | null;
  total: string;
  tipo_egreso: string | null;
  fuente: string | null;
  proyecto: string | null;
  estado_pago: EstadoPago;
  fecha_pago: string | null;
  /** `null` cuando SIN_CLASIFICAR. */
  reparto: RepartoMontos | null;
  /** `null` cuando SIN_CLASIFICAR. */
  reparto_pct: RepartoMontos | null;
  reparto_estado: RepartoEstado;
  corfo: EgresoCorfo;
  observaciones: string | null;
  adjunto_dropbox_path: string | null;
  origen: OrigenEgreso;
  neto_mas_impuesto_cuadra: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  /** Último número de versión del historial. */
  version: number;
}

export interface CambioHistorial {
  campo: string;
  antes: unknown;
  despues: unknown;
}

export interface HistorialItem {
  version: number;
  accion: "INSERT" | "UPDATE" | "DELETE" | string;
  changed_at: string;
  changed_by: string | null;
  cambios: CambioHistorial[];
}

export interface EgresoDetalle extends EgresoRead {
  historial: HistorialItem[];
}

/** Sub-objeto CORFO parcial para crear/editar. */
export type EgresoCorfoInput = Partial<EgresoCorfo>;

/** Reparto por % (strings con 2 decimales, "50.00"); fuentes ausentes = 0. */
export type RepartoPct = Partial<Record<Fuente, string>>;

export interface EgresoCreate {
  empresa_codigo: string;
  fecha: string;
  descripcion: string;
  rut_emisor?: string | null;
  tipo_documento: TipoDocumento;
  folio?: string | null;
  monto_neto?: string | null;
  impuesto?: string | null;
  total: string;
  tipo_egreso?: string | null;
  fuente?: string | null;
  proyecto?: string | null;
  estado_pago?: EstadoPago;
  fecha_pago?: string | null;
  /** Montos por fuente. Excluyente con `reparto_pct`. */
  reparto?: Partial<RepartoMontos> | null;
  /** Porcentajes; la API convierte con `repartir_por_pct`. */
  reparto_pct?: RepartoPct | null;
  corfo?: EgresoCorfoInput | null;
  observaciones?: string | null;
  adjunto_dropbox_path?: string | null;
  origen?: "UI" | "PASTE";
}

/** Fila de `POST /batch`: un `EgresoCreate` sin `empresa_codigo`. */
export type EgresoCreateFila = Omit<EgresoCreate, "empresa_codigo">;

/** PATCH-like vía PUT: todo opcional; `empresa_codigo` no se puede tocar. */
export type EgresoUpdate = Partial<Omit<EgresoCreate, "empresa_codigo" | "origen">>;

export interface EgresosListResponse {
  empresa_codigo: string;
  periodo: string | null;
  items: EgresoRead[];
  n: number;
  truncado: boolean;
}

export interface PeriodoResumen {
  periodo: string;
  n: number;
  total: string;
  pendiente: string;
  sin_clasificar: number;
  descuadrados: number;
}

export interface PeriodosResponse {
  items: PeriodoResumen[];
  n_total: number;
  total_general: string;
}

export interface ResumenPorEstado {
  n: number;
  monto: string;
}

export interface ResumenResponse {
  empresa_codigo: string;
  periodo: string;
  n: number;
  total: string;
  por_fuente: Record<Fuente | "sin_clasificar", string>;
  por_estado: Record<EstadoPago, ResumenPorEstado>;
  pct_pagado: string | number | null;
  por_tipo_documento: Array<{ tipo_documento: string; n: number; monto: string }>;
  descuadrados: number;
  sin_clasificar: number;
}

export interface CatalogoItem {
  codigo: string;
  label: string;
}

/**
 * Los catálogos CORFO vienen de `core.corfo_catalogos`; el contrato no fija
 * si cada valor es un string pelado o `{codigo, label}`. Se aceptan los dos
 * y la UI los normaliza con `aOpcion()`.
 */
export type CatalogoValor = string | CatalogoItem;

export interface CatalogosResponse {
  tipos_documento: CatalogoItem[];
  estados_pago: CatalogoItem[];
  fuentes: CatalogoItem[];
  formas_pago: CatalogoValor[];
  corfo: {
    cuenta_gastos: CatalogoValor[];
    item_gastos: CatalogoValor[];
    etapa: CatalogoValor[];
    tipo_doc_gastos: CatalogoValor[];
    fuente_financiamiento_sugeridas: CatalogoValor[];
  };
  /** Valores distintos ya usados por esa empresa (autocompletar). */
  sugerencias: {
    tipo_egreso: string[];
    fuente: string[];
    proyecto: string[];
  };
}

export interface BatchRequest {
  empresa_codigo: string;
  filas: EgresoCreateFila[];
}

export interface BatchResponse {
  creados: EgresoRead[];
  n: number;
}

export interface DeleteRequest {
  motivo: string;
}

export interface DeleteResponse {
  egreso_id: number;
  deleted_at: string;
}

export interface ImportarResponse {
  empresa_codigo: string;
  dry_run: boolean;
  leidas: number;
  creadas: number;
  omitidas_existentes: number;
  duplicadas_en_excel: number;
  saltadas: Array<{ fila_excel: number; motivo: string }>;
  descuadradas: number;
  sin_clasificar: number;
}

/**
 * Largos máximos de los campos de texto (espejo de los `max_length` de
 * `schemas/claudia_egresos.py`). Se aplican como `maxLength` en la grilla
 * y la ficha, y el pegado marca las filas que los exceden ANTES del batch:
 * un 422 por una descripción de 600 caracteres tumbaría las otras 499.
 */
export const LARGO_MAX = {
  descripcion: 500,
  folio: 50,
  tipo_egreso: 120,
  fuente: 120,
  proyecto: 120,
  observaciones: 2000,
  /** `q` del buscador (`Query(max_length=120)` en la API). */
  busqueda: 120,
} as const;

/** `POST /batch` acepta hasta 500 filas por llamada (todo-o-nada por lote). */
export const BATCH_MAX_FILAS = 500;

/** Empresas con registro CORFO (espejo de `CORFO_EMPRESAS` del backend). */
export const CORFO_EMPRESAS = ["REVTECH", "TRONGKAI"] as const;
export type CorfoEmpresa = (typeof CORFO_EMPRESAS)[number];

export const TIPOS_DOCUMENTO: ReadonlyArray<CatalogoItem> = [
  { codigo: "FACTURA", label: "Factura" },
  { codigo: "FACTURA_EXENTA", label: "Factura exenta" },
  { codigo: "BOLETA", label: "Boleta" },
  { codigo: "BOLETA_HONORARIO", label: "Boleta de honorarios" },
  { codigo: "LIQUIDACION", label: "Liquidación" },
  { codigo: "CO_EJECUTOR", label: "Co-ejecutor" },
  { codigo: "INVOICE", label: "Invoice" },
  { codigo: "OTRO", label: "Otro" },
];

export const ESTADOS_PAGO: ReadonlyArray<CatalogoItem> = [
  { codigo: "PAGADO", label: "Pagado" },
  { codigo: "PARCIAL", label: "Pagado parcial" },
  { codigo: "PENDIENTE", label: "Pendiente" },
];

/** Normaliza un valor de catálogo (string o `{codigo,label}`) a opción. */
export function aOpcion(v: CatalogoValor): CatalogoItem {
  if (typeof v === "string") return { codigo: v, label: v };
  return { codigo: v.codigo, label: v.label || v.codigo };
}
