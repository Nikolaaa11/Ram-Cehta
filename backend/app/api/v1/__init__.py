from fastapi import APIRouter

from app.api.v1 import (
    admin_users,
    ai,
    api_tokens,
    audit,
    auth,
    avance,
    bulk_import,
    calendar,
    catalogos,
    currency,
    dashboard,
    digest,
    documents,
    dropbox,
    empresa,
    etl,
    exports,
    f29,
    fondos,
    health,
    legal,
    me_preferences,
    movimientos,
    notifications,
    notifications_inbox,
    ordenes_compra,
    portfolio,
    proveedores,
    saved_views,
    search,
    suscripciones,
    trabajadores,
    two_factor,
    validate,
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
api_router.include_router(ordenes_compra.router, prefix="/ordenes-compra", tags=["ordenes-compra"])
api_router.include_router(movimientos.router, prefix="/movimientos", tags=["movimientos"])
api_router.include_router(f29.router, prefix="/f29", tags=["f29"])
api_router.include_router(suscripciones.router, prefix="/suscripciones", tags=["suscripciones"])
api_router.include_router(audit.router, prefix="/audit", tags=["audit"])
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
