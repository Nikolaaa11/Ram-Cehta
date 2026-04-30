"""Modelo `app.user_2fa` (V4 fase 2 — 2FA TOTP for admin role).

Cada usuario tiene a lo sumo una fila — `user_id` es PK. La fila se crea
en `POST /me/2fa/enroll` con `enabled=false`, y solo pasa a `enabled=true`
después de que el usuario verifica un código TOTP válido (proof-of-possession
del autenticador).

Diseño:
- `secret` se almacena en base32 (formato estándar TOTP). El secret SOLO se
  expone en la respuesta de `enroll` (qr + manual entry). Después de eso
  nunca vuelve a salir del backend.
- `backup_codes` guarda hashes sha256 de 10 códigos one-time. Cuando el
  usuario consume uno, se reemplaza con string vacío (`""`) y nunca se
  reutiliza. Los códigos en claro solo aparecen una vez en la respuesta
  de `enroll` o `regenerate-backup-codes`.
- `enabled_at` se llena al primer verify exitoso — útil para auditoría.
- Sin FK a `auth.users` (Supabase live en otro schema/RLS). La cleanup de
  filas huérfanas pasa por el delete cascade que el admin hace al borrar
  un user role en `core.user_roles`.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import ARRAY, Boolean, DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class TwoFactor(Base):
    __tablename__ = "user_2fa"
    __table_args__ = ({"schema": "app"},)

    user_id: Mapped[str] = mapped_column(
        UUID(as_uuid=False), primary_key=True
    )
    secret: Mapped[str] = mapped_column(String(64), nullable=False)
    enabled: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="false"
    )
    backup_codes: Mapped[list[str]] = mapped_column(
        ARRAY(String), nullable=False, server_default="{}"
    )
    enabled_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
