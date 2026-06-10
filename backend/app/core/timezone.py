"""R152FFFFFF · Helper de timezone Chile.

Problema (auditoría de alertas):
    Todos los generadores usaban `date.today()` naive y las queries usaban
    `CURRENT_DATE`. En Fly.io (región gru) el servidor corre en UTC, pero
    Chile es UTC-3 (verano) / UTC-4 (invierno). Entre ~20:00–24:00 hora
    Chile el server YA está en el día siguiente UTC → un F29/contrato que
    vence "hoy" en Chile se mostraba como "vence mañana" o "vence en 0 días".

Solución:
    `today_chile()` y `now_chile()` usan ZoneInfo("America/Santiago"), que
    maneja automáticamente el cambio horario (DST). Reemplazar `date.today()`
    por `today_chile()` en generadores de alertas, digests y cálculos de
    "vence en X días".

En SQL, usar: `(now() AT TIME ZONE 'America/Santiago')::date` en lugar de
`CURRENT_DATE`.
"""
from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

CHILE_TZ = ZoneInfo("America/Santiago")


def now_chile() -> datetime:
    """Datetime actual en hora de Chile (timezone-aware)."""
    return datetime.now(CHILE_TZ)


def today_chile() -> date:
    """Fecha de HOY según la hora de Chile, no UTC.

    Usar esto en lugar de `date.today()` para todos los cálculos de
    'vence en X días', alertas, y cualquier comparación de fechas
    user-facing.
    """
    return now_chile().date()
