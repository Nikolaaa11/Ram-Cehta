"""Helpers para version history de Legal Vault (V4 fase 3).

Dos utilidades:

* ``compute_diff(before, after)`` — devuelve un dict con sólo las claves que
  difieren (mismo formato que ``audit_service._compute_diff`` pero en una
  sola estructura ``{key: {"before": ..., "after": ...}}``). Útil para el
  endpoint compare y para alimentar ``change_summary``.
* ``build_change_summary(before, after)`` — texto humano corto:
    - 0 cambios → ``"Sin cambios"``
    - 1 cambio → ``"Cambió X: A → B"`` (truncado si los valores son largos)
    - 2-3 → ``"Cambió X, Y, Z"``
    - 4+ → ``"Editó N campos"``
  Si ``before`` es ``None`` (creación inicial), retorna ``"Documento creado"``.

Estos helpers no dependen de DB ni de FastAPI — fácil unit testing.
"""
from __future__ import annotations

from typing import Any

# Claves de metadata interna que NO deben aparecer en el diff (timestamps
# que cambian solo por el UPDATE) — el operario nunca los edita
# explícitamente.
_IGNORE_KEYS: frozenset[str] = frozenset({"updated_at", "uploaded_at"})

# Truncar valores largos en el summary para no hacer un texto monstruoso.
_MAX_VAL_LEN = 40


def compute_diff(
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> dict[str, dict[str, Any]]:
    """Diff key-by-key. Sólo claves que cambiaron.

    Retorna ``{key: {"before": old, "after": new}}``. Claves sólo en uno
    de los dos lados aparecen igual con el otro lado en ``None``. Iguales
    se filtran. ``updated_at`` se ignora (cambia siempre por el trigger).
    """
    before = before or {}
    after = after or {}

    out: dict[str, dict[str, Any]] = {}
    keys = (set(before.keys()) | set(after.keys())) - _IGNORE_KEYS
    for k in keys:
        old = before.get(k)
        new = after.get(k)
        if old != new:
            out[k] = {"before": old, "after": new}
    return out


def _stringify(value: Any) -> str:
    """Representación corta para el summary."""
    if value is None:
        return "—"
    s = str(value)
    if len(s) > _MAX_VAL_LEN:
        s = s[: _MAX_VAL_LEN - 1] + "…"
    return s


def build_change_summary(
    before: dict[str, Any] | None,
    after: dict[str, Any] | None,
) -> str:
    """Genera el ``change_summary`` corto a partir del diff.

    - ``before is None`` (creación) → ``"Documento creado"``.
    - 0 campos cambiaron → ``"Sin cambios"``.
    - 1 → ``"Cambió X: A → B"``.
    - 2-3 → ``"Cambió X, Y, Z"``.
    - 4+ → ``"Editó N campos"``.
    """
    if before is None:
        return "Documento creado"

    diff = compute_diff(before, after)
    n = len(diff)
    if n == 0:
        return "Sin cambios"

    if n == 1:
        ((k, v),) = diff.items()
        old = _stringify(v.get("before"))
        new = _stringify(v.get("after"))
        return f"Cambió {k}: {old} → {new}"

    if n <= 3:
        return "Cambió " + ", ".join(sorted(diff.keys()))

    return f"Editó {n} campos"
