"""Servicio de Trabajadores (V3 fase 2).

Coordina el repository (`TrabajadorRepository`) con el servicio Dropbox para:
- Crear la carpeta canónica del trabajador en Dropbox al alta.
- Subir documentos del trabajador a Dropbox y registrarlos en la DB.
- Mover la carpeta de Activos/ a Inactivos/ al marcar como inactivo.

Decisión de diseño — **graceful degradation**:
Si Dropbox NO está conectado (DropboxNotConfigured o el repo no encuentra
integration), la operación de DB se completa igual y se loggea un warning.
Esto permite operar el módulo de Trabajadores sin Dropbox (modo offline).
"""
from __future__ import annotations

from datetime import date

import structlog

from app.infrastructure.repositories.trabajador_repository import (
    TrabajadorRepository,
    compute_dropbox_folder,
    compute_inactivo_folder,
)
from app.models.trabajador import Trabajador, TrabajadorDocumento
from app.schemas.trabajador import TrabajadorCreate
from app.services.dropbox_service import DropboxNotConfigured, DropboxService

log = structlog.get_logger(__name__)


class TrabajadorService:
    def __init__(
        self,
        repo: TrabajadorRepository,
        dropbox: DropboxService | None = None,
    ) -> None:
        self.repo = repo
        self.dropbox = dropbox

    async def create_with_dropbox(self, body: TrabajadorCreate) -> Trabajador:
        """Crea trabajador en DB y, si Dropbox está conectado, su carpeta."""
        trabajador = await self.repo.create(body)

        if self.dropbox is not None and trabajador.dropbox_folder:
            try:
                self.dropbox.ensure_folder_path(trabajador.dropbox_folder)
            except DropboxNotConfigured:
                log.warning(
                    "dropbox.not_configured", trabajador_id=trabajador.trabajador_id
                )
            except Exception as exc:  # noqa: BLE001 — no rompemos el alta
                log.warning(
                    "dropbox.create_folder_failed",
                    trabajador_id=trabajador.trabajador_id,
                    error=str(exc),
                )
        return trabajador

    async def upload_documento(
        self,
        trabajador: Trabajador,
        *,
        tipo: str,
        nombre_archivo: str,
        content: bytes,
        uploaded_by: str | None,
    ) -> TrabajadorDocumento:
        """Sube archivo a Dropbox y registra en DB. Falla si Dropbox no está."""
        if self.dropbox is None:
            raise DropboxNotConfigured(
                "Para subir documentos, primero conectá Dropbox en /admin/integraciones"
            )
        if not trabajador.dropbox_folder:
            # Recompute en caso de migraciones legacy
            trabajador.dropbox_folder = compute_dropbox_folder(
                trabajador.empresa_codigo,
                trabajador.rut,
                trabajador.nombre_completo,
                activo=trabajador.estado == "activo",
            )

        # Asegurar que la carpeta existe (idempotente)
        self.dropbox.ensure_folder_path(trabajador.dropbox_folder)

        # Subir archivo
        dropbox_path = f"{trabajador.dropbox_folder}/{nombre_archivo}"
        upload_result = self.dropbox.upload_file(dropbox_path, content)

        # Registrar en DB
        return await self.repo.add_documento(
            trabajador_id=trabajador.trabajador_id,
            tipo=tipo,
            nombre_archivo=nombre_archivo,
            dropbox_path=upload_result["path"],
            tamano_bytes=upload_result["size"],
            uploaded_by=uploaded_by,
        )

    async def mark_inactive(
        self, trabajador: Trabajador, fecha_egreso: date
    ) -> Trabajador:
        """Marca como inactivo y mueve carpeta Dropbox a Inactivos/."""
        new_folder: str | None = None
        old_folder = trabajador.dropbox_folder

        if self.dropbox is not None and old_folder:
            new_folder = compute_inactivo_folder(
                trabajador.empresa_codigo,
                trabajador.rut,
                trabajador.nombre_completo,
                fecha_egreso,
            )
            try:
                # Asegurar que la carpeta padre 'Inactivos/' existe
                inactivos_root = (
                    f"/Cehta Capital/01-Empresas/{trabajador.empresa_codigo}"
                    f"/02-Trabajadores/Inactivos"
                )
                self.dropbox.ensure_folder_path(inactivos_root)
                # Move
                self.dropbox.move(old_folder, new_folder)
            except DropboxNotConfigured:
                new_folder = None
            except Exception as exc:  # noqa: BLE001
                log.warning(
                    "dropbox.move_failed",
                    trabajador_id=trabajador.trabajador_id,
                    error=str(exc),
                )
                new_folder = None

        return await self.repo.mark_inactive(trabajador, fecha_egreso, new_folder)

    async def get_documento_temporary_link(
        self, doc: TrabajadorDocumento
    ) -> str:
        """Genera link temporal Dropbox para descarga del documento."""
        if self.dropbox is None:
            raise DropboxNotConfigured(
                "Dropbox no conectado — no se puede generar link de descarga"
            )
        return self.dropbox.get_temporary_link(doc.dropbox_path)
