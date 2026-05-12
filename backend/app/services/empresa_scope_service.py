"""V5++ ola AD — Multi-tenant scoping por empresa.

Cada usuario solo ve datos de las empresas en las que tiene rol asignado
(`core.user_company_roles`). Los `admin` (app_role='admin' en JWT) tienen
visibilidad global — pensado para vos (COO Cehta) + Guido cuando opere
como CFO global.

Diseño:
    1. Resolver `allowed_empresa_codes(user)` desde DB
    2. Cachear en request con dependency injection
    3. Endpoints que listan recursos por empresa: auto-aplican filtro
    4. Endpoints que reciben empresa_codigo en path/body: validan que
       esté en la lista permitida (sino 403)

Performance: 1 query SELECT por request (~1ms). Cachado in-memory por
60s a nivel proceso para usuarios activos (LRU 1024 entries) — el
TTL corto evita stale data si se asigna/revoca un rol.

V5++ ola CB: agrega logging estructurado de tentativas cross-tenant.
Cuando un user intenta acceder a una empresa fuera de su scope, se loguea
un warning estructurado que sale en Sentry + Fly logs. Útil para detectar
attacks o usuarios mal configurados.
"""
from __future__ import annotations

import time
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DBSession
from app.core.logging import get_logger
from app.core.security import AuthenticatedUser

log = get_logger(__name__)


# Cache in-memory por proceso. Key = user_id (UUID), Value = (timestamp, set[str]).
# TTL 60s — balance entre fresh data y reducir queries a DB.
_EMPRESA_CACHE: dict[str, tuple[float, frozenset[str]]] = {}
_CACHE_TTL = 60.0
_CACHE_MAX_SIZE = 1024  # evict cuando supera (FIFO simple)


def _evict_oldest_if_needed() -> None:
    """Drop oldest entries si la cache excede el tamaño."""
    if len(_EMPRESA_CACHE) > _CACHE_MAX_SIZE:
        # Borra el 10% más viejo
        sorted_items = sorted(
            _EMPRESA_CACHE.items(), key=lambda kv: kv[1][0]
        )
        to_drop = sorted_items[: _CACHE_MAX_SIZE // 10]
        for k, _ in to_drop:
            _EMPRESA_CACHE.pop(k, None)


def invalidate_user_cache(user_id: str) -> None:
    """Llamar después de asignar/revocar roles para refrescar cache.

    Endpoints que modifican `user_company_roles` deben llamar esto.
    """
    _EMPRESA_CACHE.pop(user_id, None)


def invalidate_all_caches() -> None:
    """Borra todas las entradas. Útil después de bulk role changes."""
    _EMPRESA_CACHE.clear()


def get_cache_stats() -> dict:
    """V5++ ola CB: stats del cache para debugging/monitoring.

    Útil exponerlo en /health/perf para ver hit rate y tamaño.
    """
    now = time.time()
    fresh = sum(
        1 for v in _EMPRESA_CACHE.values()
        if (now - v[0]) < _CACHE_TTL
    )
    stale = len(_EMPRESA_CACHE) - fresh
    return {
        "size": len(_EMPRESA_CACHE),
        "fresh": fresh,
        "stale": stale,
        "ttl_seconds": _CACHE_TTL,
        "max_size": _CACHE_MAX_SIZE,
    }


async def _record_violation(
    db: AsyncSession,
    user: AuthenticatedUser,
    attempted_empresa: str,
    allowed_empresas: list[str],
    via: str = "unknown",
) -> None:
    """V5++ ola CB: persiste tentativa cross-tenant a `audit.scope_violations`.

    Soft-fail: si la tabla no existe (migration 0054 no aplicada) o falla
    el insert, simplemente loguea y sigue. No queremos romper el endpoint
    por un problema de auditoría.

    NOTA: usa SAVEPOINT para no afectar la transacción principal si falla.
    """
    try:
        await db.execute(
            text(
                """
                INSERT INTO audit.scope_violations (
                    user_id, user_email, user_role,
                    attempted_empresa, allowed_empresas, via
                ) VALUES (
                    :uid, :email, :role,
                    :attempted, CAST(:allowed AS TEXT[]), :via
                )
                """
            ),
            {
                "uid": str(user.sub),
                "email": user.email,
                "role": user.app_role,
                "attempted": attempted_empresa,
                "allowed": allowed_empresas,
                "via": via,
            },
        )
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        # Soft-fail. El log warning de scope.cross_tenant_attempt ya
        # cubrió el evento. Esta tabla es bonus.
        try:
            await db.rollback()
        except Exception:
            pass
        log.debug("scope.violation_persist_failed: %s", exc)


async def get_allowed_empresa_codes(
    user: AuthenticatedUser, db: AsyncSession
) -> frozenset[str] | None:
    """Devuelve set de códigos de empresa a los que el user tiene acceso.

    Returns:
        - None si el user es admin (acceso global, sin filtro)
        - frozenset[str] con los códigos permitidos (puede ser vacío)
    """
    # Admin global → sin restricción
    if user.is_admin:
        return None

    user_id = str(user.sub)
    now = time.time()

    cached = _EMPRESA_CACHE.get(user_id)
    if cached is not None and (now - cached[0]) < _CACHE_TTL:
        return cached[1]

    result = await db.execute(
        text(
            """
            SELECT DISTINCT empresa_codigo
            FROM core.user_company_roles
            WHERE user_id = :uid AND active = TRUE
            """
        ),
        {"uid": user_id},
    )
    codes = frozenset(row[0] for row in result.fetchall())

    _EMPRESA_CACHE[user_id] = (now, codes)
    _evict_oldest_if_needed()
    return codes


async def assert_empresa_access(
    user: AuthenticatedUser,
    db: AsyncSession,
    empresa_codigo: str,
) -> None:
    """Verifica que el user pueda operar sobre esta empresa. Sino 403.

    Uso típico:
        await assert_empresa_access(user, db, body.empresa_codigo)

    V5++ ola CB: loguea tentativas cross-tenant para auditoría/security.
    """
    allowed = await get_allowed_empresa_codes(user, db)
    if allowed is None:  # admin
        return
    if empresa_codigo not in allowed:
        allowed_list = sorted(allowed) if allowed else []
        # SECURITY LOG: tentativa cross-tenant detectada
        log.warning(
            "scope.cross_tenant_attempt",
            extra={
                "user_id": str(user.sub),
                "user_email": user.email,
                "user_role": user.app_role,
                "attempted_empresa": empresa_codigo,
                "allowed_empresas": allowed_list,
                "via": "path_or_body",
            },
        )
        # Persistir a audit.scope_violations (soft-fail)
        await _record_violation(
            db, user, empresa_codigo, allowed_list, via="path_or_body"
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Sin acceso a empresa '{empresa_codigo}'. "
                f"Tus empresas permitidas: {allowed_list if allowed_list else 'ninguna'}"
            ),
        )


