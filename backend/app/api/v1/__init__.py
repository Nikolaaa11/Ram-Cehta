from fastapi import APIRouter

from app.api.v1 import (
    admin_users,
    ai,
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
    movimientos,
    notifications,
    notifications_inbox,
    ordenes_compra,
    proveedores,
    saved_views,
    search,
    suscripciones,
    trabajadores,
    validate,
)
from app.api.v1 import (
    status as status_router,
)

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
api_router.include_router(bulk_import.router, prefix="/bulk-import", tags=["bulk-import"])
api_router.include_router(status_router.router, prefix="/admin", tags=["admin-status"])
api_router.include_router(currency.router, prefix="/currency", tags=["currency"])
