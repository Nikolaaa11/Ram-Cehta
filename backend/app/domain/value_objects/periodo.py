from __future__ import annotations

import re
from dataclasses import dataclass

_PERIODO_RE = re.compile(r"^(?P<mes>0[1-9]|1[0-2])_(?P<anio>\d{2})$")


@dataclass(frozen=True)
class Periodo:
    """Período tributario chileno en formato 'MM_YY' (ej. '02_26' = feb 2026)."""

    mes: int
    anio: int  # últimos dos dígitos

    def __post_init__(self) -> None:
        if not 1 <= self.mes <= 12:
            raise ValueError(f"Mes fuera de rango: {self.mes}")
        if not 0 <= self.anio <= 99:
            raise ValueError(f"Año fuera de rango (usar 2 dígitos): {self.anio}")

    @classmethod
    def parse(cls, raw: str) -> Periodo:
        match = _PERIODO_RE.match(raw)
        if not match:
            raise ValueError(f"Período inválido, esperado 'MM_YY', recibí {raw!r}")
        return cls(int(match.group("mes")), int(match.group("anio")))

    def __str__(self) -> str:
        return f"{self.mes:02d}_{self.anio:02d}"

    @property
    def anio_completo(self) -> int:
        # Convención: 00-69 -> 2000s, 70-99 -> 1900s. Caduca en 2069, aceptable.
        return 2000 + self.anio if self.anio < 70 else 1900 + self.anio
