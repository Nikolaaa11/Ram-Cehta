"""Round 120 — Vista admin de la data del fondo.

Lee tablas pobladas por el seed Round 116:
  - core.empresas (con pagina_web, direccion_sii, etc.)
  - core.empresa_credenciales (status sin revelar password)
  - core.directorio_miembros
  - core.inversionistas_aportantes

Solo lectura por ahora. Para editar usar Supabase Studio o ampliar
en Round 121+ con endpoints PATCH.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.core.security import AuthenticatedUser

log = logging.getLogger(__name__)
router = APIRouter()


# =====================================================================
# Schemas
# =====================================================================


class EmpresaDataRead(BaseModel):
    empresa_codigo: str
    razon_social: str | None
    rut: str | None
    pagina_web: str | None
    giro: str | None
    direccion: str | None
    direccion_sii: str | None
    contabilidad_proveedor: str | None
    representante_legal: str | None
    email_firmante: str | None
    activo: bool
    # Status de credenciales (sin revelar passwords)
    tiene_credencial_sii: bool
    tiene_credencial_previred: bool
    sii_ultima_validacion_ok: bool | None
    sii_ultima_validacion_at: datetime | None


class DirectorioMiembroRead(BaseModel):
    miembro_id: int
    nombre: str
    rut: str | None
    direccion: str | None
    telefono: str | None
    banco: str | None
    cuenta: str | None
    codigo_banco: str | None
    correo: str | None
    activo: bool


class InversionistaRead(BaseModel):
    inversionista_id: int
    nombre: str
    rut: str | None
    direccion: str | None
    telefono: str | None
    banco: str | None
    cuenta: str | None
    codigo_banco: str | None
    correo: str | None
    tipo: str
    activo: bool


class FondoOverview(BaseModel):
    """Single payload con todo. Una sola request para el dashboard."""
    empresas: list[EmpresaDataRead]
    directorio: list[DirectorioMiembroRead]
    inversionistas: list[InversionistaRead]
    # KPIs útiles
    empresas_count: int
    empresas_con_sii: int
    empresas_con_previred: int
    directorio_count: int
    inversionistas_count: int
    # Round 120 — flags de "tablas migradas" para mostrar mensaje claro
    # si el operador todavia no aplico migracion 115 (R115).
    migracion_115_aplicada: bool
    columna_pagina_web_existe: bool


# =====================================================================
# Helpers
# =====================================================================


async def _require_admin(user: AuthenticatedUser) -> AuthenticatedUser:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Endpoint solo accesible por administradores",
        )
    return user


# =====================================================================
# Endpoint único - overview de todo el fondo
# =====================================================================


async def _check_migracion_aplicada(db: Any) -> tuple[bool, bool]:
    """Detecta si la migración 115 (tablas SII/directorio/inversionistas) está aplicada.

    Returns: (migracion_completa, columna_pagina_web_existe)
    """
    row = (
        await db.execute(
            text(
                """
                SELECT
                    EXISTS (SELECT 1 FROM information_schema.tables
                            WHERE table_schema = 'core' AND table_name = 'empresa_credenciales') AS t1,
                    EXISTS (SELECT 1 FROM information_schema.tables
                            WHERE table_schema = 'core' AND table_name = 'directorio_miembros') AS t2,
                    EXISTS (SELECT 1 FROM information_schema.tables
                            WHERE table_schema = 'core' AND table_name = 'inversionistas_aportantes') AS t3,
                    EXISTS (SELECT 1 FROM information_schema.columns
                            WHERE table_schema = 'core' AND table_name = 'empresas'
                              AND column_name = 'pagina_web') AS c1
                """
            )
        )
    ).fetchone()
    completa = bool(row[0] and row[1] and row[2])
    col_web = bool(row[3])
    return completa, col_web


@router.get("/fondo-overview", response_model=FondoOverview)
async def fondo_overview(
    user: CurrentUser, db: DBSession
) -> FondoOverview:
    """Devuelve toda la data del fondo en un solo response.

    Pensado para alimentar el dashboard /admin/data con 1 sola request
    en lugar de 4 separadas.

    Defensive: si la migración 115 no se aplicó, devuelve empresas con
    los campos básicos (sin web/SII data) + arrays vacíos en directorio/
    inversionistas + flags `migracion_115_aplicada=false`.
    """
    await _require_admin(user)

    migracion_completa, col_web = await _check_migracion_aplicada(db)

    # 1. Empresas (con o sin columnas nuevas según migración)
    if col_web:
        emp_sql = """
            SELECT
                e.codigo, e.razon_social, e.rut,
                e.pagina_web, e.giro, e.direccion, e.direccion_sii,
                e.contabilidad_proveedor, e.representante_legal,
                e.email_firmante, e.activo
            FROM core.empresas e
            WHERE e.activo = TRUE
            ORDER BY e.codigo
        """
    else:
        # Fallback: columnas viejas
        emp_sql = """
            SELECT
                e.codigo, e.razon_social, e.rut,
                NULL::text AS pagina_web, e.giro, e.direccion,
                NULL::text AS direccion_sii,
                NULL::text AS contabilidad_proveedor,
                e.representante_legal, e.email_firmante, e.activo
            FROM core.empresas e
            WHERE e.activo = TRUE
            ORDER BY e.codigo
        """
    emp_rows = (await db.execute(text(emp_sql))).fetchall()

    # 2. Status de credenciales (separado para no romper si tabla no existe)
    creds_by_empresa: dict[str, dict[str, Any]] = {}
    if migracion_completa:
        cred_rows = (
            await db.execute(
                text(
                    """
                    SELECT empresa_codigo, sistema, ultima_validacion_ok, ultima_validacion_at
                    FROM core.empresa_credenciales
                    """
                )
            )
        ).fetchall()
        for r in cred_rows:
            creds_by_empresa.setdefault(r[0], {})[r[1]] = {
                "ok": r[2], "at": r[3],
            }

    empresas: list[EmpresaDataRead] = []
    for r in emp_rows:
        codigo = r[0]
        cred_info = creds_by_empresa.get(codigo, {})
        sii_info = cred_info.get("sii") or {}
        empresas.append(EmpresaDataRead(
            empresa_codigo=codigo,
            razon_social=r[1],
            rut=r[2],
            pagina_web=r[3],
            giro=r[4],
            direccion=r[5],
            direccion_sii=r[6],
            contabilidad_proveedor=r[7],
            representante_legal=r[8],
            email_firmante=r[9],
            activo=bool(r[10]),
            tiene_credencial_sii="sii" in cred_info,
            tiene_credencial_previred="previred" in cred_info,
            sii_ultima_validacion_ok=sii_info.get("ok"),
            sii_ultima_validacion_at=sii_info.get("at"),
        ))

    # 2. Directorio (solo si migración aplicada)
    directorio: list[DirectorioMiembroRead] = []
    if migracion_completa:
        dir_rows = (
            await db.execute(
                text(
                    """
                    SELECT miembro_id, nombre, rut, direccion, telefono,
                           banco, cuenta, codigo_banco, correo, activo
                    FROM core.directorio_miembros
                    WHERE activo = TRUE
                    ORDER BY nombre
                    """
                )
            )
        ).fetchall()
        directorio = [
            DirectorioMiembroRead(
                miembro_id=r[0], nombre=r[1], rut=r[2],
                direccion=r[3], telefono=r[4], banco=r[5],
                cuenta=r[6], codigo_banco=r[7], correo=r[8],
                activo=bool(r[9]),
            )
            for r in dir_rows
        ]

    # 3. Inversionistas (solo si migración aplicada)
    inversionistas: list[InversionistaRead] = []
    if migracion_completa:
        inv_rows = (
            await db.execute(
                text(
                    """
                    SELECT inversionista_id, nombre, rut, direccion, telefono,
                           banco, cuenta, codigo_banco, correo, tipo, activo
                    FROM core.inversionistas_aportantes
                    WHERE activo = TRUE
                    ORDER BY nombre
                    """
                )
            )
        ).fetchall()
        inversionistas = [
            InversionistaRead(
                inversionista_id=r[0], nombre=r[1], rut=r[2],
                direccion=r[3], telefono=r[4], banco=r[5],
                cuenta=r[6], codigo_banco=r[7], correo=r[8],
                tipo=r[9], activo=bool(r[10]),
            )
            for r in inv_rows
        ]

    return FondoOverview(
        empresas=empresas,
        directorio=directorio,
        inversionistas=inversionistas,
        empresas_count=len(empresas),
        empresas_con_sii=sum(1 for e in empresas if e.tiene_credencial_sii),
        empresas_con_previred=sum(1 for e in empresas if e.tiene_credencial_previred),
        directorio_count=len(directorio),
        inversionistas_count=len(inversionistas),
        migracion_115_aplicada=migracion_completa,
        columna_pagina_web_existe=col_web,
    )
