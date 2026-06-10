"""R152PPPPP · Middleware de telemetría de uso por endpoint.

Por qué este middleware existe:
    Antes de apagar features inertes, necesitamos saber cuáles se usan
    de verdad. Sin esto, "apagar lo que probablemente no se usa" es
    apagar a ciegas. Esta tabla nos permite decidir con datos:

        SELECT path, COUNT(*) AS hits, COUNT(DISTINCT user_id) AS users
        FROM core.feature_usage
        WHERE created_at > NOW() - INTERVAL '30 days'
        GROUP BY path
        ORDER BY hits ASC;
        -- Los 20 endpoints con menos hits son candidatos a borrar.

Diseño:
    1. Buffer in-memory. Cada request agrega 1 row al buffer.
    2. Background task flushea el buffer a DB cada 10s o cada 100 rows
       (lo que ocurra primero). Bulk INSERT con UNNEST → 1 query por flush.
    3. NUNCA bloquea el request. Si el buffer está lleno, droppea silencioso
       (telemetría no puede romper la app). Si DB falla, loggea warning.
    4. No persiste request body ni query params (privacy: pueden tener data
       sensible de un FIP).

Costo:
    - Memoria: ~150 bytes/row × buffer 100 = 15KB. Despreciable.
    - DB: 1 INSERT cada 10s con ~10-100 rows. ~6 inserts/min. Despreciable.
    - CPU: ~0.05ms por request para construir la row. Despreciable.

Lo que NO captura (por diseño):
    - Endpoints que tiran 401/403 antes de identificar al user (los loggea
      con user_id=NULL para que igual aparezcan en el ranking total).
    - Endpoints excluidos: /health, /docs, /openapi.json, /favicon.ico
      (no aportan información útil y agregan ruido).

Lo que un dev sucesor debe saber:
    - Si el endpoint /admin/feature-usage devuelve 0 rows, el middleware
      probablemente no está conectado en main.py. Verificar import.
    - Si crece a >1M rows/mes, considerar samplear (1 de cada 10 rows).
    - Para retention: drop particiones >12 meses una vez por mes
      (script en /backend/scripts/drop_old_feature_usage_partitions.py).
"""
from __future__ import annotations

import asyncio
import time
from contextlib import suppress
from dataclasses import dataclass
from typing import TYPE_CHECKING

import structlog
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.database import SessionLocal

if TYPE_CHECKING:
    from starlette.types import ASGIApp

log = structlog.get_logger(__name__)

# Configuración del buffer.
_BUFFER_MAX_SIZE = 100  # rows acumuladas antes de forzar flush
_FLUSH_INTERVAL_SECONDS = 10  # flush mínimo cada N segundos
_BUFFER_HARD_LIMIT = 500  # si llegamos acá, se droppea el siguiente row

# Paths a ignorar (no aportan info y agregan ruido).
_IGNORE_PATHS_EXACT = {
    "/",
    "/health",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/favicon.ico",
}
# R152RRRRR — Excluir paths SSE/streaming. BaseHTTPMiddleware espera el
# response completo antes de procesarlo, lo que rompe streaming endpoints
# (chat IA via SSE, server-sent events para notifs). Sin esto, los chats
# largos se cuelgan indefinidamente esperando el "fin" del response.
_IGNORE_PATHS_PREFIX = (
    "/static/",
    "/_next/",
    "/api/v1/stream/",          # SSE genérico
    "/api/v1/ai/chat/stream",   # chat IA streaming
)


@dataclass(slots=True)
class _UsageRow:
    """Fila de telemetría — estructura mínima."""

    path: str
    method: str
    user_id: str | None
    user_role: str | None
    empresa_codigo: str | None
    status_code: int
    duration_ms: int


# Buffer global compartido entre todos los workers del proceso uvicorn.
# Con --workers 1 (config actual), esto es un único buffer por máquina Fly.
_buffer: list[_UsageRow] = []
_buffer_lock = asyncio.Lock()
_flush_task: asyncio.Task[None] | None = None
_dropped_count = 0


