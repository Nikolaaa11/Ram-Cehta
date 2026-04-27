"""Sentry / observability bootstrap.

El SDK se inicializa solo si la variable de entorno ``SENTRY_DSN`` está presente.
Sin DSN, la función queda como no-op y no rompe el arranque (local/CI).
"""

from __future__ import annotations

import os
from typing import Any

import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration
from sentry_sdk.integrations.starlette import StarletteIntegration

from app.core.config import settings

# Claves cuyo valor NUNCA debe salir hacia Sentry. Comparación case-insensitive.
SENSITIVE_KEYS: frozenset[str] = frozenset(
    {
        "rut",
        "numero_cuenta",
        "account_number",
        "password",
        "passwd",
        "secret",
        "token",
        "access_token",
        "refresh_token",
        "authorization",
        "cookie",
        "set-cookie",
        "api_key",
        "apikey",
        "x-api-key",
    }
)

REDACTED = "[REDACTED]"


def _scrub(obj: Any) -> Any:
    """Reemplaza recursivamente valores asociados a llaves sensibles por ``[REDACTED]``."""
    if isinstance(obj, dict):
        return {
            k: (REDACTED if isinstance(k, str) and k.lower() in SENSITIVE_KEYS else _scrub(v))
            for k, v in obj.items()
        }
    if isinstance(obj, list):
        return [_scrub(x) for x in obj]
    if isinstance(obj, tuple):
        return tuple(_scrub(x) for x in obj)
    return obj


def _redact_pii(event: dict[str, Any], _hint: dict[str, Any]) -> dict[str, Any] | None:
    """``before_send`` hook: redacta PII de headers / extra / request data antes de enviar.

    Las cookies se consideran sensibles en bloque (cualquier nombre de cookie puede
    contener un session token).
    """
    request = event.get("request")
    if isinstance(request, dict):
        if isinstance(request.get("headers"), dict):
            request["headers"] = _scrub(request["headers"])
        if isinstance(request.get("cookies"), dict):
            # Cookies son sensibles en bloque: redactamos todos los valores.
            request["cookies"] = {k: REDACTED for k in request["cookies"]}
        if "data" in request:
            request["data"] = _scrub(request["data"])
        if isinstance(request.get("query_string"), dict):
            request["query_string"] = _scrub(request["query_string"])
    if "extra" in event:
        event["extra"] = _scrub(event["extra"])
    if "contexts" in event and isinstance(event["contexts"], dict):
        event["contexts"] = _scrub(event["contexts"])
    return event


def init_sentry() -> bool:
    """Inicializa Sentry. Devuelve ``True`` si quedó activo, ``False`` si no hay DSN.

    Sin DSN no se inicializa nada y no se levanta excepción: el deploy no debe romperse
    en local/CI por la ausencia de la variable.
    """
    dsn = os.getenv("SENTRY_DSN")
    if not dsn:
        return False

    sentry_sdk.init(
        dsn=dsn,
        environment=settings.app_env,
        release=os.getenv("FLY_RELEASE_VERSION") or os.getenv("GIT_SHA"),
        traces_sample_rate=0.1 if settings.is_production else 1.0,
        profiles_sample_rate=0.0,  # cost-conscious; habilitar más adelante si hace falta
        send_default_pii=False,  # nunca enviar PII por defecto
        attach_stacktrace=True,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            StarletteIntegration(transaction_style="endpoint"),
            SqlalchemyIntegration(),
        ],
        before_send=_redact_pii,
    )
    return True
