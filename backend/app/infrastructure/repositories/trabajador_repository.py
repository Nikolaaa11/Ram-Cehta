"""Repository para `core.trabajadores` y `core.trabajador_documentos`.

Decisiones:
- Todos los métodos de listado/lookup están **empresa-scoped**: la unicidad es
  por `(empresa_codigo, rut)`.
- `compute_dropbox_folder` calcula la ruta canónica
  `/Cehta Capital/01-Empresas/{codigo}/02-Trabajadores/Activos/{rut} - {nombre}/`
  y se invoca tanto al crear como al rotar el estado (mark_inactive).
- Igual que el resto de repos, el `commit` es responsabilidad del endpoint;
  acá sólo hacemos `flush + refresh` para mantener consistencia.
"""
from __future__ import annotations

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.trabajador import Trabajador, TrabajadorDocumento
from app.schemas.trabajador import TrabajadorCreate, TrabajadorUpdate

DROPBOX_ROOT_EMPRESAS = "/Cehta Capital/01-Empresas"


def _sanitize_for_path(value: str) -> str:
    """Elimina caracteres prohibidos en paths Dropbox y aplana espacios."""
    cleaned = "".join(c for c in value if c not in {"/", "\\", "<", ">", ":", '"', "|", "?", "*"})
    return " ".join(cleaned.split()).strip()


def compute_dropbox_folder(
    empresa_codigo: str, rut: str, nombre: str, *, activo: bool = True
) -> str:
    """Path canónico para el trabajador en Dropbox.

    Activos:    /Cehta Capital/01-Empresas/{X}/02-Trabajadores/Activos/{rut} - {nombre}
    Inactivos:  /Cehta Capital/01-Empresas/{X}/02-Trabajadores/Inactivos/{rut} - {nombre}
    """
    bucket = "Activos" if activo else "Inactivos"
    leaf = _sanitize_for_path(f"{rut} - {nombre}")
    return (
        f"{DROPBOX_ROOT_EMPRESAS}/{empresa_codigo}/02-Trabajadores/{bucket}/{leaf}"
    )


def compute_inactivo_folder(
    empresa_codigo: str, rut: str, nombre: str, fecha_egreso: date
) -> str:
    """Path para Inactivos con sufijo de fecha de egreso (auditable).

    /Cehta Capital/01-Empresas/{X}/02-Trabajadores/Inactivos/{rut} - {nombre} (egreso YYYY-MM-DD)
    """
    leaf = _sanitize_for_path(
        f"{rut} - {nombre} (egreso {fecha_egreso.isoformat()})"
    )
    return (
        f"{DROPBOX_ROOT_EMPRESAS}/{empresa_codigo}/02-Trabajadores/Inactivos/{leaf}"
    )


class TrabajadorRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # -----------------------------------------------------------------
    # Listing / lookup
    # -----------------------------------------------------------------

    async def list(
        self,
        empresa_codigo: str,
        estado: str | None,
        page: int,
        size: int,
    ) -> tuple[list[Trabajador], int]:
        q = select(Trabajador).where(Trabajador.empresa_codigo == empresa_codigo)
        if estado:
            q = q.where(Trabajador.estado == estado)
        q = q.order_by(Trabajador.nombre_completo.asc())

        count_q = select(func.count()).select_from(q.subquery())
        total = await self._session.scalar(count_q) or 0
        items = list(
            (
                await self._session.scalars(
                    q.offset((page - 1) * size).limit(size)
                )
            ).all()
        )
        return items, total

    async def get(self, trabajador_id: int) -> Trabajador | None:
        return await self._session.get(Trabajador, trabajador_id)

    async def get_by_rut(self, empresa_codigo: str, rut: str) -> Trabajador | None:
        result = await self._session.scalars(
            select(Trabajador).where(
                Trabajador.empresa_codigo == empresa_codigo,
                Trabajador.rut == rut,
            )
        )
        return result.first()

    # -----------------------------------------------------------------
    # Mutations
    # -----------------------------------------------------------------

    async def create(self, data: TrabajadorCreate) -> Trabajador:
        payload = data.model_dump(exclude_none=True)
        trabajador = Trabajador(**payload)
        trabajador.dropbox_folder = compute_dropbox_folder(
            data.empresa_codigo, data.rut, data.nombre_completo, activo=True
        )
        self._session.add(trabajador)
        await self._session.flush()
        await self._session.refresh(trabajador)
        return trabajador

    async def update(
        self, trabajador: Trabajador, data: TrabajadorUpdate
    ) -> Trabajador:
        for k, v in data.model_dump(exclude_unset=True).items():
            setattr(trabajador, k, v)
        await self._session.flush()
        await self._session.refresh(trabajador)
        return trabajador

    async def mark_inactive(
        self, trabajador: Trabajador, fecha_egreso: date, new_dropbox_folder: str | None
    ) -> Trabajador:
        trabajador.estado = "inactivo"  # type: ignore[assignment]
        trabajador.fecha_egreso = fecha_egreso  # type: ignore[assignment]
        if new_dropbox_folder is not None:
            trabajador.dropbox_folder = new_dropbox_folder
        await self._session.flush()
        await self._session.refresh(trabajador)
        return trabajador

    # -----------------------------------------------------------------
    # Documentos
    # -----------------------------------------------------------------

    async def add_documento(
        self,
        trabajador_id: int,
        tipo: str,
        nombre_archivo: str,
        dropbox_path: str,
        tamano_bytes: int | None,
        uploaded_by: str | None,
    ) -> TrabajadorDocumento:
        doc = TrabajadorDocumento(
            trabajador_id=trabajador_id,
            tipo=tipo,
            nombre_archivo=nombre_archivo,
            dropbox_path=dropbox_path,
            tamano_bytes=tamano_bytes,
            uploaded_by=uploaded_by,
        )
        self._session.add(doc)
        await self._session.flush()
        await self._session.refresh(doc)
        return doc

    async def get_documento(
        self, trabajador_id: int, documento_id: int
    ) -> TrabajadorDocumento | None:
        result = await self._session.scalars(
            select(TrabajadorDocumento).where(
                TrabajadorDocumento.documento_id == documento_id,
                TrabajadorDocumento.trabajador_id == trabajador_id,
            )
        )
        return result.first()

    async def delete_documento(self, doc: TrabajadorDocumento) -> None:
        await self._session.delete(doc)
        await self._session.flush()
