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
"""
from __future__ import annotations

import time
from typing import Annotated

from fastapi import Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, DBSession
from app.core.security import AuthenticatedUser


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
    """
    allowed = await get_allowed_empresa_codes(user, db)
    if allowed is None:  # admin
        return
    if empresa_codigo not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Sin acceso a empresa '{empresa_codigo}'. "
                f"Tus empresas permitidas: {sorted(allowed) if allowed else 'ninguna'}"
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
