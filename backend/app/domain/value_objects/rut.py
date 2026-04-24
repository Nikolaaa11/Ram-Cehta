from __future__ import annotations

import re
from dataclasses import dataclass

_RUT_CLEAN = re.compile(r"[^0-9kK]")


def normalize_rut(rut: str) -> str:
    """Strip dots, dashes, spaces and upper-case the K. '12.345.678-9' -> '123456789'."""
    return _RUT_CLEAN.sub("", rut).upper()


def _compute_verifier(body: str) -> str:
    total = 0
    multiplier = 2
    for digit in reversed(body):
        total += int(digit) * multiplier
        multiplier = multiplier + 1 if multiplier < 7 else 2
    remainder = 11 - (total % 11)
    if remainder == 11:
        return "0"
    if remainder == 10:
        return "K"
    return str(remainder)


def validate_rut(rut: str) -> bool:
    """Validate a Chilean RUT via the mod-11 algorithm."""
    if not rut:
        return False
    clean = normalize_rut(rut)
    if len(clean) < 2 or not clean[:-1].isdigit():
        return False
    body, verifier = clean[:-1], clean[-1]
    return _compute_verifier(body) == verifier


def format_rut(rut: str) -> str:
    """'123456789' -> '12.345.678-9'. Input must be a syntactically valid RUT (use validate_rut first)."""
    clean = normalize_rut(rut)
    body, verifier = clean[:-1], clean[-1]
    reversed_body = body[::-1]
    grouped = ".".join(reversed_body[i : i + 3] for i in range(0, len(reversed_body), 3))
    return f"{grouped[::-1]}-{verifier}"


@dataclass(frozen=True)
class Rut:
    """Value object for a validated Chilean RUT."""

    value: str  # canonical form with dots and dash: '12.345.678-9'

    def __post_init__(self) -> None:
        if not validate_rut(self.value):
            raise ValueError(f"RUT inválido: {self.value!r}")

    @classmethod
    def parse(cls, raw: str) -> Rut:
        if not validate_rut(raw):
            raise ValueError(f"RUT inválido: {raw!r}")
        return cls(format_rut(raw))

    @property
    def body(self) -> str:
        return normalize_rut(self.value)[:-1]

    @property
    def verifier(self) -> str:
        return normalize_rut(self.value)[-1]

    def __str__(self) -> str:
        return self.value
