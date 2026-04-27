from fastapi import APIRouter

from app.api.v1 import (
    admin_users,
    audit,
    auth,
    catalogos,
    dashboard,
    dropbox,
    f29,
    health,
    movimientos,
    ordenes_compra,
    proveedores,
    suscripciones,
    validate,
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
