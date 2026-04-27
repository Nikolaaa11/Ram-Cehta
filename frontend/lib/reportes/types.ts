/**
 * Tipos locales para Reportes — incluye contratos para endpoints aún no
 * presentes en `types/api.ts` (suscripciones-acciones). Cuando el backend
 * regenere `openapi.json` y se corra `npm run gen:types`, estos tipos pueden
 * migrar a aliases sobre `components["schemas"][...]`.
 */

export interface SuscripcionAccion {
  suscripcion_id: number;
  empresa_codigo: string;
  fecha_recibo: string;
  acciones_pagadas: number;
  monto_uf: string | null;
  monto_clp: string | null;
  contrato_ref: string | null;
  firmado: boolean;
  recibo_url: string | null;
  created_at: string;
}

export interface SuscripcionTotals {
  total_acciones: number;
  total_clp: string;
  total_uf: string;
  total_contratos: number;
}

export type ReporteFiltro = {
  empresa?: string;
  desde?: string;
  hasta?: string;
  anio?: string;
};

export type EmpresaPortafolioStats = {
  codigo: string;
  razon_social: string;
  rut: string | null;
  saldo_contable: string | null;
  saldo_cehta: string | null;
  saldo_corfo: string | null;
  ocs_pendientes: number;
  monto_oc_pendiente: string;
  f29_pendientes: number;
  f29_vencidas: number;
  ultima_actualizacion: string | null;
};
