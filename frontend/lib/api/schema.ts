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

// CEO Dashboard (V3 fase 3+4) — usa los tipos OpenAPI auto-generados.
export type CEOConsolidatedReport = components["schemas"]["CEOConsolidatedReport"];
export type EmpresaCEOKPIs = components["schemas"]["EmpresaCEOKPIs"];
export type HeatmapCell = components["schemas"]["HeatmapCell"];
export type CeoAlert = components["schemas"]["Alert"];

// Legal Vault (V3 fase 3+4) — los tipos manuales se complementan con los
// generados; mantenemos los manual `LegalCategoria` / `LegalEstado` por DX
// (autocomplete con literal union sin pagar el costo de pasar por openapi).
export type LegalCategoria =
  | "contrato"
  | "acta"
  | "declaracion_sii"
  | "permiso"
  | "poliza"
  | "estatuto"
  | "otro";

export type LegalEstado =
  | "vigente"
  | "vencido"
  | "renovado"
  | "cancelado"
  | "borrador";

export interface LegalDocumentListItem {
  documento_id: number;
  empresa_codigo: string;
  categoria: string;
  subcategoria?: string | null;
  nombre: string;
  contraparte?: string | null;
  fecha_vigencia_hasta?: string | null;
  monto?: string | number | null;
  moneda?: string | null;
  estado: string;
  dias_para_vencer?: number | null;
  alerta_nivel?: string | null;
}

export interface LegalDocumentRead extends LegalDocumentListItem {
  descripcion?: string | null;
  fecha_emision?: string | null;
  fecha_vigencia_desde?: string | null;
  dropbox_path?: string | null;
  uploaded_by?: string | null;
  uploaded_at: string;
  updated_at: string;
}

export interface LegalDocumentCreate {
  empresa_codigo: string;
  categoria: LegalCategoria;
  subcategoria?: string | null;
  nombre: string;
  descripcion?: string | null;
  contraparte?: string | null;
  fecha_emision?: string | null;
  fecha_vigencia_desde?: string | null;
  fecha_vigencia_hasta?: string | null;
  monto?: number | null;
  moneda?: string | null;
  estado?: LegalEstado;
}

export interface LegalAlert {
  documento_id: number;
  empresa_codigo: string;
  categoria: string;
  nombre: string;
  contraparte?: string | null;
  fecha_vigencia_hasta?: string | null;
  dias_para_vencer: number;
  alerta_nivel: string;
}

/** Estado del último ETL: success | failed | stale | unknown. */
export type EtlStatus = "success" | "failed" | "stale" | "unknown" | string;

// ─── Avance / Gantt (V3 fase 5) ──────────────────────────────────────────────

export type EstadoProyecto =
  | "planificado"
  | "en_progreso"
  | "completado"
  | "cancelado"
  | "pausado";
export type EstadoHito =
  | "pendiente"
  | "en_progreso"
  | "completado"
  | "cancelado";
export type Severidad = "alta" | "media" | "baja";
export type Probabilidad = "alta" | "media" | "baja";
export type EstadoRiesgo = "abierto" | "mitigado" | "aceptado" | "cerrado";

