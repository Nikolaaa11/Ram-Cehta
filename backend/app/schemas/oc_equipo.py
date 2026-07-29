"""MEGAPROMPT OC · Schemas del catálogo de firmantes por empresa.

`core.empresa_equipo` existe para que el picker de firmantes de una OC sea
clickeable: antes los firmantes vivían en dos columnas JSONB de
`core.empresas` (oc_firmantes / firmantes_extra) sin ID estable, así que no
había forma de hacer toggle "agrego/saco a esta persona". Acá cada persona
tiene `miembro_id`, y esas columnas JSONB las sincroniza un trigger.

Estos schemas los consume el router `oc_equipo.py` y también `oc_firmas.py`
(MiembroRead viaja dentro de OcFirmasResponse para que la UI pinte los chips
del equipo en una sola llamada).
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class MiembroRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    miembro_id: int
    empresa_codigo: str
    nombre: str
    cargo: str | None = None
    email: str | None = None
    rut: str | None = None
    orden: int
    es_default: bool
    activo: bool
    # Sin cuenta en auth.users la persona NO puede firmar electrónicamente
    # (el flujo de firma resuelve al firmante por email). La UI lo avisa en
    # vez de dejar que el operador arme una OC que nadie va a poder firmar.
    tiene_cuenta: bool = False


class MiembroCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nombre: str = Field(min_length=2, max_length=200)
    cargo: str | None = Field(default=None, max_length=120)
    # Opcional a propósito: se puede cargar a alguien que todavía no tiene
    # cuenta (queda como firma manuscrita en el PDF).
    email: EmailStr | None = None
    rut: str | None = Field(default=None, max_length=20)
    es_default: bool = False


class MiembroUpdate(BaseModel):
    """PATCH parcial. Solo los campos enviados se tocan (exclude_unset).

    Mandar `email: null` o `cargo: null` explícitamente LIMPIA el campo —
    por eso el router usa exclude_unset y no exclude_none.
    """

    model_config = ConfigDict(extra="forbid")

    nombre: str | None = Field(default=None, min_length=2, max_length=200)
    cargo: str | None = Field(default=None, max_length=120)
    email: EmailStr | None = None
    rut: str | None = Field(default=None, max_length=20)
    es_default: bool | None = None
    activo: bool | None = None


class EquipoOrdenRequest(BaseModel):
    """Lista COMPLETA de miembro_ids en el orden deseado (posición+1)."""

    model_config = ConfigDict(extra="forbid")

    miembro_ids: list[int] = Field(min_length=1, max_length=50)