def _should_track(path: str) -> bool:
    """Decide si vale la pena trackear este path."""
    if path in _IGNORE_PATHS_EXACT:
        return False
    if any(path.startswith(prefix) for prefix in _IGNORE_PATHS_PREFIX):
        return False
    return True


def _normalize_path(path: str) -> str:
    """Reemplaza IDs en paths para que /vouchers/123 y /vouchers/456
    cuenten como el mismo endpoint.

    Heurística simple: segmentos que son enteros o UUIDs → :id.
    Mantiene los segmentos de texto. Buena enough para telemetría.
    """
    parts = path.split("/")
    normalized = []
    for part in parts:
        # Entero puro
        if part.isdigit():
            normalized.append(":id")
            continue
        # UUID (heurística: 36 chars con guiones en posiciones 8,13,18,23)
        if len(part) == 36 and part.count("-") == 4:
            normalized.append(":uuid")
            continue
        normalized.append(part)
    return "/".join(normalized)


async def _flush_buffer() -> None:
    """Vacía el buffer a DB. Llamado por el background task o al alcanzar size."""
    global _buffer
    async with _buffer_lock:
        if not _buffer:
            return
        rows_to_insert = _buffer
        _buffer = []

    # Lock liberado — el INSERT puede tardar sin bloquear nuevos requests.
    try:
        async with SessionLocal() as db:
            await db.execute(
                text(
                    """
                    INSERT INTO core.feature_usage
                        (path, method, user_id, user_role, empresa_codigo,
                         status_code, duration_ms)
                    SELECT * FROM UNNEST(
                        CAST(:paths AS TEXT[]),
                        CAST(:methods AS TEXT[]),
                        CAST(:user_ids AS UUID[]),
                        CAST(:user_roles AS TEXT[]),
                        CAST(:empresas AS TEXT[]),
                        CAST(:status_codes AS SMALLINT[]),
                        CAST(:durations AS INT[])
                    )
                    """
                ),
                {
                    "paths": [r.path for r in rows_to_insert],
                    "methods": [r.method for r in rows_to_insert],
                    "user_ids": [r.user_id for r in rows_to_insert],
                    "user_roles": [r.user_role for r in rows_to_insert],
                    "empresas": [r.empresa_codigo for r in rows_to_insert],
                    "status_codes": [r.status_code for r in rows_to_insert],
                    "durations": [r.duration_ms for r in rows_to_insert],
                },
            )
            await db.commit()
    except Exception as exc:  # noqa: BLE001
        # Telemetría NUNCA debe romper la app. Loggear y seguir.
        log.warning(
            "usage_tracking.flush_failed",
            error=str(exc),
            rows_lost=len(rows_to_insert),
        )


async def _periodic_flush_loop() -> None:
    """Background task: flush cada N segundos mientras el proceso esté vivo."""
    while True:
        await asyncio.sleep(_FLUSH_INTERVAL_SECONDS)
        with suppress(Exception):
            await _flush_buffer()


def _ensure_flush_task_running() -> None:
    """Arranca el background flusher si no está corriendo.

    Lazy init: se levanta en el primer request (cuando ya hay event loop)
    en lugar de en import-time. Esto evita problemas si el módulo se
    importa en un contexto sin loop (tests, scripts).
    """
    global _flush_task
    if _flush_task is None or _flush_task.done():
        try:
            loop = asyncio.get_running_loop()
            _flush_task = loop.create_task(_periodic_flush_loop())
        except RuntimeError:
            # No hay loop corriendo — no podemos arrancar el task.
            # Quedará para el próximo request.
            pass


