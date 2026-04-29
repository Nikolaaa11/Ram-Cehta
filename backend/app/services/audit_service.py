"""Audit log service (V3 fase 8 — audit log per-action).

API:
    await audit_log(
        db, request, user,
        action='update',
        entity_type='orden_compra',
        entity_id=str(oc.oc_id),
        entity_label=oc.numero_oc,
        summary=f'OC {oc.numero_oc} editada',
        before=before_dict,
        after=after_dict,
    )

Garantías:
    * **Nunca raisea**. Si la inserción falla (DB caída, schema viejo,
      bug de serialización), logueamos warning y devolvemos None — la
      mutación que ya commiteó NO debe fallar por culpa del audit.
    * Diff: sólo claves que cambiaron. Iguales se filtran. Claves sólo
      en before van a `diff_before`, claves sólo en after a `diff_after`.
    * Redaction: `password`, `password_hash`, `api_key`, `token`,
      `secret`, `dropbox_access_token`, `dropbox_refresh_token` se
      reemplazan por `'***'` antes de almacenar.
    * IP desde `request.client.host`, UA desde header `User-Agent`
      truncado a 512 chars.
"""
from __future__ import annotations

import contextlib
from typing import Any

from fastapi import Request
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.core.security import AuthenticatedUser

log = get_logger(__name__)

# Conjunto de claves redactadas en diffs. Match case-insensitive sobre
# la clave normalizada a lowercase.
_REDACT_KEYS: frozenset[str] = frozenset(
    {
        "password",
        "password_hash",
        "api_key",
        "token",
        "secret",
        "dropbox_access_token",
        "dropbox_refresh_token",
    }
)
_REDACTED = "***"

_USER_AGENT_MAX = 512


def _redact_value(key: str, value: Any) -> Any:
    """Aplica redacción recursiva a un valor según el nombre de clave.

    Si la clave matchea `_REDACT_KEYS` → '***'.
    Si el valor es dict → recursa por sub-claves.
    Si es lista → recursa por items (con la misma key).
    """
    if key.lower() in _REDACT_KEYS:
        return _REDACTED
    if isinstance(value, dict):
        return {k: _redact_value(k, v) for k, v in value.items()}
    if isinstance(value, list):
        return [_redact_value(key, v) for v in value]
    return value


def _redact(d: dict[str, Any]) -> dict[str, Any]:
    return {k: _redact_value(k, v) for k, v in d.items()}


def _compute_diff(
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Calcula el diff entre dos dicts.

    Retorna `(diff_before, diff_after)`. Sólo entran claves que difieren:
        * cambiadas: aparecen en ambos con valores distintos.
        * sólo en before: aparecen sólo en `diff_before`.
        * sólo en after: aparecen sólo en `diff_after`.

    Iguales se filtran. Soporta dicts anidados haciendo el diff recursivo
    sólo en el nivel raíz — para nested usamos comparación profunda con
    `==` y guardamos el sub-dict completo en cada lado.
    """
    before = before or {}
    after = after or {}

    diff_before: dict[str, Any] = {}
    diff_after: dict[str, Any] = {}

    all_keys = set(before.keys()) | set(after.keys())
    for k in all_keys:
        in_before = k in before
        in_after = k in after
        if in_before and in_after:
            if before[k] != after[k]:
                diff_before[k] = before[k]
                diff_after[k] = after[k]
        elif in_before:
            diff_before[k] = before[k]
        else:
            diff_after[k] = after[k]

    return _redact(diff_before), _redact(diff_after)


def _client_ip(request: Request | None) -> str | None:
    if request is None:
        return None
    client = getattr(request, "client", None)
    if client is None:
        return None
    return getattr(client, "host", None)


def _user_agent(request: Request | None) -> str | None:
    if request is None:
        return None
    try:
        ua = request.headers.get("user-agent", "") or ""
    except Exception:
        return None
    return ua[:_USER_AGENT_MAX] if ua else None


async def audit_log(
    db: AsyncSession,
    request: Request | None,
    user: AuthenticatedUser | None,
    *,
    action: str,
    entity_type: str,
    entity_id: str,
    entity_label: str | None = None,
    summary: str,
    before: dict[str, Any] | None = None,
    after: dict[str, Any] | None = None,
) -> None:
    """Inserta una fila en `audit.action_log`. Best-effort.

    Si la inserción falla, se loguea warning y se retorna None sin raisear.
    Un commit en falla del audit NO afecta la transacción del caller (el
    caller ya hizo commit antes de llamar acá según convención del fase 8).
    """
    try:
        diff_before, diff_after = _compute_diff(before, after)

        # JSONB None vs {} — preferimos None cuando no hay cambios para
        # mantener storage liviano y diferenciar "sin diff" de "diff vacío".
        db_before = diff_before if diff_before else None
        db_after = diff_after if diff_after else None

        user_id = user.sub if user is not None else None
        user_email = user.email if user is not None else None

        await db.execute(
            text(
                """
                INSERT INTO audit.action_log (
                    user_id, user_email, action, entity_type, entity_id,
                    entity_label, summary, diff_before, diff_after, ip, user_agent
                ) VALUES (
                    :user_id, :user_email, :action, :entity_type, :entity_id,
                    :entity_label, :summary,
                    CAST(:diff_before AS JSONB), CAST(:diff_after AS JSONB),
                    :ip, :user_agent
                )
                """
            ),
            {
                "user_id": user_id,
                "user_email": user_email,
                "action": action,
                "entity_type": entity_type,
                "entity_id": str(entity_id),
                "entity_label": entity_label,
                "summary": summary,
                "diff_before": _to_json(db_before),
                "diff_after": _to_json(db_after),
                "ip": _client_ip(request),
                "user_agent": _user_agent(request),
            },
        )
        await db.commit()
    except Exception as exc:
        # NUNCA raiseamos: la mutación ya pasó. Sólo logeamos para
        # diagnosis de incidentes de auditoría.
        log.warning(
            "audit_log_insert_failed",
            error=str(exc),
            action=action,
            entity_type=entity_type,
            entity_id=str(entity_id),
        )
        # Best effort: rollback para no dejar la sesión en estado tóxico
        with contextlib.suppress(Exception):
            await db.rollback()
        return None


def _to_json(value: dict[str, Any] | None) -> str | None:
    """Serializa un dict a JSON string (PG espera TEXT con CAST a JSONB).

    Usamos `default=str` para tolerar Decimal, datetime, date, UUID, etc.
    Si la serialización falla, retornamos None y el insert sigue (mejor
    perder el diff que perder la fila completa).
    """
    if value is None:
        return None
    try:
        import json

        return json.dumps(value, default=str, ensure_ascii=False)
    except Exception:
        return None
