// ─── Common ──────────────────────────────────────────────────────────────────

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface UserMe {
  sub: string;
  email: string | null;
  app_role: "admin" | "finance" | "viewer";
  allowed_actions: string[];
}

// ─── Proveedor ────────────────────────────────────────────────────────────────

export interface ProveedorRead {
  proveedor_id: number;
  razon_social: string;
  rut: string | null;
  giro: string | null;
  direccion: string | null;
  ciudad: string | null;
  contacto: string | null;
  telefono: string | null;
  email: string | null;
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
  activo: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProveedorCreate {
  razon_social: string;
  rut?: string | null;
  giro?: string | null;
  direccion?: string | null;
  ciudad?: string | null;
  contacto?: string | null;
  telefono?: string | null;
  email?: string | null;
  banco?: string | null;
  tipo_cuenta?: string | null;
  numero_cuenta?: string | null;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export interface SaldoEmpresa {
  empresa_codigo: string;
  razon_social: string;
  saldo_cehta: string | null;
  saldo_corfo: string | null;
  saldo_contable: string | null;
  periodo: string | null;
}

export interface MovimientoReciente {
  movimiento_id: number;
  fecha: string;
  empresa_codigo: string;
  descripcion: string | null;
  abono: string;
  egreso: string;
  concepto_general: string | null;
  proyecto: string | null;
}

export interface OcResumen {
  total_emitidas: number;
  monto_total_emitidas: string;
  total_pagadas: number;
  monto_total_pagadas: string;
  total_anuladas: number;
}

export interface F29Resumen {
  empresa_codigo: string;
  periodo_tributario: string;
  fecha_vencimiento: string;
  monto_a_pagar: string | null;
  estado: string;
}

export interface DashboardData {
  saldos_por_empresa: SaldoEmpresa[];
  movimientos_recientes: MovimientoReciente[];
  oc_resumen: OcResumen;
  f29_pendientes: F29Resumen[];
  periodo_actual: string;
}

// ─── Órdenes de Compra ────────────────────────────────────────────────────────

export interface OcListItem {
  oc_id: number;
  numero_oc: string;
  empresa_codigo: string;
  proveedor_id: number | null;
  fecha_emision: string;
  moneda: string;
  neto: string;
  total: string;
  estado: string;
  pdf_url: string | null;
  allowed_actions: string[];
}

export interface OcDetalle {
  detalle_id: number;
  item: number;
  descripcion: string;
  precio_unitario: string;
  cantidad: string;
  total_linea: string | null;
}

export interface OcRead extends OcListItem {
  iva: string;
  validez_dias: number;
  forma_pago: string | null;
  plazo_pago: string | null;
  observaciones: string | null;
  items: OcDetalle[];
  created_at: string;
  updated_at: string;
}