def _peek_jwt_claims(request: Request) -> tuple[str | None, str | None]:
    """R152RRRRR — Decodifica el JWT sin verificar para extraer (user_id, role).

    NO valida la firma — eso lo hace la dependency `CurrentUser` después.
    Para telemetría no necesitamos garantía criptográfica: solo necesitamos
    correlación. Si alguien manda un JWT inválido, el request va a fallar
    con 401 y igual lo loggeamos con el sub que figure (o NULL si malformado).

    Mismo patrón usado por audit_middleware._peek_user_email.
    """
    auth = request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        return (None, None)
    try:
        import jose.jwt as _jwt

        token = auth.split(" ", 1)[1].strip()
        claims = _jwt.get_unverified_claims(token)
        # Supabase setea `sub` = UUID del usuario.
        sub = claims.get("sub")
        # app_role viene en claims top-level si está setteado, o en
        # app_metadata.app_role. Probamos ambos.
        role = claims.get("app_role")
        if role is None:
            app_metadata = claims.get("app_metadata") or {}
            role = app_metadata.get("app_role")
        return (str(sub) if sub else None, role)
    except Exception:
        return (None, None)


class UsageTrackingMiddleware(BaseHTTPMiddleware):
    """Middleware que registra cada request en el buffer."""

    def __init__(self, app: "ASGIApp") -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        # Decisión rápida: ¿tracker este path?
        raw_path = request.url.path
        if not _should_track(raw_path):
            return await call_next(request)

        _ensure_flush_task_running()

        # R152RRRRR — Extraer user info ANTES del call_next porque
        # request.state.user no está disponible en middlewares (las
        # dependencies de FastAPI corren entre middleware y endpoint).
        # Peek-decode del JWT sin validar es el patrón estándar en
        # esta codebase (ver audit_middleware._peek_user_email).
        user_id, user_role = _peek_jwt_claims(request)
        empresa_codigo: str | None = None

        t0 = time.monotonic()
        response: Response = await call_next(request)
        duration_ms = int((time.monotonic() - t0) * 1000)

        # Agregar al buffer (defensive: si lleno, droppear).
        global _dropped_count
        row = _UsageRow(
            path=_normalize_path(raw_path),
            method=request.method,
            user_id=user_id,
            user_role=user_role,
            empresa_codigo=empresa_codigo,
            status_code=response.status_code,
            duration_ms=duration_ms,
        )

        # R152RRRRR — Inicializar fuera del lock para evitar NameError
        # cuando entramos al branch "buffer lleno" (donde should_flush_now
        # nunca se setea). Bug detectado en code review pre-deploy.
        should_flush_now = False

        async with _buffer_lock:
            if len(_buffer) >= _BUFFER_HARD_LIMIT:
                _dropped_count += 1
                if _dropped_count % 100 == 1:
                    log.warning(
                        "usage_tracking.buffer_full",
                        dropped_total=_dropped_count,
                    )
            else:
                _buffer.append(row)
                should_flush_now = len(_buffer) >= _BUFFER_MAX_SIZE

        # Flush sincrónico si pasamos el size threshold. Lo hacemos fuera
        # del lock para no bloquear otros requests durante el INSERT.
        if should_flush_now:
            await _flush_buffer()

        return response


def get_buffer_stats() -> dict[str, int]:
    """Para /admin/feature-usage — saber si el buffer está saludable."""
    return {
        "buffer_size": len(_buffer),
        "buffer_max": _BUFFER_MAX_SIZE,
        "buffer_hard_limit": _BUFFER_HARD_LIMIT,
        "dropped_total": _dropped_count,
    }


async def flush_on_shutdown() -> None:
    """R152RRRRR — Vacía el buffer al shutdown del proceso.

    Llamar desde `lifespan()` en main.py después del `yield` para que
    los rows pendientes lleguen a DB antes de que uvicorn cierre. Sin
    esto, cada deploy de Fly puede perder hasta 100 rows de telemetría.
    """
    global _flush_task
    # Cancelar el background loop (deja de aceptar nuevos sleeps).
    if _flush_task is not None and not _flush_task.done():
        _flush_task.cancel()
        with suppress(Exception):
            await _flush_task

    # Flush final — best effort, soft-fail.
    with suppress(Exception):
        await _flush_buffer()
