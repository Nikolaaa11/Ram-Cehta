"""BulkImportService — V3 fase 11.

Importación masiva de entidades vía CSV con flujo de dos pasos:
  1. `parse_csv` + `validate_rows` → `ValidationReport` (dry-run, no commit).
  2. `execute_import` → `ImportResult` (insert real + audit_log).

Diseño:
  * El parser tolera 3 encodings (utf-8 / utf-8-sig / latin-1) y normaliza
    headers (lowercase, trim, espacios → underscore). Esto permite
    onboarding sin pelear contra Excel-CL exportando con BOM.
  * La validación se delega a la Pydantic Create schema de cada entidad
    (`TrabajadorCreate`, `FondoCreate`, `ProveedorCreate`), reutilizando
    todo el RUT validator + Literal whitelist sin duplicar código.
  * Dedup contra DB:
      - Trabajadores: clave `(empresa_codigo, rut)`.
      - Fondos: `nombre` case-insensitive.
      - Proveedores: `rut` si existe, sino `razon_social` (case-insensitive).
  * `execute_import` re-valida antes de insertar (defensa en profundidad)
    y dedup también dentro del mismo lote para evitar inserts dupes
    cuando el usuario manda dos filas con el mismo RUT.
"""
from __future__ import annotations

import csv
import io
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.fondo import Fondo
from app.models.proveedor import Proveedor
from app.models.trabajador import Trabajador
from app.schemas.bulk_import import (
    DuplicateRow,
    ImportResult,
    ImportRowError,
    InvalidRow,
    ValidationReport,
    ValidRow,
)
from app.schemas.fondo import FondoCreate
from app.schemas.proveedor import ProveedorCreate
from app.schemas.trabajador import TrabajadorCreate

# ---------------------------------------------------------------------------
# Constants & helpers
# ---------------------------------------------------------------------------

ENTITY_TYPES = ("trabajadores", "fondos", "proveedores")

#: Mapping entity_type → Pydantic Create schema.
_CREATE_SCHEMAS: dict[str, type[BaseModel]] = {
    "trabajadores": TrabajadorCreate,
    "fondos": FondoCreate,
    "proveedores": ProveedorCreate,
}

#: Required columns by entity (después de normalización).
_REQUIRED_COLS: dict[str, tuple[str, ...]] = {
    "trabajadores": ("empresa_codigo", "nombre_completo", "rut", "fecha_ingreso"),
    "fondos": ("nombre", "tipo"),
    "proveedores": ("razon_social",),
}


def _normalize_key(k: str) -> str:
    """lowercase + strip + spaces→underscore. Estable y idempotente."""
    return k.strip().lower().replace(" ", "_")


def _decode_bytes(content: bytes) -> str:
    """Soft-fail decode: utf-8-sig → utf-8 → latin-1.

    Probamos `utf-8-sig` primero porque consume el BOM si está presente y
    cae limpio a utf-8 si no — Excel-CL agrega BOM por default. Un CSV
    utf-8 sin BOM decodea idénticamente con utf-8-sig.
    `latin-1` nunca falla (identity 0-255), es el fallback final.
    """
    for enc in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    # Inalcanzable: latin-1 nunca raisea.
    return content.decode("latin-1", errors="replace")


