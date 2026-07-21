"""V5++ ola AE — HTTP mutation audit middleware.

Captura TODA mutación (POST/PATCH/PUT/DELETE) en `audit.http_mutations`.
Diferente del audit_service (que captura diffs entity-level), esto es un
trail de bajo nivel:

    timestamp | user_email | method | path | status | latency_ms | ip

Sirve para:
  - Forense: "¿qué hizo el user X en la última hora?"
  - Detección de abuso: bursts de 100 POST/min
  - Compliance: traceabilidad completa de requests, no solo CRUD entity-level

NO captura body (privacy + tamaño). Para detalles, los handlers siguen
llamando `audit_log()` que va a `audit.action_log` con diffs.

Performance: <1ms overhead (un INSERT async fire-and-forget). Si falla,
solo loggea warning — nunca rompe la response.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.database import get_session
from app.core.logging import get_logger

log = get_logger(__name__)


# Métodos que consideramos "mutación". GET/HEAD/OPTIONS no se loggean.
_MUTATION_METHODS = {"POST", "PATCH", "PUT", "DELETE"}

# Paths que excluimos (ruido o health checks)
_EXCLUDE_PATHS: tuple[str, ...] = (
    "/health",
    "/api/v1/health",
    "/api/v1/events/stream",  # SSE keepalive
)


class HttpMutationAuditMiddleware(BaseHTTPMiddleware):
    """Loggea cada request mutante en audit.http_mutations.

    Best-effort: si la inserción falla, el handler ya devolvió response
    al cliente — solo registramos warning. No bloqueamos.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        method = request.method
        path = request.url.path

        # Solo mutaciones, excluyendo health/SSE
        should_audit = (
            method in _MUTATION_METHODS
            and not any(path.startswith(p) for p in _EXCLUDE_PATHS)
        )

        if not should_audit:
            return await call_next(request)

        # Capturar timestamps + auth previo a dispatchar
        started = time.perf_counter()
        user_email = _peek_user_email(request)
        ip = _client_ip(request)
        ua = (request.headers.get("user-agent") or "")[:256]

        response = await call_next(request)

        latency_ms = int((time.perf_counter() - started) * 1000)
        status_code = response.status_code

        # MEGAPROMPT PERF — fire-and-forget DE VERDAD: antes el comentario
        # decía "no await en flujo crítico" pero el await estaba igual,
        # sumando ~40-60ms (INSERT + commit a São Paulo) y una conexión
        # extra del pool a CADA mutación antes de responder al cliente.
        # create_task despacha el INSERT en background; el trail es
        # best-effort igual que siempre (los errores solo se loggean).
        async def _log_in_background() -> None:
            try:
                await _insert_mutation_log(
                    method=method,
                    path=path,
                    status_code=status_code,
                    latency_ms=latency_ms,
                    user_email=user_email,
                    ip=ip,
                    user_agent=ua,
                )
            except Exception as exc:  # noqa: BLE001
                log.warning(
                    "audit_mutation_insert_failed",
                    error=str(exc),
                    method=method,
                    path=path,
                )

        asyncio.create_task(_log_in_background())

        return response


def _client_ip(request: Request) -> str | None:
    """Extrae IP del request. Soporta X-Forwarded-For si está detrás de proxy."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # Primera IP del chain es la del cliente original
        return forwarded.split(",")[0].strip()
    client = getattr(request, "client", None)
    return getattr(client, "host", None) if client else None


def _peek_user_email(request: Request) -> str | None:
    """Best-effort: decodea el JWT del Authorization header sin validar
    para extraer el email. Si falla, retorna None y se loggea sin email."""
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return None
    try:
        import jose.jwt as _jwt

        token = auth.split(" ", 1)[1].strip()
        # NO verificamos firma — solo extraemos claims para logging
        claims = _jwt.get_unverified_claims(token)
        return claims.get("email")
    except Exception:
        return None


async def _insert_mutation_log(
    *,
    method: str,
    path: str,
    status_code: int,
    latency_ms: int,
    user_email: str | None,
    ip: str | None,
    user_agent: str | None,
) -> None:
    """Inserta en audit.http_mutations. Abre su propia sesión async."""
    from sqlalchemy import text

    async for session in get_session():
        await session.execute(
            text(
                """
                INSERT INTO audit.http_mutations
                    (method, path, status_code, latency_ms, user_email, ip, user_agent)
                VALUES
                    (:method, :path, :status_code, :latency_ms, :user_email, :ip, :user_agent)
                """
            ),
            {
                "method": method,
                "path": path[:512],  # truncate paths largos
                "status_code": status_code,
                "latency_ms": latency_ms,
                "user_email": user_email,
                "ip": ip,
                "user_agent": user_agent,
            },
        )
        await session.commit()
        break
