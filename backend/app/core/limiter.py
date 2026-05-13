"""V5++ ola CJ — Limiter compartido entre main.py y routers.

Los routers que necesiten aplicar `@limiter.limit("X/minute")` a un
endpoint específico importan este `limiter`. Antes vivía solo en
main.py y no era reutilizable.

Uso típico en un router:

    from app.core.limiter import limiter
    from fastapi import Request

    @router.post("/...")
    @limiter.limit("5/minute")
    async def mi_handler(request: Request, ...):
        ...

NOTA: slowapi requiere que el handler reciba `request: Request` en sus
parámetros (no como dependency, como param directo). Si lo declarás como
`Annotated[Request, Depends(...)]` slowapi no lo encuentra.
"""
from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address


# Limiter global. `default_limits` aplica a TODOS los endpoints (incluso
# los que no tienen decorator específico) — 100/min protege contra abuso
# de endpoints no auditados.
limiter = Limiter(key_func=get_remote_address, default_limits=["100/minute"])
