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

// Dashboard rico por empresa (V3 fase 6) — endpoints empresa-scoped.
export type ResumenCC = components["schemas"]["ResumenCC"];
export type ResumenCCKpis = components["schemas"]["ResumenCCKpis"];
export type ComposicionRow = components["schemas"]["ComposicionRow"];
export type EgresoTipoItem = components["schemas"]["EgresoTipoItem"];
export type EgresoProyectoItem = components["schemas"]["EgresoProyectoItem"];
export type FlujoMensualPoint = components["schemas"]["FlujoMensualPoint"];
export type TransaccionRecienteItem =
  components["schemas"]["TransaccionRecienteItem"];
export type CategoriaBreakdown = components["schemas"]["CategoriaBreakdown"];
export type SubCategoriaItem = components["schemas"]["SubCategoriaItem"];
export type ProyectadoVsRealRow = components["schemas"]["ProyectadoVsRealRow"];

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

// Legal Vault — version history (V4 fase 3).

export interface LegalDocumentVersionRead {
  version_id: number;
  documento_id: number;
  version_number: number;
  snapshot: Record<string, unknown>;
  changed_by?: string | null;
  changed_at: string;
  change_summary?: string | null;
}

export interface LegalDocumentVersionCompareResponse {
  version_a: Record<string, unknown>;
  version_b: Record<string, unknown>;
  diff: Record<string, { before: unknown; after: unknown }>;
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

export interface ProyectoMetadata {
  /** Codigo del Excel original (RHO0001, EE.CHO.001, REVTECH0002…) si fue importado */
  codigo_excel?: string;
  /** Familia de Gantt detectada en la importación */
  imported_format?: GanttFormato;
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
  metadata_?: ProyectoMetadata | null;
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

// ─── Import Excel Gantt (V4 fase 8) ──────────────────────────────────────────

export type GanttFormato = "classic" | "ee" | "revtech" | "unknown";

export interface GanttHitoPreview {
  nombre: string;
  descripcion?: string | null;
  fecha_planificada?: string | null;
  fecha_completado?: string | null;
  estado: string;
  progreso_pct: number;
  orden: number;
  encargado?: string | null;
  monto_real?: number | null;
  monto_proyectado?: number | null;
  actividad_principal?: string | null;
  avance_decimal?: number | null;
}

export interface GanttProyectoPreview {
  codigo: string;
  nombre: string;
  descripcion?: string | null;
  estado: string;
  fecha_inicio?: string | null;
  fecha_fin_estimada?: string | null;
  progreso_pct: number;
  hitos: GanttHitoPreview[];
}

export interface GanttImportPreview {
  formato: GanttFormato;
  empresa_codigo: string;
  proyectos: GanttProyectoPreview[];
  warnings: string[];
  total_proyectos: number;
  total_hitos: number;
}

export interface GanttImportResult {
  formato: GanttFormato;
  empresa_codigo: string;
  proyectos_creados: number;
  proyectos_actualizados: number;
  hitos_creados: number;
  hitos_actualizados: number;
  warnings: string[];
  message: string;
}

export type GanttSyncStatus = "ok" | "not_found" | "error" | "no_dropbox";

export interface GanttSyncAllItem {
  empresa_codigo: string;
  status: GanttSyncStatus;
  formato?: string | null;
  proyectos_creados: number;
  proyectos_actualizados: number;
  hitos_creados: number;
  hitos_actualizados: number;
  message: string;
  dropbox_path?: string | null;
}

export interface GanttSyncAllResult {
  total_empresas: number;
  sincronizadas: number;
  no_encontradas: number;
  con_error: number;
  items: GanttSyncAllItem[];
  proyectos_creados_total: number;
  proyectos_actualizados_total: number;
  hitos_creados_total: number;
  hitos_actualizados_total: number;
  message: string;
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

// ─── Calendar Obligations (V3 fase 9) ────────────────────────────────────────

export type ObligationTipo =
  | "f29"
  | "legal"
  | "oc"
  | "suscripcion"
  | "event";

export type ObligationSeverity = "critical" | "warning" | "info";

export interface ObligationItem {
  id: string;
  tipo: ObligationTipo;
  severity: ObligationSeverity;
  title: string;
  subtitle?: string | null;
  empresa_codigo?: string | null;
  due_date: string; // ISO date YYYY-MM-DD
  days_until: number;
  monto?: string | number | null;
  moneda?: string | null;
  link: string;
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

// ─── Notifications Inbox (V3 fase 8) ─────────────────────────────────────────

export type NotificationTipo =
  | "f29_due"
  | "contrato_due"
  | "oc_pending"
  | "legal_due"
  | "system"
  | "mention";

export type NotificationSeverity = "info" | "warning" | "critical";

export interface Notification {
  id: string;
  user_id: string;
  tipo: NotificationTipo | string;
  severity: NotificationSeverity | string;
  title: string;
  body: string;
  link?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  read_at?: string | null;
  created_at: string;
}

export interface UnreadCount {
  unread: number;
}

export interface GenerateAlertsReport {
  f29_due: number;
  contrato_due: number;
  oc_pending: number;
  total: number;
  errores: string[];
}

// ─── Catálogos ────────────────────────────────────────────────────────────────

export type CatalogosResponse = components["schemas"]["CatalogosResponse"];
export type ConceptoDetallado = components["schemas"]["ConceptoDetallado"];
export type EmpresaCatalogo = components["schemas"]["EmpresaCatalogo"];

// ─── Búsqueda global (Cmd+K) ──────────────────────────────────────────────────
// Definidos a mano hasta el próximo `npm run gen:types`. Mantienen contrato
// 1:1 con `app.schemas.search` (backend).

export type SearchEntityType =
  | "empresa"
  | "orden_compra"
  | "proveedor"
  | "f29"
  | "trabajador"
  | "legal_document"
  | "fondo"
  | "suscripcion";

export interface SearchHit {
  entity_type: SearchEntityType;
  entity_id: string;
  title: string;
  subtitle?: string | null;
  badge?: string | null;
  link: string;
  score?: number;
}

export interface SearchResponse {
  query: string;
  total: number;
  by_entity: Partial<Record<SearchEntityType, SearchHit[]>>;
}

// ─── Exports a Excel ──────────────────────────────────────────────────────────
// El endpoint devuelve binary; no hay schema TS más allá del nombre de entidad.
export type ExportEntityType =
  | "ordenes_compra"
  | "f29"
  | "proveedores"
  | "trabajadores"
  | "legal_documents"
  | "movimientos"
  | "suscripciones"
  | "fondos"
  | "entregables";

// ─── Audit Log (V3 fase 8 — per-action audit trail) ──────────────────────────

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "approve"
  | "reject"
  | "sync"
  | "upload"
  | "other";

export type AuditEntityType =
  | "orden_compra"
  | "f29"
  | "f29_batch"
  | "legal_document"
  | "legal_batch"
  | "trabajador"
  | "trabajador_batch"
  | "empresa"
  | "suscripcion"
  | "fondo"
  | "proveedor"
  | string; // tolerante a entity types nuevos sin re-deployar tipos.

export interface AuditLogList {
  id: string;
  user_id: string | null;
  user_email: string | null;
  action: AuditAction | string;
  entity_type: AuditEntityType;
  entity_id: string;
  entity_label: string | null;
  summary: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
}

export interface AuditLogRead extends AuditLogList {
  diff_before: Record<string, unknown> | null;
  diff_after: Record<string, unknown> | null;
}

// ─── Saved Views (V3 fase 11) ────────────────────────────────────────────────
// Definidos a mano — match con `app.schemas.saved_view` (backend).
// `page` es un literal cerrado: cualquier valor fuera quiebra el tipo y se
// detecta en compile-time tanto en frontend como en backend (Pydantic Literal).

export type SavedViewPage =
  | "oc"
  | "f29"
  | "trabajadores"
  | "proveedores"
  | "legal"
  | "fondos"
  | "entregables"
  | "cartas_gantt"
  | "suscripciones"
  | "calendario";

export interface SavedViewRead {
  id: string;
  user_id: string;
  page: SavedViewPage | string;
  name: string;
  filters: Record<string, unknown>;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface SavedViewCreate {
  page: SavedViewPage;
  name: string;
  filters: Record<string, unknown>;
}

export interface SavedViewUpdate {
  name?: string;
  filters?: Record<string, unknown>;
  is_pinned?: boolean;
}

// ─── Currency conversion (V4 fase 1 — UF/CLP/USD) ────────────────────────────
// Definidos a mano — match con `app.schemas.currency` (backend).

export type CurrencyCode = "CLP" | "UF" | "USD";

export interface CurrencyRateRead {
  currency_code: string;
  date: string; // YYYY-MM-DD
  rate_clp: string | number;
  source: string;
}

export interface ConversionRequest {
  amount: string | number;
  from_currency: CurrencyCode;
  to_currency: CurrencyCode;
  date?: string | null;
}

export interface ConversionResult {
  from_amount: string | number;
  from_currency: string;
  to_amount: string | number | null;
  to_currency: string;
  rate_used: string | number | null;
  date_used: string | null;
}

export interface LatestRatesResponse {
  uf_clp: string | number | null;
  usd_clp: string | number | null;
  date: string;
}

// ─── Portfolio Consolidado USD (V4 fase 4) ───────────────────────────────────
// Definidos a mano — match con `app.schemas.portfolio` (backend).
// La vista cross-empresa que el CEO usa para LP reporting (LPs en USD).

export interface EmpresaPortfolioRow {
  empresa_codigo: string;
  razon_social: string;
  saldo_native: string | number;
  currency_native: string; // "CLP" | "UF" | "USD"
  saldo_clp: string | number;
  saldo_usd: string | number | null;
  percent_of_portfolio: string | number;
}

export interface CurrencyBreakdownItem {
  currency: string; // "CLP" | "UF" | "USD"
  total_clp: string | number;
  percent: string | number;
}

export interface PortfolioMonthlyPoint {
  periodo: string;
  fecha_inicio: string; // YYYY-MM-DD
  total_clp: string | number;
  total_usd: string | number | null;
}

export interface PortfolioRatesUsed {
  uf_clp: string | number | null;
  usd_clp: string | number | null;
  date: string;
}

export interface PortfolioConsolidated {
  generated_at: string;
  total_clp: string | number;
  total_usd: string | number | null;
  total_uf: string | number | null;
  empresas: EmpresaPortfolioRow[];
  currency_breakdown: CurrencyBreakdownItem[];
  monthly_trend: PortfolioMonthlyPoint[];
  rates_used: PortfolioRatesUsed;
  warnings: string[];
}

// ─── Bulk operations ──────────────────────────────────────────────────────────
// Definidos a mano — match con `app.schemas.bulk` (backend).

export interface BulkUpdateEstadoRequest {
  ids: number[];
  estado: string;
}

export interface BulkDeleteRequest {
  ids: number[];
}

export interface BulkItemError {
  id: number;
  detail: string;
}

export interface BulkUpdateResult {
  operation: "update_estado" | "delete";
  requested: number;
  succeeded: number;
  failed: BulkItemError[];
}

// ─── Document Analyzer (V3 fase 7 + V4 fase 1 OCR) ──────────────────────────
// Definidos a mano — match con `app.schemas.document_extraction` (backend).
// V4 fase 1 sumó `extraction_method` y `ocr_pages` para reportar al frontend
// si el texto se extrajo con OCR (PDFs escaneados) y cuántas páginas se
// procesaron — útil para mostrar el chip "OCR aplicado" y explicar latencia.

export type DocumentExtractionMethod =
  | "pypdf"
  | "ocr"
  | "hybrid"
  | "image_ocr"
  | "docx"
  | "text"
  | "failed";

export interface DocumentExtraction {
  tipo_detectado: string;
  confidence: number;
  fields: Record<string, unknown>;
  raw_text_preview: string;
  warnings: string[];
  extraction_method?: DocumentExtractionMethod | string | null;
  ocr_pages?: number | null;
}

// ─── Bulk CSV Import (V3 fase 11) ─────────────────────────────────────────────
// Definidos a mano — match con `app.schemas.bulk_import` (backend).

export type BulkImportEntityType = "trabajadores" | "fondos" | "proveedores";

export interface InvalidRow {
  row_index: number;
  errors: string[];
  original: Record<string, unknown>;
}

export interface DuplicateRow {
  row_index: number;
  key: string;
  existing_id: number | null;
  original: Record<string, unknown>;
}

export interface ValidRow {
  row_index: number;
  data: Record<string, unknown>;
}

export interface ValidationReport {
  entity_type: string;
  total_rows: number;
  valid_rows: number;
  invalid_rows: InvalidRow[];
  duplicates: DuplicateRow[];
  valid: ValidRow[];
}

export interface ImportRowError {
  row_index: number;
  detail: string;
}

export interface ImportResult {
  entity_type: string;
  created: number;
  skipped: number;
  errors: ImportRowError[];
}

// ─── 2FA TOTP (V4 fase 2) ────────────────────────────────────────────────────
// Definidos a mano — match con `app.schemas.two_factor` (backend).
// El secret y los backup_codes solo viajan en la respuesta de `enroll` /
// `regenerate-backup-codes` y se descartan apenas el user los copia.

export interface TwoFactorStatus {
  enabled: boolean;
  enabled_at: string | null;
  backup_codes_remaining: number;
}

export interface TwoFactorEnrollResponse {
  secret: string;
  provisioning_uri: string;
  qr_url: string;
  backup_codes: string[];
}

export interface TwoFactorVerifyRequest {
  code: string;
}

export interface TwoFactorBackupCodesResponse {
  backup_codes: string[];
}

// Alias requerido por el spec de la fase: nombres más cortos para uso en componentes.
export type EnrollResponse = TwoFactorEnrollResponse;

// ─── User preferences (V4 fase 4 — onboarding tour) ──────────────────────────
// Generic key-value store per-user. Cada `key` tiene su propio shape de
// `value` que el callsite garantiza (no validado a nivel de API).

export type UserPreferenceValue =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null;

export interface UserPreferenceRead {
  key: string;
  value: UserPreferenceValue;
}

export interface UserPreferenceUpdate {
  value: UserPreferenceValue;
}

/** Shape canónico para `key=onboarding_tour`. */
export interface TourState {
  completed: boolean;
  current_step: number;
}