export interface HitoRead {
  hito_id: number;
  proyecto_id: number;
  nombre: string;
  descripcion?: string | null;
  fecha_planificada?: string | null;
  fecha_completado?: string | null;
  estado: string;
  orden: number;
  progreso_pct: number;
  deliverable_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RiesgoRead {
  riesgo_id: number;
  proyecto_id?: number | null;
  empresa_codigo?: string | null;
  titulo: string;
  descripcion?: string | null;
  severidad: string;
  probabilidad: string;
  estado: string;
  owner_email?: string | null;
  mitigacion?: string | null;
  fecha_identificado: string;
  fecha_cierre?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProyectoRead {
  proyecto_id: number;
  empresa_codigo: string;
  nombre: string;
  descripcion?: string | null;
  fecha_inicio?: string | null;
  fecha_fin_estimada?: string | null;
  estado: string;
  progreso_pct: number;
  owner_email?: string | null;
  dropbox_roadmap_path?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProyectoListItem extends ProyectoRead {
  hitos: HitoRead[];
  riesgos_abiertos: number;
}

export interface ProyectoCreate {
  empresa_codigo: string;
  nombre: string;
  descripcion?: string | null;
  fecha_inicio?: string | null;
  fecha_fin_estimada?: string | null;
  estado?: EstadoProyecto;
  progreso_pct?: number;
  owner_email?: string | null;
}

export interface HitoCreate {
  nombre: string;
  descripcion?: string | null;
  fecha_planificada?: string | null;
  estado?: EstadoHito;
  orden?: number;
  progreso_pct?: number;
}

export interface RiesgoCreate {
  proyecto_id?: number | null;
  empresa_codigo?: string | null;
  titulo: string;
  descripcion?: string | null;
  severidad?: Severidad;
  probabilidad?: Probabilidad;
  estado?: EstadoRiesgo;
  owner_email?: string | null;
  mitigacion?: string | null;
}

// ─── Calendar (V3 fase 5) ────────────────────────────────────────────────────

export type TipoEvento =
  | "f29"
  | "reporte_lp"
  | "comite"
  | "reporte_trimestral"
  | "vencimiento"
  | "otro";

export interface CalendarEventRead {
  event_id: number;
  titulo: string;
  descripcion?: string | null;
  tipo: string;
  empresa_codigo?: string | null;
  fecha_inicio: string;
  fecha_fin?: string | null;
  todo_el_dia: boolean;
  recurrencia?: string | null;
  notificar_dias_antes: number;
  notificar_emails?: string[] | null;
  auto_generado: boolean;
  completado: boolean;
  created_at: string;
  updated_at: string;
}

export interface CalendarEventCreate {
  titulo: string;
  descripcion?: string | null;
  tipo: TipoEvento;
  empresa_codigo?: string | null;
  fecha_inicio: string;
  fecha_fin?: string | null;
  todo_el_dia?: boolean;
  notificar_dias_antes?: number;
}

export interface AgentRunReport {
  f29_eventos_creados: number;
  reporte_lp_eventos_creados: number;
  total_creados: number;
  errores: string[];
}

// ─── Fondos (V3 fase 5) ──────────────────────────────────────────────────────

export type TipoFondo =
  | "lp"
  | "banco"
  | "programa_estado"
  | "family_office"
  | "vc"
  | "angel"
  | "otro";

export type EstadoOutreach =
  | "no_contactado"
  | "contactado"
  | "en_negociacion"
  | "cerrado"
  | "descartado";

export interface FondoListItem {
  fondo_id: number;
  nombre: string;
  tipo: string;
  pais?: string | null;
  ticket_min_usd?: string | number | null;
  ticket_max_usd?: string | number | null;
  sectores?: string[] | null;
  estado_outreach: string;
  fecha_proximo_contacto?: string | null;
}

export interface FondoRead extends FondoListItem {
  descripcion?: string | null;
  region?: string | null;
  stage?: string[] | null;
  thesis?: string | null;
  website?: string | null;
  contacto_nombre?: string | null;
  contacto_email?: string | null;
  contacto_linkedin?: string | null;
  notas?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FondoCreate {
  nombre: string;
  tipo: TipoFondo;
  descripcion?: string | null;
  pais?: string | null;
  region?: string | null;
  ticket_min_usd?: number | null;
  ticket_max_usd?: number | null;
  sectores?: string[] | null;
  stage?: string[] | null;
  thesis?: string | null;
  website?: string | null;
  contacto_nombre?: string | null;
  contacto_email?: string | null;
  contacto_linkedin?: string | null;
  estado_outreach?: EstadoOutreach;
  fecha_proximo_contacto?: string | null;
  notas?: string | null;
}

export interface FondoStats {
  total: number;
  por_tipo: Record<string, number>;
  por_estado: Record<string, number>;
}

// ─── Catálogos ────────────────────────────────────────────────────────────────

export type CatalogosResponse = components["schemas"]["CatalogosResponse"];
export type ConceptoDetallado = components["schemas"]["ConceptoDetallado"];
export type EmpresaCatalogo = components["schemas"]["EmpresaCatalogo"];
