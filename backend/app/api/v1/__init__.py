from fastapi import APIRouter

from app.api.v1 import (
    admin_users,
    ai,
    api_tokens,
    approval_rules,
    areas,
    audit,
    audit_integrity,
    auth,
    avance,
    bitacora,
    bulk_import,
    calendar,
    cartolas,
    conciliacion,
    catalogos,
    currency,
    dashboard,
    digest,
    documents,
    dropbox,
    empresa,
    entregables,
    estados_financieros,
    etl,
    exports,
    f22,
    f29,
    fondo_actas,
    fondos,
    health,
    informes_lp,
    legal,
    lp_contratos,
    lp_documents,
    mailbox,
    me_preferences,
    movimientos,
    notifications,
    notifications_inbox,
    nubox_export,
    ordenes_compra,
    ordenes_compra_extract,
    plan_cuentas,
    policies_fondo,
    portfolio,
    proveedores,
    proyectos_contables,
    reportes_contables,
    reset_data,
    saved_views,
    search,
    suscripciones,
    trabajadores,
    two_factor,
    validate,
    voucher_templates,
    vouchers,
    vouchers_demo,
    vouchers_extract,
    vouchers_nubox_form,
    vouchers_transferencia,
    webhooks,
)
from app.api.v1 import (
    status as status_router,
)
from app.api.v1 import stream as stream_router

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(health.router, tags=["health"])
api_router.include_router(validate.router, prefix="/validate", tags=["validate"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(proveedores.router, prefix="/proveedores", tags=["proveedores"])
api_router.include_router(catalogos.router, prefix="/catalogos", tags=["catalogos"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])
# V5++ ola CG — Extract OC desde archivo / texto con IA.
# IMPORTANTE: registrar antes del router principal porque sus rutas
# estaticas (/extract-from-upload, /extract-from-text) chocarian con
# /{oc_id} del router principal.
api_router.include_router(
    ordenes_compra_extract.router, prefix="/ordenes-compra", tags=["ordenes-compra-extract"]
)
api_router.include_router(ordenes_compra.router, prefix="/ordenes-compra", tags=["ordenes-compra"])
api_router.include_router(movimientos.router, prefix="/movimientos", tags=["movimientos"])
api_router.include_router(f29.router, prefix="/f29", tags=["f29"])
# V5+: F22 anual — declaración impuesto a la renta. Mismo dominio que F29
# pero cadencia anual (vence en abril del año siguiente al período).
api_router.include_router(f22.router, prefix="/f22", tags=["f22"])
# V5++: Cartolas Bancarias — OCR de PDFs Dropbox a core.movimientos.
# Sin prefix porque las rutas tienen /sync/{empresa} y /runs adentro.
api_router.include_router(cartolas.router, tags=["cartolas"])
api_router.include_router(suscripciones.router, prefix="/suscripciones", tags=["suscripciones"])
# V5++ ola AL — LP contratos FIP CEHTA ESG (promesas + definitivos).
api_router.include_router(lp_contratos.router, prefix="/lp-contratos", tags=["lp-contratos"])
api_router.include_router(audit.router, prefix="/audit", tags=["audit"])
# V5++ ola BS — Audit integrity (re-habilitado tras fix de database.py)
api_router.include_router(
    audit_integrity.router, prefix="/audit", tags=["audit-integrity"]
)
# V5++ ola AO — Bitácora: vista unificada de actividad por usuario.
# Combina action_log (entity diffs) + http_mutations (cada request) en
# endpoints amigables para UI: /user/{email}, /empresa/{codigo}, /timeline.
api_router.include_router(bitacora.router, prefix="/bitacora", tags=["bitacora"])
api_router.include_router(admin_users.router, prefix="/admin", tags=["admin"])
api_router.include_router(dropbox.router, prefix="/dropbox", tags=["dropbox"])
api_router.include_router(trabajadores.router, prefix="/trabajadores", tags=["trabajadores"])
api_router.include_router(ai.router, prefix="/ai", tags=["ai"])
api_router.include_router(legal.router, prefix="/legal", tags=["legal"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(notifications_inbox.router, prefix="/inbox", tags=["inbox"])
api_router.include_router(etl.router, prefix="/etl", tags=["etl"])
api_router.include_router(avance.router, prefix="/avance", tags=["avance"])
api_router.include_router(calendar.router, prefix="/calendar", tags=["calendar"])
api_router.include_router(fondos.router, prefix="/fondos", tags=["fondos"])
api_router.include_router(empresa.router, prefix="/empresa", tags=["empresa"])
api_router.include_router(documents.router, prefix="/documents", tags=["documents"])
api_router.include_router(search.router, prefix="/search", tags=["search"])
api_router.include_router(exports.router, prefix="/exports", tags=["exports"])
api_router.include_router(digest.router, prefix="/digest", tags=["digest"])
api_router.include_router(saved_views.router, prefix="/me", tags=["saved-views"])
# 2FA TOTP routes also live bajo `/me` (V4 fase 2). FastAPI permite múltiples
# routers con el mismo prefix — cada uno declara sus paths internos.
api_router.include_router(two_factor.router, prefix="/me", tags=["two-factor"])
# V4 fase 4: preferences key-value genérico (onboarding_tour, theme, etc.)
api_router.include_router(me_preferences.router, prefix="/me", tags=["me-preferences"])
api_router.include_router(bulk_import.router, prefix="/bulk-import", tags=["bulk-import"])
api_router.include_router(status_router.router, prefix="/admin", tags=["admin-status"])
api_router.include_router(currency.router, prefix="/currency", tags=["currency"])
api_router.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])
api_router.include_router(stream_router.router, prefix="/stream", tags=["stream"])
api_router.include_router(api_tokens.router, prefix="/api-tokens", tags=["api-tokens"])
# V4 fase 4: portfolio consolidado USD cross-empresa (LP reporting).
api_router.include_router(portfolio.router, prefix="/portfolio", tags=["portfolio"])
# V4 fase 6: entregables regulatorios (CMF / CORFO / UAF / Auditorías) — compliance AFIS S.A.
api_router.include_router(entregables.router, prefix="/entregables", tags=["entregables"])
# V4 fase 9: Informes LP virales — pipeline LPs + reportes con tracking 1→N.
# Router sin prefix porque expone DOS recursos siblings: /lps y /informes-lp.
# Las rutas /informes-lp/by-token/{token}/* son PÚBLICAS (token = auth).
api_router.include_router(informes_lp.router, tags=["informes-lp"])
# V5: Políticas internas del FIP (reglamento, manual UAF, código ética, etc.).
# Distinto de /legal (que es por empresa portfolio).
api_router.include_router(
    policies_fondo.router, prefix="/policies-fondo", tags=["policies-fondo"]
)
# V5: Vault de documentos por LP (contratos suscripción, KYC, side letters,
# recibos aporte, W-8/W-9, pasaportes, etc.). Sin prefix porque las URLs
# tienen `{lp_id}` adentro: /lps/{lp_id}/documents.
api_router.include_router(lp_documents.router, tags=["lp-documents"])
# V5: Actas formales del FIP — Directorio AFIS, Comité Inversión, Asamblea
# LPs, Comité Vigilancia. Distinto de actas en legal_documents (por empresa
# portfolio).
api_router.include_router(
    fondo_actas.router, prefix="/fondo-actas", tags=["fondo-actas"]
)
# V5: EEFF cross-empresa — balance, estado resultados, flujo caja por
# empresa portfolio + período. Sync desde Dropbox /04-Financiero/.
# V5: Plan de cuentas + importer .xlsx — fundación del módulo Vouchers/Contabilidad.
# Router sin prefix porque las rutas son /admin/plan-cuentas/...
api_router.include_router(plan_cuentas.router, tags=["plan-cuentas"])
# V5++ ola AM: Form Nubox-style (header + Información Contable + Financiera)
# que matchea el Excel "documento para claude boucher". GET form-metadata
# + POST nubox-form. Crea voucher COMPRA con partida doble cuadrada.
# IMPORTANTE: este router DEBE registrarse antes de vouchers.router porque
# sus paths (/vouchers/form-metadata, /vouchers/nubox-form) chocarían con
# /vouchers/{voucher_id: int} y FastAPI devolvería 422 Unprocessable.
api_router.include_router(
    vouchers_nubox_form.router, prefix="/vouchers", tags=["vouchers-nubox-form"]
)
# V5++ ola CE: Extraccion IA desde upload (imagen / PDF / DOCX / PPTX).
# Endpoint /vouchers/extract-from-upload que NO crea el voucher, solo
# devuelve los campos extraidos para que el FE los muestre en un form
# editable. Mismo motivo de orden: ruta estatica antes que vouchers.router.
api_router.include_router(
    vouchers_extract.router, prefix="/vouchers", tags=["vouchers-extract"]
)
# Round 11 — Generador Excel transferencia masiva desde vouchers APPROVED.
# Tambien debe registrarse antes de vouchers.router porque
# /vouchers/transferencia-masiva chocaria con /vouchers/{voucher_id}.
api_router.include_router(
    vouchers_transferencia.router,
    prefix="/vouchers",
    tags=["vouchers-transferencia"],
)
# V5++ ola AB: Plantillas reutilizables para vouchers recurrentes (sueldos,
# arriendos, servicios mensuales). save-as-template + use-template flow.
# IMPORTANTE: mismo motivo de orden — /vouchers/templates colisiona con
# /vouchers/{voucher_id}.
api_router.include_router(voucher_templates.router, tags=["voucher-templates"])
# V5: Vouchers (comprobantes contables) — corazón del módulo. Líneas
# debe/haber con imputación triple cuenta + proyecto + área. Partida
# doble validada en 3 capas (Pydantic + trigger Postgres + UI).
# Va al final porque tiene /vouchers/{voucher_id: int} que matchearía
# cualquier path string si se registra antes que los routers hermanos.
api_router.include_router(vouchers.router, tags=["vouchers"])
# V5: Proyectos contables (formales para imputación, distintos de los
# Gantts operativos). CRUD + endpoint /avance con presupuesto vs ejecutado.
api_router.include_router(proyectos_contables.router, tags=["proyectos-contables"])
# V5: Áreas (centros de costo). CRUD + matriz aplica por empresa.
api_router.include_router(areas.router, tags=["areas"])
# V5 Fase 2: Approval rules + user_company_roles para flujo de aprobación
# de vouchers con firma SHA-256.
api_router.include_router(approval_rules.router, tags=["approval-rules"])
# V5 Fase 3: Exportación a Nubox (CSV) — vouchers APPROVED → batch CSV
# que el COO carga manualmente en Nubox + asigna folios devueltos.
api_router.include_router(nubox_export.router, tags=["nubox-export"])
# V5 Fase 4: Reportes contables formales — Libro Diario / Mayor /
# P&L proyecto / P&L área / Rendición CORFO.
api_router.include_router(reportes_contables.router, tags=["reportes-contables"])
# V5 Fase 5: Conciliación bancaria voucher ↔ movimiento.
api_router.include_router(conciliacion.router, tags=["conciliacion"])
# V5++ ola CD: endpoints de reset/clear data por módulo (gantt, f29, etc.)
# Para borrar datos viejos antes de re-importar con info actualizada.
api_router.include_router(reset_data.router, tags=["reset-data"])
# V5: Seed/cleanup de vouchers demo para probar el dashboard sin
# crear vouchers manualmente.
api_router.include_router(vouchers_demo.router, tags=["vouchers-demo"])
api_router.include_router(
    estados_financieros.router,
    prefix="/estados-financieros",
    tags=["estados-financieros"],
)
# V5+: Email inbox de contactocehta@gmail.com — IMAP poll + Claude clasifica
# + draft response. Endpoints viven bajo /admin/mailbox/* (las rutas internas
# del router ya incluyen ese prefix).
api_router.include_router(mailbox.router, tags=["mailbox"])
