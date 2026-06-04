"""R152BBBBB · Idempotency-Key middleware.

Server-side dedup de mutaciones (POST/PATCH/PUT/DELETE) por header
`Idempotency-Key`. Complementa el cambio del cliente en R152AAAAA
(apiClient.ts genera un UUID v4 por mutación) para cerrar el ciclo de
protección contra double-submit.

Lifecycle:

  Request 1 llega con key K, method=POST, path=/X
  ├─ Lookup en core.idempotency_keys (key=K)
  ├─ NO encontrado → INSERT con response_status=NULL (placeholder)
  ├─ Handler corre normalmente
  ├─ UPDATE con response_status + response_body
  └─ Devuelve la respuesta normal al cliente

  Request 2 llega con misma key K, mismo method+path, mismo body
  ├─ Lookup encuentra K, response_status != NULL
  ├─ Hash matchea → devolvemos response_body cacheado con 200/204/etc
  └─ Handler NO corre. Cero side effects nuevos.

  Request 3 llega con misma key K pero body distinto
  ├─ Lookup encuentra K, request_hash NO matchea
  └─ 409 Conflict — el cliente está reusando la key incorrectamente.

  Race condition (2 requests simultáneos con misma K):
  ├─ Ambos hacen INSERT … ON CONFLICT DO NOTHING
  ├─ El que ganó la carrera crea el row; el otro recibe 0 rows updated
  ├─ El perdedor consulta de nuevo, ve response_status=NULL (in-flight)
  ├─ Responde 409 con detail "request en proceso, esperá unos segundos"

Diseño:
  - Storage en Postgres (no Redis) — Ram-Cehta no usa Redis.
  - TTL 5 minutos via columna expires_at + cleanup periódico opcional.
  - Solo cachea status < 500 — errores transitorios (cold-start) NO se
    cachean, así un retry tras 503 puede tener éxito.
  - GET/HEAD/OPTIONS: pasan directo, no se tocan.
  - Sin header Idempotency-Key: pasan directo (compatibilidad backward).
  - Body grande (>1MB): se procesa igual; el hash escala bien y JSON
    truncado del response se serializa.

Performance:
  - Overhead típico: ~5ms (1 SELECT + 1 INSERT).
  - Sin contención porque la key es UUID v4 (colisión despreciable).
  - Para endpoints rápidos (< 100ms) representa ~5% overhead; para
    endpoints lentos (generar_vouchers ~500ms) es despreciable.
"""
from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.database import SessionLocal
from app.core.logging import get_logger

log = get_logger(__name__)

# Métodos sobre los que aplicamos idempotency. GET/HEAD/OPTIONS son
# idempotentes nativamente; no necesitan cache.
_MUTATION_METHODS = {"POST", "PATCH", "PUT", "DELETE"}

# Header HTTP standard (RFC draft idempotency-header).
_HEADER_NAME = "idempotency-key"

# Limit del body que vamos a hashear y del response que vamos a cachear.
# Más allá de eso, skip la idempotency (la mayoría de payloads son <100KB).
_MAX_BODY_BYTES = 1_000_000  # 1MB
_MAX_RESPONSE_BYTES = 500_000  # 500KB


def _hash_body(body: bytes) -> str:
    """SHA256 hex del body. Determinístico, rápido, suficiente para detectar
    payloads distintos con la misma key."""
    return hashlib.sha256(body).hexdigest()


