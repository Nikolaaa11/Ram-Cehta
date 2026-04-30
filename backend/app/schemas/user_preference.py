"""Schemas Pydantic para user_preferences (V4 fase 4 — onboarding tour).

`UserPreferenceUpdate` acepta cualquier valor JSON-serializable como `value`
(dict / list / bool / str / int / float). El consumer (frontend) garantiza
consistencia de schema por key.
"""
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field

# Tipos JSON-serializable que aceptamos en `value`. Pydantic no tiene un alias
# perfecto para "any JSON value" — usamos `Any` y validamos en runtime al hacer
# `json.dumps`. La firma del field es para autodocumentación y constraint
# documental, no para validación profunda.
JsonValue = dict[str, Any] | list[Any] | str | int | float | bool | None


class UserPreferenceUpdate(BaseModel):
    """Body de `PUT /me/preferences/{key}`.

    `value` acepta cualquier valor JSON-serializable. Ejemplos válidos:
      - `{"completed": true, "current_step": 3}` (onboarding_tour)
      - `"dark"` (theme)
      - `42` (some_counter)
      - `true` (feature_flag_local)
    """

    value: JsonValue = Field(
        ...,
        description=(
            "Valor JSON-serializable a persistir en la preferencia. "
            "Acepta dict, list, str, int, float, bool."
        ),
    )


class UserPreferenceRead(BaseModel):
    """Respuesta de `GET /me/preferences/{key}`."""

    key: str
    value: JsonValue
