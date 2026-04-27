/**
 * Aliases tipados desde el OpenAPI auto-generado (Disciplina 5).
 *
 * Los nombres "*Read" / "*Create" / "*Update" provienen de los schemas Pydantic
 * del backend. Algunas APIs históricamente usaban nombres cortos (`OcRead`,
 * `OcListItem`, `OcDetalle`, `UserMe`) — los re-exportamos como aliases para
 * minimizar churn en los componentes existentes.
 *
 * REGENERAR: `npm run gen:types` (lee ../backend/openapi.json).
 *   Para regenerar el openapi.json del backend:
 *     cd backend && python -c "import json; from app.main import app; json.dump(app.openapi(), open('openapi.json','w'), indent=2)"
 */
import type { components } from "@/types/api";

// ─── Common ──────────────────────────────────────────────────────────────────

/**
 * Wrapper genérico de paginación. openapi-typescript genera tipos concretos
 * (`Page_ProveedorRead_`, etc.) por cada instancia paramétrica, sin un genérico
 * reutilizable. Mantenemos `Page<T>` manual: la estructura está fijada por
 * `app.schemas.common.Page` en backend y replica el contrato sin pérdida.
 */
export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
  pages: number;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export type UserMeResponse = components["schemas"]["UserMeResponse"];
export type UserMe = UserMeResponse;
export type UserRoleItem = components["schemas"]["UserRoleItem"];
export type SetRoleRequest = components["schemas"]["SetRoleRequest"];

// ─── Proveedor ────────────────────────────────────────────────────────────────

export type ProveedorRead = components["schemas"]["ProveedorRead"];
export type ProveedorCreate = components["schemas"]["ProveedorCreate"];
export type ProveedorUpdate = components["schemas"]["ProveedorUpdate"];

// ─── Órdenes de Compra ────────────────────────────────────────────────────────

export type OrdenCompraRead = components["schemas"]["OrdenCompraRead"];
export type OrdenCompraListItem = components["schemas"]["OrdenCompraListItem"];
export type OrdenCompraCreate = components["schemas"]["OrdenCompraCreate"];
export type OCDetalleRead = components["schemas"]["OCDetalleRead"];
export type EstadoUpdateRequest = components["schemas"]["EstadoUpdateRequest"];

// Alias históricos (compat).
export type OcRead = OrdenCompraRead;
export type OcListItem = OrdenCompraListItem;
export type OcDetalle = OCDetalleRead;

// ─── Movimiento ───────────────────────────────────────────────────────────────

export type MovimientoRead = components["schemas"]["MovimientoRead"];
export type MovimientoReciente = components["schemas"]["MovimientoReciente"];

// ─── F29 ──────────────────────────────────────────────────────────────────────

export type F29Read = components["schemas"]["F29Read"];
export type F29Create = components["schemas"]["F29Create"];
export type F29EstadoUpdate = components["schemas"]["F29EstadoUpdate"];
export type F29Resumen = components["schemas"]["F29Resumen"];

// ─── Dashboard ────────────────────────────────────────────────────────────────

export type DashboardResponse = components["schemas"]["DashboardResponse"];
export type DashboardData = DashboardResponse;
export type SaldoEmpresa = components["schemas"]["SaldoEmpresa"];
export type OcResumen = components["schemas"]["OCResumen"];

// Endpoints ultra-pro (commit ebe35c8)
export type DashboardKPIs = components["schemas"]["DashboardKPIs"];
export type CashflowResponse = components["schemas"]["CashflowResponse"];
export type CashflowPoint = components["schemas"]["CashflowPoint"];
export type EgresoConcepto = components["schemas"]["EgresoConcepto"];
export type SaldoEmpresaDetalle = components["schemas"]["SaldoEmpresaDetalle"];
export type IvaPoint = components["schemas"]["IvaPoint"];
export type ProyectoRanking = components["schemas"]["ProyectoRanking"];

/** Estado del último ETL: success | failed | stale | unknown. */
export type EtlStatus = "success" | "failed" | "stale" | "unknown" | string;

// ─── Catálogos ────────────────────────────────────────────────────────────────

export type CatalogosResponse = components["schemas"]["CatalogosResponse"];
export type ConceptoDetallado = components["schemas"]["ConceptoDetallado"];
export type EmpresaCatalogo = components["schemas"]["EmpresaCatalogo"];