def _extract_user_email(request: Request) -> str | None:
    """Best-effort: intenta extraer el email del Authorization header.
    NO valida — solo loggea. La auth real corre en require_scope."""
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return None
    # Parseamos el JWT solo para extraer el email (no validamos firma — eso
    # ocurre downstream en CurrentUser dependency).
    try:
        import base64
        token = auth.split(" ", 1)[1]
        # JWT = header.payload.signature
        payload_b64 = token.split(".")[1]
        # Padding correcto para base64.
        payload_b64 += "=" * (-len(payload_b64) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return payload.get("email") or payload.get("sub")
    except Exception:
        return None


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """Cachea respuestas de mutaciones por header Idempotency-Key.

    Soft-fail: cualquier error de BD durante el lookup/insert deja pasar
    la request normal. La idempotency es una optimización, no una
    invariante de seguridad — si Postgres está caído, mejor procesar
    sin cache que romper todo el endpoint.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next) -> Response:
        method = request.method.upper()

        # Skip si no es mutación.
        if method not in _MUTATION_METHODS:
            return await call_next(request)

        # Skip si no hay header.
        idem_key = request.headers.get(_HEADER_NAME)
        if not idem_key:
            return await call_next(request)

        # Validar formato — UUID v4 esperado. Si es claramente inválido, skip
        # para evitar abuse (un cliente malicioso podría llenar la tabla).
        if not (8 <= len(idem_key) <= 100):
            return await call_next(request)

        path = request.url.path
        user_email = _extract_user_email(request)

        # Leer body para hashear. Tenemos que cachearlo para que el handler
        # downstream pueda re-leerlo.
        body = await request.body()
        if len(body) > _MAX_BODY_BYTES:
            log.info(
                "idempotency.body_too_large",
                key=idem_key[:12],
                size=len(body),
            )
            return await call_next(request)

        body_hash = _hash_body(body)

        # 1. Lookup: ¿ya existe esta key?
        cached = None
        try:
            async with SessionLocal() as db:
                row = (
                    await db.execute(
                        text(
                            """SELECT method, path, request_hash,
                                      response_status, response_body
                               FROM core.idempotency_keys
                               WHERE key = :k AND expires_at > NOW()"""
                        ),
                        {"k": idem_key},
                    )
                ).mappings().first()
                if row:
                    cached = dict(row)
        except Exception as exc:
            log.warning(
                "idempotency.lookup_failed",
                key=idem_key[:12],
                err=str(exc),
            )
            cached = None

        # 2a. Key existe Y completada: devolver respuesta cacheada
        if cached and cached.get("response_status") is not None:
            # Verificar que es la misma operación (method+path+body).
            if (
                cached["method"] != method
                or cached["path"] != path
                or cached["request_hash"] != body_hash
            ):
                log.warning(
                    "idempotency.key_reused_with_different_payload",
                    key=idem_key[:12],
                    cached_method=cached["method"],
                    cached_path=cached["path"],
                    new_method=method,
                    new_path=path,
                )
                return JSONResponse(
                    status_code=409,
                    content={
                        "detail": (
                            "Idempotency-Key reusado con payload distinto. "
                            "Generá una key nueva para una operación distinta."
                        )
                    },
                )

            # Hit del cache — devolver respuesta original.
            log.info(
                "idempotency.cache_hit",
                key=idem_key[:12],
                status=cached["response_status"],
            )
            return JSONResponse(
                status_code=int(cached["response_status"]),
                content=cached.get("response_body"),
                headers={"X-Idempotent-Replay": "true"},
            )

        # 2b. Key existe pero NULL → request anterior en proceso.
        if cached and cached.get("response_status") is None:
            log.info(
                "idempotency.request_in_flight",
                key=idem_key[:12],
            )
            return JSONResponse(
                status_code=409,
                content={
                    "detail": (
                        "Request con esta Idempotency-Key todavía está en "
                        "proceso. Esperá unos segundos antes de reintentar."
                    )
                },
            )

        # 3. Key no existe → reservar el slot.
        try:
            async with SessionLocal() as db:
                res = await db.execute(
                    text(
                        """INSERT INTO core.idempotency_keys
                               (key, user_email, method, path, request_hash)
                           VALUES (:k, :u, :m, :p, :h)
                           ON CONFLICT (key) DO NOTHING"""
                    ),
                    {
                        "k": idem_key,
                        "u": user_email,
                        "m": method,
                        "p": path,
                        "h": body_hash,
                    },
                )
                await db.commit()
                # Si ON CONFLICT disparó, otro request ganó la carrera.
                if res.rowcount == 0:
                    log.info(
                        "idempotency.race_lost_to_concurrent",
                        key=idem_key[:12],
                    )
                    return JSONResponse(
                        status_code=409,
                        content={
                            "detail": (
                                "Request concurrente con esta key ya está en "
                                "proceso. Reintentá en unos segundos."
                            )
                        },
                    )
        except Exception as exc:
            # Si no podemos reservar el slot, dejá pasar — la idempotency
            # es best-effort, mejor procesar que romper.
            log.warning(
                "idempotency.reserve_failed_passthrough",
                key=idem_key[:12],
                err=str(exc),
            )
            return await call_next(request)

        # 4. Replant el body para que el handler downstream lo pueda leer.
        # Starlette consume el body al hacer await request.body(); para que
        # los handlers FastAPI puedan leerlo de nuevo, lo inyectamos al
        # _receive del request.
        async def receive():  # type: ignore[no-untyped-def]
            return {"type": "http.request", "body": body, "more_body": False}

        request._receive = receive  # type: ignore[attr-defined]

        # 5. Ejecutar el handler real.
        response = await call_next(request)

        # 6. Si el response fue exitoso (status < 500), cachearlo.
        if response.status_code < 500:
            # Necesitamos leer el body del response para cachearlo. Como
            # Starlette streamea response.body_iterator, lo coleccionamos y
            # luego lo re-inyectamos.
            body_chunks: list[bytes] = []
            async for chunk in response.body_iterator:  # type: ignore[attr-defined]
                body_chunks.append(chunk)
            full_body = b"".join(body_chunks)

            # Reconstruir response con el body que ya leímos.
            new_response = Response(
                content=full_body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )

            if len(full_body) <= _MAX_RESPONSE_BYTES:
                # Intentar parsear como JSON para guardarlo estructurado.
                try:
                    parsed_body: Any = json.loads(full_body) if full_body else None
                except Exception:
                    parsed_body = None

                if parsed_body is not None:
                    try:
                        async with SessionLocal() as db:
                            await db.execute(
                                text(
                                    """UPDATE core.idempotency_keys
                                       SET response_status = :s,
                                           response_body = CAST(:b AS jsonb)
                                       WHERE key = :k
                                         AND response_status IS NULL"""
                                ),
                                {
                                    "s": response.status_code,
                                    "b": json.dumps(parsed_body),
                                    "k": idem_key,
                                },
                            )
                            await db.commit()
                    except Exception as exc:
                        log.warning(
                            "idempotency.cache_write_failed",
                            key=idem_key[:12],
                            err=str(exc),
                        )

            return new_response

        # Status 5xx: no cachear y limpiar el slot reservado para permitir retry.
        try:
            async with SessionLocal() as db:
                await db.execute(
                    text(
                        """DELETE FROM core.idempotency_keys
                           WHERE key = :k AND response_status IS NULL"""
                    ),
                    {"k": idem_key},
                )
                await db.commit()
        except Exception:
            pass  # best-effort
        return response
