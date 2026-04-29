from __future__ import annotations

from pydantic import BaseModel, Field


class EmpresaRead(BaseModel):
    empresa_id: int
    codigo: str
    razon_social: str
    rut: str | None
    giro: str | None
    direccion: str | None
    ciudad: str | None
    telefono: str | None
    representante_legal: str | None
    email_firmante: str | None
    oc_prefix: str | None
    activo: bool

    model_config = {"from_attributes": True}


class EmpresaUpdate(BaseModel):
    """PATCH /catalogos/empresas/{codigo} — datos fiscales/contacto editables.

    `codigo` NO es editable (es el identificador semántico que se usa por toda
    la app). Para cambiarlo se requeriría una migración manual.
    """

    razon_social: str | None = Field(default=None, min_length=1, max_length=255)
    rut: str | None = None
    giro: str | None = None
    direccion: str | None = None
    ciudad: str | None = None
    telefono: str | None = None
    representante_legal: str | None = None
    email_firmante: str | None = None
    oc_prefix: str | None = None
    activo: bool | None = None
