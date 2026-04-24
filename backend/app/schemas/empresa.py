from __future__ import annotations

from pydantic import BaseModel


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
