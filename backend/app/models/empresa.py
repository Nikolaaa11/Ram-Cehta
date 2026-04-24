from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Empresa(Base):
    __tablename__ = "empresas"
    __table_args__ = {"schema": "core"}

    empresa_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    codigo: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    razon_social: Mapped[str] = mapped_column(Text, nullable=False)
    rut: Mapped[str | None] = mapped_column(Text, unique=True)
    giro: Mapped[str | None] = mapped_column(Text)
    direccion: Mapped[str | None] = mapped_column(Text)
    ciudad: Mapped[str | None] = mapped_column(Text)
    telefono: Mapped[str | None] = mapped_column(Text)
    representante_legal: Mapped[str | None] = mapped_column(Text)
    email_firmante: Mapped[str | None] = mapped_column(Text)
    oc_prefix: Mapped[str | None] = mapped_column(Text)
    activo: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