def _strip_value(v: Any) -> Any:
    """Strip strings, deja otros tipos como están. Empty string → None."""
    if isinstance(v, str):
        s = v.strip()
        return s if s else None
    return v


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class BulkImportService:
    """Servicio principal para importación CSV de trabajadores/fondos/proveedores."""

    def __init__(self, db: AsyncSession) -> None:
        self._db = db

    # -----------------------------------------------------------------
    # Step 1: parse + validate (dry-run)
    # -----------------------------------------------------------------

    def parse_csv(self, content: bytes, entity_type: str) -> list[dict[str, Any]]:
        """Parsea el CSV → lista de dicts con claves normalizadas.

        Args:
            content: bytes crudos del archivo subido.
            entity_type: ``trabajadores`` | ``fondos`` | ``proveedores``.

        Returns:
            Lista de filas. Cada fila es un dict donde los valores son strings
            (parser CSV no infiere tipos — el cast a date/Decimal lo hace
            Pydantic en `validate_rows`).

        Notas:
            * Si el header está vacío o la primera línea no parece CSV,
              devolvemos lista vacía.
            * El espacio en valores se preserva (sólo strip al validar).
        """
        if entity_type not in ENTITY_TYPES:
            raise ValueError(f"entity_type inválido: {entity_type!r}")

        text = _decode_bytes(content)
        reader = csv.DictReader(io.StringIO(text))
        rows: list[dict[str, Any]] = []
        for raw_row in reader:
            # raw_row puede tener None como key si hay columnas extra. Las descartamos.
            normalized: dict[str, Any] = {}
            for k, v in raw_row.items():
                if k is None:
                    continue
                normalized[_normalize_key(k)] = _strip_value(v)
            rows.append(normalized)
        return rows

    async def validate_rows(
        self, rows: list[dict[str, Any]], entity_type: str
    ) -> ValidationReport:
        """Valida cada fila contra el Create schema y detecta duplicados en DB."""
        if entity_type not in ENTITY_TYPES:
            raise ValueError(f"entity_type inválido: {entity_type!r}")

        schema_cls = _CREATE_SCHEMAS[entity_type]
        required = _REQUIRED_COLS[entity_type]

        invalid: list[InvalidRow] = []
        valid: list[ValidRow] = []
        valid_payloads: list[tuple[int, dict[str, Any]]] = []

        for idx, row in enumerate(rows):
            errors: list[str] = []

            # Required-column check antes de Pydantic (mejor mensaje).
            missing = [c for c in required if not row.get(c)]
            if missing:
                errors.append(f"Faltan columnas requeridas: {', '.join(missing)}")
                invalid.append(
                    InvalidRow(row_index=idx, errors=errors, original=row)
                )
                continue

            try:
                model = schema_cls.model_validate(row)
            except ValidationError as exc:
                for e in exc.errors():
                    loc = ".".join(str(x) for x in e.get("loc", ()))
                    msg = e.get("msg", "error")
                    errors.append(f"{loc}: {msg}" if loc else msg)
                invalid.append(
                    InvalidRow(row_index=idx, errors=errors, original=row)
                )
                continue

            cleaned = model.model_dump(mode="json", exclude_none=True)
            valid.append(ValidRow(row_index=idx, data=cleaned))
            valid_payloads.append((idx, cleaned))

        # Duplicate detection — sólo sobre filas que pasaron Pydantic.
        duplicates = await self._detect_duplicates(valid_payloads, entity_type)
        dup_indices = {d.row_index for d in duplicates}

        # Las duplicadas ya no van a `valid` (el frontend las muestra aparte).
        valid_filtered = [v for v in valid if v.row_index not in dup_indices]

        return ValidationReport(
            entity_type=entity_type,
            total_rows=len(rows),
            valid_rows=len(valid_filtered),
            invalid_rows=invalid,
            duplicates=duplicates,
            valid=valid_filtered,
        )

    # -----------------------------------------------------------------
    # Step 2: execute (insert real)
    # -----------------------------------------------------------------

    async def execute_import(
        self,
        rows: list[dict[str, Any]],
        entity_type: str,
        user_id: str | None,
    ) -> ImportResult:
        """Inserta las filas en DB. Re-valida y dedup-checks como defensa.

        El caller (router) es quien hace el ``await db.commit()`` y dispara
        el ``audit_log``. Acá sólo hacemos `add` + `flush`.
        """
        if entity_type not in ENTITY_TYPES:
            raise ValueError(f"entity_type inválido: {entity_type!r}")

        schema_cls = _CREATE_SCHEMAS[entity_type]
        created = 0
        skipped = 0
        errors: list[ImportRowError] = []

        # Track in-batch dedup keys para que dos filas con el mismo RUT no se inserten ambas.
        seen_keys: set[Any] = set()

        for idx, row in enumerate(rows):
            try:
                model = schema_cls.model_validate(row)
            except ValidationError as exc:
                skipped += 1
                errors.append(
                    ImportRowError(
                        row_index=idx,
                        detail=f"Validación falló: {exc.errors()[0].get('msg', 'error')}",
                    )
                )
                continue

            key = self._dedup_key(entity_type, model)
            if key is not None and key in seen_keys:
                skipped += 1
                errors.append(
                    ImportRowError(
                        row_index=idx,
                        detail=f"Duplicado dentro del lote: {key}",
                    )
                )
                continue

            existing = await self._find_existing(entity_type, model)
            if existing is not None:
                skipped += 1
                errors.append(
                    ImportRowError(
                        row_index=idx,
                        detail=f"Ya existe en DB: {key}",
                    )
                )
                continue

            try:
                await self._insert(entity_type, model)
                created += 1
                if key is not None:
                    seen_keys.add(key)
            except Exception as exc:  # pragma: no cover — defensivo
                skipped += 1
                errors.append(
                    ImportRowError(row_index=idx, detail=f"Insert error: {exc}")
                )

        return ImportResult(
            entity_type=entity_type,
            created=created,
            skipped=skipped,
            errors=errors,
        )

    # -----------------------------------------------------------------
    # Internals
    # -----------------------------------------------------------------

    @staticmethod
    def _dedup_key(entity_type: str, model: BaseModel) -> Any:
        if entity_type == "trabajadores":
            assert isinstance(model, TrabajadorCreate)
            return (model.empresa_codigo, model.rut)
        if entity_type == "fondos":
            assert isinstance(model, FondoCreate)
            return model.nombre.lower()
        if entity_type == "proveedores":
            assert isinstance(model, ProveedorCreate)
            return model.rut if model.rut else f"rs::{model.razon_social.lower()}"
        return None

    async def _detect_duplicates(
        self, valid_payloads: list[tuple[int, dict[str, Any]]], entity_type: str
    ) -> list[DuplicateRow]:
        if not valid_payloads:
            return []

        duplicates: list[DuplicateRow] = []

        if entity_type == "trabajadores":
            for idx, row in valid_payloads:
                emp = row.get("empresa_codigo")
                rut = row.get("rut")
                if not emp or not rut:
                    continue
                stmt = select(Trabajador.trabajador_id).where(
                    Trabajador.empresa_codigo == emp,
                    Trabajador.rut == rut,
                )
                existing_id = await self._db.scalar(stmt)
                if existing_id is not None:
                    duplicates.append(
                        DuplicateRow(
                            row_index=idx,
                            key=f"{emp}/{rut}",
                            existing_id=int(existing_id),
                            original=row,
                        )
                    )
        elif entity_type == "fondos":
            for idx, row in valid_payloads:
                nombre = row.get("nombre")
                if not nombre:
                    continue
                stmt = select(Fondo.fondo_id).where(
                    func.lower(Fondo.nombre) == nombre.lower()
                )
                existing_id = await self._db.scalar(stmt)
                if existing_id is not None:
                    duplicates.append(
                        DuplicateRow(
                            row_index=idx,
                            key=nombre,
                            existing_id=int(existing_id),
                            original=row,
                        )
                    )
        elif entity_type == "proveedores":
            for idx, row in valid_payloads:
                rut = row.get("rut")
                rs = row.get("razon_social")
                if rut:
                    stmt = select(Proveedor.proveedor_id).where(Proveedor.rut == rut)
                    existing_id = await self._db.scalar(stmt)
                    if existing_id is not None:
                        duplicates.append(
                            DuplicateRow(
                                row_index=idx,
                                key=rut,
                                existing_id=int(existing_id),
                                original=row,
                            )
                        )
                        continue
                if rs:
                    stmt = select(Proveedor.proveedor_id).where(
                        func.lower(Proveedor.razon_social) == rs.lower()
                    )
                    existing_id = await self._db.scalar(stmt)
                    if existing_id is not None:
                        duplicates.append(
                            DuplicateRow(
                                row_index=idx,
                                key=rs,
                                existing_id=int(existing_id),
                                original=row,
                            )
                        )

        return duplicates

    async def _find_existing(self, entity_type: str, model: BaseModel) -> Any:
        if entity_type == "trabajadores":
            assert isinstance(model, TrabajadorCreate)
            return await self._db.scalar(
                select(Trabajador.trabajador_id).where(
                    Trabajador.empresa_codigo == model.empresa_codigo,
                    Trabajador.rut == model.rut,
                )
            )
        if entity_type == "fondos":
            assert isinstance(model, FondoCreate)
            return await self._db.scalar(
                select(Fondo.fondo_id).where(
                    func.lower(Fondo.nombre) == model.nombre.lower()
                )
            )
        if entity_type == "proveedores":
            assert isinstance(model, ProveedorCreate)
            if model.rut:
                got = await self._db.scalar(
                    select(Proveedor.proveedor_id).where(Proveedor.rut == model.rut)
                )
                if got is not None:
                    return got
            return await self._db.scalar(
                select(Proveedor.proveedor_id).where(
                    func.lower(Proveedor.razon_social) == model.razon_social.lower()
                )
            )
        return None

    async def _insert(self, entity_type: str, model: BaseModel) -> None:
        payload = model.model_dump(exclude_none=True)
        if entity_type == "trabajadores":
            from app.infrastructure.repositories.trabajador_repository import (
                compute_dropbox_folder,
            )

            obj = Trabajador(**payload)
            obj.dropbox_folder = compute_dropbox_folder(
                payload["empresa_codigo"],
                payload["rut"],
                payload["nombre_completo"],
                activo=True,
            )
            self._db.add(obj)
        elif entity_type == "fondos":
            self._db.add(Fondo(**payload))
        elif entity_type == "proveedores":
            self._db.add(Proveedor(**payload))
        await self._db.flush()
