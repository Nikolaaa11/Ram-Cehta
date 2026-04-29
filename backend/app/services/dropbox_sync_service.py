"""Servicio de sincronización Dropbox → DB (V3 fase 7).

Escanea carpetas Dropbox específicas por empresa y reconcilia con la DB:
- Trabajadores: Activos/{rut - nombre}/ → core.trabajadores + core.trabajador_documentos
- Legal: 03-Legal/{categoria}/.../*.pdf → core.legal_documents
- F29: 03-Legal/Declaraciones SII/F29/YYYY-MM.pdf → core.f29_obligaciones

Decisiones:
- **Idempotente**: el match por `dropbox_path` evita duplicados al re-ejecutar.
- **Soft-fail por archivo**: errores individuales se acumulan en `errors` pero
  no abortan el sync entero.
- **Single-tenant**: opera sobre la única integración Dropbox conectada (la
  corporativa de Cehta) — consistente con el resto de la app.

Endpoints expuestos (cada uno con su scope):
  POST /trabajadores/sync-dropbox/{empresa}  (trabajador:update)
  POST /legal/sync-dropbox/{empresa}         (legal:create)
  POST /f29/sync-dropbox/{empresa}           (f29:create)
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import structlog
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.repositories.legal_repository import (
    DROPBOX_ROOT_LEGAL,
)
from app.infrastructure.repositories.trabajador_repository import (
    DROPBOX_ROOT_EMPRESAS,
    compute_dropbox_folder,
)
from app.models.legal_document import LegalDocument
from app.models.trabajador import Trabajador, TrabajadorDocumento
from app.services.dropbox_service import DropboxService

log = structlog.get_logger(__name__)


# ---------------------------------------------------------------------------
# Resultados
# ---------------------------------------------------------------------------


@dataclass
class SyncResult:
    """Resultado del scan/sync. Campos opcionales según el recurso."""

    created_trabajadores: int = 0
    created_documentos: int = 0
    created_legal: int = 0
    created_f29: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "created_trabajadores": self.created_trabajadores,
            "created_documentos": self.created_documentos,
            "created_legal": self.created_legal,
            "created_f29": self.created_f29,
            "skipped": self.skipped,
            "errors": self.errors,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


_TRABAJADOR_FOLDER_RE = re.compile(r"^(\d{1,2}\.?\d{3}\.?\d{3}-[\dKk]) - (.+)$")
_RUT_LOOSE_RE = re.compile(r"^([\d\.]+-[\dKk])\s*-\s*(.+)$")
_DATE_PREFIX_RE = re.compile(r"(\d{4}-\d{2}-\d{2})")
_F29_PERIODO_RE = re.compile(r"(\d{4})[-_](\d{2})")


def _infer_tipo_documento(filename: str) -> str:
    """Infiere `tipo` para core.trabajador_documentos del nombre del archivo."""
    name = filename.lower()
    if name.startswith("contrato") or "contrato" in name:
        return "contrato"
    if name.startswith("anexo") or "anexo" in name:
        return "anexo"
    if "carnet" in name or "dni" in name or name.startswith("ci-") or name.startswith("ci_"):
        return "dni"
    if name.startswith("cv") or "curriculum" in name or " cv" in name:
        return "cv"
    if "liquidacion" in name or "liquidación" in name:
        return "liquidacion"
    if "finiquito" in name:
        return "finiquito"
    if "afp" in name:
        return "cert_afp"
    if "fonasa" in name or "isapre" in name or "salud" in name:
        return "cert_fonasa"
    return "otro"


def _infer_legal_categoria(path: str) -> tuple[str, str | None]:
    """Devuelve (categoria, subcategoria) inferidos del path Dropbox."""
    p = path.lower()
    # Subcategorías más específicas primero
    if "/contratos/cliente" in p:
        return "contrato", "cliente"
    if "/contratos/proveedor" in p:
        return "contrato", "proveedor"
    if "/contratos/bancario" in p or "/contratos/banco" in p:
        return "contrato", "bancario"
    if "/contratos" in p:
        return "contrato", None
    if "/actas" in p:
        return "acta", None
    if "/declaraciones sii/f29" in p or "/declaraciones-sii/f29" in p:
        return "declaracion_sii", "f29"
    if "/declaraciones sii/f22" in p or "/declaraciones-sii/f22" in p:
        return "declaracion_sii", "f22"
    if "/declaraciones sii" in p or "/declaraciones-sii" in p:
        return "declaracion_sii", None
    if "/permiso" in p:
        return "permiso", None
    if "/poliza" in p or "/pólizas" in p or "/polizas" in p:
        return "poliza", None
    if "/estatuto" in p:
        return "estatuto", None
    return "otro", None


def _extract_fecha_emision(filename: str) -> date | None:
    """Extrae fecha YYYY-MM-DD del nombre del archivo si la tiene como prefijo."""
    m = _DATE_PREFIX_RE.search(filename)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y-%m-%d").date()
    except ValueError:
        return None


def _extract_periodo_tributario(filename: str) -> str | None:
    """Convierte `2026-04.pdf` → `04_26` (formato MM_YY)."""
    m = _F29_PERIODO_RE.search(filename)
    if not m:
        return None
    yyyy, mm = m.group(1), m.group(2)
    return f"{mm}_{yyyy[2:]}"


def _is_doc_extension(name: str) -> bool:
    n = name.lower()
    return n.endswith((".pdf", ".docx", ".doc", ".xlsx", ".xls", ".png", ".jpg", ".jpeg"))


# ---------------------------------------------------------------------------
# Sync: trabajadores
# ---------------------------------------------------------------------------


class DropboxSyncService:
    """Coordina el scan Dropbox + writes en DB."""

    def __init__(self, session: AsyncSession, dropbox: DropboxService) -> None:
        self.db = session
        self.dropbox = dropbox

    async def sync_trabajadores(self, empresa_codigo: str) -> SyncResult:
        """Escanea `02-Trabajadores/Activos/` y crea trabajadores + docs faltantes."""
        result = SyncResult()
        root = (
            f"{DROPBOX_ROOT_EMPRESAS}/{empresa_codigo}"
            f"/02-Trabajadores/Activos"
        )
        try:
            items = self.dropbox.list_folder(root)
        except Exception as exc:  # noqa: BLE001
            result.errors.append(f"No se pudo listar {root}: {exc}")
            return result

        # Pre-cargar trabajadores existentes de esta empresa para reducir queries
        existing_q = await self.db.execute(
            select(Trabajador).where(Trabajador.empresa_codigo == empresa_codigo)
        )
        existing_by_rut: dict[str, Trabajador] = {
            t.rut: t for t in existing_q.scalars().all()
        }

        # Pre-cargar dropbox_paths existentes para evitar duplicar documentos
        doc_paths_rows = (
            await self.db.execute(
                text(
                    "SELECT td.dropbox_path "
                    "FROM core.trabajador_documentos td "
                    "JOIN core.trabajadores t USING (trabajador_id) "
                    "WHERE t.empresa_codigo = :empresa"
                ),
                {"empresa": empresa_codigo},
            )
        ).fetchall()
        existing_doc_paths: set[str] = {r[0] for r in doc_paths_rows if r[0]}

        for item in items:
            if item["type"] != "folder":
                continue
            name = item["name"]
            match = _TRABAJADOR_FOLDER_RE.match(name) or _RUT_LOOSE_RE.match(name)
            if not match:
                continue
            rut_raw, nombre = match.group(1), match.group(2).strip()
            # Normaliza rut como en TrabajadorRepository._sanitize: quitamos puntos
            rut = rut_raw.replace(".", "").upper().replace("K", "K")

            trabajador = existing_by_rut.get(rut)
            if trabajador is None:
                try:
                    trabajador = Trabajador(
                        empresa_codigo=empresa_codigo,
                        nombre_completo=nombre,
                        rut=rut,
                        fecha_ingreso=date.today(),
                        estado="activo",
                        dropbox_folder=compute_dropbox_folder(
                            empresa_codigo, rut, nombre, activo=True
                        ),
                    )
                    self.db.add(trabajador)
                    await self.db.flush()
                    await self.db.refresh(trabajador)
                    existing_by_rut[rut] = trabajador
                    result.created_trabajadores += 1
                except Exception as exc:  # noqa: BLE001
                    result.errors.append(
                        f"Crear trabajador {rut} ({nombre}): {exc}"
                    )
                    continue

            # Listar archivos dentro de la carpeta del trabajador
            folder_path = item["path"]
            try:
                inner = self.dropbox.list_folder(folder_path)
            except Exception as exc:  # noqa: BLE001
                result.errors.append(f"Listar {folder_path}: {exc}")
                continue

            for f in inner:
                if f["type"] != "file":
                    continue
                if not _is_doc_extension(f["name"]):
                    continue
                file_path = f["path"]
                if file_path in existing_doc_paths:
                    result.skipped += 1
                    continue
                try:
                    doc = TrabajadorDocumento(
                        trabajador_id=trabajador.trabajador_id,
                        tipo=_infer_tipo_documento(f["name"]),
                        nombre_archivo=f["name"],
                        dropbox_path=file_path,
                        tamano_bytes=f.get("size"),
                    )
                    self.db.add(doc)
                    existing_doc_paths.add(file_path)
                    result.created_documentos += 1
                except Exception as exc:  # noqa: BLE001
                    result.errors.append(
                        f"Crear documento {file_path}: {exc}"
                    )

        await self.db.flush()
        return result

    # -----------------------------------------------------------------
    # Sync: legal
    # -----------------------------------------------------------------

    async def sync_legal(self, empresa_codigo: str) -> SyncResult:
        """Escanea `03-Legal/` recursivamente y crea legal_documents faltantes."""
        result = SyncResult()
        root = f"{DROPBOX_ROOT_LEGAL}/{empresa_codigo}/03-Legal"

        # Pre-cargar dropbox_paths existentes para esta empresa
        existing_paths_rows = (
            await self.db.execute(
                text(
                    "SELECT dropbox_path FROM core.legal_documents "
                    "WHERE empresa_codigo = :empresa AND dropbox_path IS NOT NULL"
                ),
                {"empresa": empresa_codigo},
            )
        ).fetchall()
        existing_paths: set[str] = {r[0] for r in existing_paths_rows}

        try:
            await self._scan_legal_folder(
                empresa_codigo, root, existing_paths, result
            )
        except Exception as exc:  # noqa: BLE001
            result.errors.append(f"Scan {root}: {exc}")
            return result

        await self.db.flush()
        return result

    async def _scan_legal_folder(
        self,
        empresa_codigo: str,
        path: str,
        existing_paths: set[str],
        result: SyncResult,
        depth: int = 0,
    ) -> None:
        """Recursión limitada (max depth=4) para evitar runaways."""
        if depth > 4:
            return
        try:
            items = self.dropbox.list_folder(path)
        except Exception as exc:  # noqa: BLE001
            result.errors.append(f"Listar {path}: {exc}")
            return

        for item in items:
            if item["type"] == "folder":
                await self._scan_legal_folder(
                    empresa_codigo, item["path"], existing_paths, result, depth + 1
                )
                continue
            if item["type"] != "file":
                continue
            if not _is_doc_extension(item["name"]):
                continue
            full_path = item["path"]
            if full_path in existing_paths:
                result.skipped += 1
                continue
            categoria, subcategoria = _infer_legal_categoria(full_path)
            fecha_emision = _extract_fecha_emision(item["name"])
            # Nombre humano: archivo sin extensión
            nombre_humano = item["name"].rsplit(".", 1)[0].strip()
            try:
                doc = LegalDocument(
                    empresa_codigo=empresa_codigo,
                    categoria=categoria,
                    subcategoria=subcategoria,
                    nombre=nombre_humano[:255],
                    dropbox_path=full_path,
                    estado="vigente",
                    fecha_emision=fecha_emision,
                )
                self.db.add(doc)
                existing_paths.add(full_path)
                result.created_legal += 1
            except Exception as exc:  # noqa: BLE001
                result.errors.append(f"Crear legal {full_path}: {exc}")

    # -----------------------------------------------------------------
    # Sync: F29
    # -----------------------------------------------------------------

    async def sync_f29(self, empresa_codigo: str) -> SyncResult:
        """Escanea `03-Legal/Declaraciones SII/F29/` y crea F29 faltantes.

        Nombre archivo `YYYY-MM.pdf` → periodo_tributario `MM_YY`.
        Si el archivo no tiene patrón YYYY-MM se ignora (skipped++).
        """
        result = SyncResult()
        root = (
            f"{DROPBOX_ROOT_LEGAL}/{empresa_codigo}"
            f"/03-Legal/Declaraciones SII/F29"
        )
        try:
            items = self.dropbox.list_folder(root)
        except Exception as exc:  # noqa: BLE001
            result.errors.append(f"Listar {root}: {exc}")
            return result

        # Pre-cargar periodos existentes
        existing_rows = (
            await self.db.execute(
                text(
                    "SELECT periodo_tributario FROM core.f29_obligaciones "
                    "WHERE empresa_codigo = :empresa"
                ),
                {"empresa": empresa_codigo},
            )
        ).fetchall()
        existing_periodos: set[str] = {r[0] for r in existing_rows}

        for item in items:
            if item["type"] != "file":
                continue
            if not _is_doc_extension(item["name"]):
                continue
            periodo = _extract_periodo_tributario(item["name"])
            if periodo is None:
                result.skipped += 1
                continue
            if periodo in existing_periodos:
                result.skipped += 1
                continue
            # Vencimiento por defecto: día 12 del mes siguiente al periodo (CL F29).
            try:
                mm = int(periodo.split("_")[0])
                yy = int(periodo.split("_")[1])
                year = 2000 + yy
                next_month = mm + 1
                next_year = year
                if next_month > 12:
                    next_month = 1
                    next_year += 1
                fecha_vencimiento = date(next_year, next_month, 12)
            except ValueError as exc:
                result.errors.append(
                    f"Periodo inválido {periodo} en {item['name']}: {exc}"
                )
                continue

            try:
                await self.db.execute(
                    text(
                        """
                        INSERT INTO core.f29_obligaciones
                            (empresa_codigo, periodo_tributario,
                             fecha_vencimiento, estado, comprobante_url)
                        VALUES (:empresa, :periodo, :venc, 'pendiente', :url)
                        ON CONFLICT (empresa_codigo, periodo_tributario) DO NOTHING
                        """
                    ),
                    {
                        "empresa": empresa_codigo,
                        "periodo": periodo,
                        "venc": fecha_vencimiento,
                        "url": item["path"],
                    },
                )
                existing_periodos.add(periodo)
                result.created_f29 += 1
            except Exception as exc:  # noqa: BLE001
                result.errors.append(
                    f"Crear F29 {periodo} ({item['name']}): {exc}"
                )

        return result