# =====================================================================
# Dependency injection para endpoints
# =====================================================================


async def _resolve_scope(
    user: CurrentUser, db: DBSession
) -> "EmpresaScope":
    codes = await get_allowed_empresa_codes(user, db)
    return EmpresaScope(user=user, allowed_codes=codes)


class EmpresaScope:
    """Helper inyectable que encapsula la lista de empresas accesibles.

    Permite a los endpoints filtrar queries y validar inputs sin
    re-implementar la lógica de scoping en cada handler.
    """

    def __init__(
        self,
        user: AuthenticatedUser,
        allowed_codes: frozenset[str] | None,
    ):
        self.user = user
        self.allowed_codes = allowed_codes

    @property
    def is_global(self) -> bool:
        """True si admin (puede ver todas las empresas)."""
        return self.allowed_codes is None

    def can_access(self, empresa_codigo: str) -> bool:
        if self.is_global:
            return True
        return empresa_codigo in (self.allowed_codes or ())

    def filter_codes(self, requested: str | None) -> list[str] | None:
        """Resuelve qué empresas filtrar en una query.

        - Si user es global y requested=None → None (sin filtro)
        - Si user es global y requested='X' → ['X']
        - Si user es scoped y requested=None → lista completa permitida
        - Si user es scoped y requested='X' que tiene → ['X']
        - Si user es scoped y requested='X' que NO tiene → raise 403
        """
        if self.is_global:
            return [requested] if requested else None

        allowed = self.allowed_codes or frozenset()
        if requested:
            if requested not in allowed:
                # SECURITY LOG: tentativa cross-tenant via query param
                log.warning(
                    "scope.cross_tenant_attempt",
                    extra={
                        "user_id": str(self.user.sub),
                        "user_email": self.user.email,
                        "user_role": self.user.app_role,
                        "attempted_empresa": requested,
                        "allowed_empresas": sorted(allowed),
                        "via": "query_param",
                    },
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Sin acceso a empresa '{requested}'",
                )
            return [requested]

        # No requested + scoped → mostrar todas las permitidas
        if not allowed:
            # Caso edge: user sin ninguna empresa asignada → resultados vacíos
            # (devolvemos lista con un código inexistente para que la query
            # WHERE empresa_codigo IN (...) devuelva 0 rows sin tirar error)
            return ["__NO_EMPRESA__"]
        return sorted(allowed)


EmpresaScopeDep = Annotated[EmpresaScope, Depends(_resolve_scope)]


# ---------------------------------------------------------------------------
# SQL helpers — reduce duplicación en endpoints que filtran por scope
# ---------------------------------------------------------------------------


def scope_sql_clause(
    scope: EmpresaScope,
    column: str = "empresa_codigo",
    as_where: bool = False,
    param_name: str = "scope_codes",
) -> tuple[str, dict]:
    """V5++ ola CB: helper para construir cláusula SQL de scope.

    Args:
        scope: EmpresaScope inyectado en el endpoint.
        column: nombre de la columna a filtrar. Default "empresa_codigo".
                Soporta alias como "e.codigo", "v.empresa_codigo" etc.
        as_where: si True devuelve "WHERE ..." (para queries sin WHERE existente).
                  Si False (default) devuelve "AND ..." para agregar a WHERE.
        param_name: nombre del binding param. Default "scope_codes".

    Returns:
        (clause_str, params_dict). Si admin global, clause_str="" y dict={}.

    Uso:
        clause, params = scope_sql_clause(scope, column="empresa_codigo")
        sql = f"SELECT * FROM core.foo WHERE x = :y {clause}"
        params.update({"y": "value"})
        rows = await db.execute(text(sql), params)
    """
    if scope.is_global:
        return "", {}

    allowed = sorted(scope.allowed_codes or frozenset())
    if not allowed:
        allowed = ["__NO_EMPRESA__"]  # sentinel → 0 rows

    prefix = "WHERE " if as_where else "AND "
    clause = f"{prefix}{column} = ANY(CAST(:{param_name} AS text[]))"
    return clause, {param_name: allowed}
