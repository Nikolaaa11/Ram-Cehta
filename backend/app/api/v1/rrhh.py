"""R152vvv · Endpoints módulo RRHH.

Owners: Benjamín Toro (Adm. y Finanzas) + Victoria (allowlist en DB).

Recursos:
  GET    /rrhh/empleados                        catálogo
  GET    /rrhh/empleados/{rut}/costos           histórico costos por periodo
  GET    /rrhh/libros                           listar libros mensuales
  GET    /rrhh/libros/{libro_id}                detalle libro + líneas
  POST   /rrhh/libros/upload                    subir Excel libro
  GET    /rrhh/costo-empresa?empresa=&periodo=  costo agregado empresa-mes
  GET    /rrhh/access                           verifica si el user puede ver RRHH
"""

from __future__ import annotations

import tempfile
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from pydantic import BaseModel, ConfigDict
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.core.security import AuthenticatedUser
from app.services.libro_remuneraciones_parser import (
    LibroParseado,
    parse_libro_remuneraciones,
)

router = APIRouter()


# ─────────────────────────────────────────────────────────────────────
# Permisos: allowlist en core.rrhh_allowlist + admins
# ─────────────────────────────────────────────────────────────────────


async def _check_rrhh_access(user: AuthenticatedUser, db) -> None:
    """Lanza 403 si el user no es admin ni está en allowlist RRHH."""
    if getattr(user, "is_admin", False):
        return
    email = (getattr(user, "email", "") or "").lower().strip()
    if not email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No autorizado para RRHH (sin email)",
        )
    row = await db.execute(
        text("SELECT 1 FROM core.rrhh_allowlist WHERE email = :e"),
        {"e": email},
    )
    if not row.first():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Módulo RRHH restringido a Benjamín, Victoria y admins. "
                "Para acceder pedile a un admin que te agregue a "
                "core.rrhh_allowlist."
            ),
        )


# ─────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────


class EmpleadoRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    rut: str
    nombre: str
    empresa_codigo: str
    area: str | None
    cargo: str | None
    fecha_ingreso: str | None
    activo: bool
    sueldo_base_actual: Decimal | None


class LineaLibroRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    empleado_rut: str
    nombre: str
    area: str | None
    dias_trabajados: Decimal
    total_haberes: Decimal
    liquido_pagado: Decimal
    total_descuentos_legales: Decimal
    total_aportes_patronales: Decimal
    costo_total_empresa: Decimal
    # Detalles haberes
    sueldo_base: Decimal
    horas_extras: Decimal
    gratificacion_legal: Decimal
    asignacion_familiar: Decimal
    # Aportes patronales detallados
    aporte_afp_empleador: Decimal
    sis: Decimal
    seguro_cesantia_empleador: Decimal
    seguro_social: Decimal
    mutual: Decimal
    base_tributable: Decimal
    impuesto_unico: Decimal


class LibroRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    empresa_codigo: str
    periodo: str
    total_haberes: Decimal
    total_liquido: Decimal
    total_descuentos_legales: Decimal
    total_aportes_patronales: Decimal
    total_costo_empresa: Decimal
    cantidad_empleados: int
    archivo_origen: str | None
    uploaded_at: datetime


class LibroDetalle(LibroRead):
    lineas: list[LineaLibroRead]


class CostoHistorico(BaseModel):
    rut: str
    nombre: str
    periodo: str
    empresa_codigo: str
    area: str | None
    total_haberes: Decimal
    liquido_pagado: Decimal
    total_aportes_patronales: Decimal
    costo_total_empresa: Decimal
    multiplicador_costo: Decimal | None


class UploadResult(BaseModel):
    libro_id: int
    empresa_codigo: str
    periodo: str
    cantidad_empleados: int
    total_costo_empresa: Decimal
    reemplazo: bool  # True si había uno previo y se sobreescribió


class AccessResponse(BaseModel):
    allowed: bool
    reason: str | None = None


# ─────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────


@router.get("/access", response_model=AccessResponse)
async def check_access(user: CurrentUser, db: DBSession) -> AccessResponse:
    """Endpoint público (autenticado) que devuelve si el user puede ver /rrhh."""
    try:
        await _check_rrhh_access(user, db)
        return AccessResponse(allowed=True)
    except HTTPException as e:
        return AccessResponse(allowed=False, reason=e.detail)


@router.get("/empleados", response_model=list[EmpleadoRead])
async def list_empleados(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str | None = Query(default=None),
    incluir_inactivos: bool = Query(default=False),
) -> list[EmpleadoRead]:
    await _check_rrhh_access(user, db)
    wheres = []
    params: dict = {}
    if empresa_codigo:
        wheres.append("empresa_codigo = :e")
        params["e"] = empresa_codigo
    if not incluir_inactivos:
        wheres.append("activo = TRUE")
    where_sql = (" WHERE " + " AND ".join(wheres)) if wheres else ""
    rows = await db.execute(
        text(
            f"""
            SELECT rut, nombre, empresa_codigo, area, cargo,
                   to_char(fecha_ingreso, 'YYYY-MM-DD') AS fecha_ingreso,
                   activo, sueldo_base_actual
            FROM core.empleados
            {where_sql}
            ORDER BY empresa_codigo, area NULLS LAST, nombre
            """
        ),
        params,
    )
    return [EmpleadoRead.model_validate(dict(r._mapping)) for r in rows]


@router.get("/empleados/{rut}/costos", response_model=list[CostoHistorico])
async def costos_empleado(
    user: CurrentUser, db: DBSession, rut: str
) -> list[CostoHistorico]:
    await _check_rrhh_access(user, db)
    rows = await db.execute(
        text(
            """
            SELECT rut, nombre, periodo, empresa_codigo, area,
                   total_haberes, liquido_pagado, total_aportes_patronales,
                   costo_total_empresa, multiplicador_costo
            FROM core.v_costo_empleado_mensual
            WHERE rut = :r
            ORDER BY periodo DESC
            """
        ),
        {"r": rut},
    )
    return [CostoHistorico.model_validate(dict(r._mapping)) for r in rows]


@router.get("/libros", response_model=list[LibroRead])
async def list_libros(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str | None = Query(default=None),
    periodo: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> list[LibroRead]:
    await _check_rrhh_access(user, db)
    wheres = []
    params: dict = {}
    if empresa_codigo:
        wheres.append("empresa_codigo = :e")
        params["e"] = empresa_codigo
    if periodo:
        wheres.append("periodo = :p")
        params["p"] = periodo
    where_sql = (" WHERE " + " AND ".join(wheres)) if wheres else ""
    rows = await db.execute(
        text(
            f"""
            SELECT id, empresa_codigo, periodo, total_haberes, total_liquido,
                   total_descuentos_legales, total_aportes_patronales,
                   total_costo_empresa, cantidad_empleados,
                   archivo_origen, uploaded_at
            FROM core.libros_remuneraciones
            {where_sql}
            ORDER BY periodo DESC, empresa_codigo
            """
        ),
        params,
    )
    return [LibroRead.model_validate(dict(r._mapping)) for r in rows]


@router.get("/libros/{libro_id}", response_model=LibroDetalle)
async def get_libro(
    user: CurrentUser, db: DBSession, libro_id: int
) -> LibroDetalle:
    await _check_rrhh_access(user, db)
    libro_row = (
        await db.execute(
            text(
                """
                SELECT id, empresa_codigo, periodo, total_haberes, total_liquido,
                       total_descuentos_legales, total_aportes_patronales,
                       total_costo_empresa, cantidad_empleados,
                       archivo_origen, uploaded_at
                FROM core.libros_remuneraciones
                WHERE id = :id
                """
            ),
            {"id": libro_id},
        )
    ).first()
    if not libro_row:
        raise HTTPException(status_code=404, detail="Libro no encontrado")
    lineas_rows = await db.execute(
        text(
            """
            SELECT id, empleado_rut, nombre, area, dias_trabajados,
                   total_haberes, liquido_pagado, total_descuentos_legales,
                   total_aportes_patronales, costo_total_empresa,
                   sueldo_base, horas_extras, gratificacion_legal,
                   asignacion_familiar,
                   aporte_afp_empleador, sis, seguro_cesantia_empleador,
                   seguro_social, mutual,
                   base_tributable, impuesto_unico
            FROM core.libro_remuneraciones_lineas
            WHERE libro_id = :id
            ORDER BY area NULLS LAST, nombre
            """
        ),
        {"id": libro_id},
    )
    lineas = [LineaLibroRead.model_validate(dict(r._mapping)) for r in lineas_rows]
    base = dict(libro_row._mapping)
    base["lineas"] = lineas
    return LibroDetalle.model_validate(base)


@router.post("/libros/upload", response_model=UploadResult)
async def upload_libro(
    user: CurrentUser,
    db: DBSession,
    file: Annotated[UploadFile, File(...)],
    empresa_codigo: Annotated[
        str, Query(description="Código empresa destino (RVT, AFIS, etc.)")
    ],
) -> UploadResult:
    """Sube un Excel libro de remuneraciones. Reemplaza el del periodo si existe."""
    await _check_rrhh_access(user, db)

    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=400, detail="Sólo se aceptan archivos .xlsx / .xls"
        )

    # Verificar empresa
    e = await db.scalar(
        text("SELECT 1 FROM core.empresas WHERE codigo = :c AND activo = TRUE"),
        {"c": empresa_codigo},
    )
    if not e:
        raise HTTPException(
            status_code=400,
            detail=f"Empresa {empresa_codigo} no existe o está inactiva",
        )

    # Guardar tmp + parsear
    contents = await file.read()
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp.write(contents)
        tmp_path = Path(tmp.name)
    try:
        parsed = parse_libro_remuneraciones(tmp_path)
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"No se pudo parsear el Excel: {exc}",
        ) from exc
    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass

    if not parsed.lineas:
        raise HTTPException(
            status_code=400,
            detail="El Excel no contiene líneas de empleados parseables",
        )

    # Reemplazo si ya existe libro de este periodo-empresa
    existing = await db.scalar(
        text(
            """SELECT id FROM core.libros_remuneraciones
               WHERE empresa_codigo = :c AND periodo = :p"""
        ),
        {"c": empresa_codigo, "p": parsed.periodo},
    )
    reemplazo = bool(existing)
    if existing:
        await db.execute(
            text("DELETE FROM core.libros_remuneraciones WHERE id = :id"),
            {"id": existing},
        )

    # Insert libro cabecera
    libro_id_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.libros_remuneraciones
                    (empresa_codigo, periodo,
                     total_haberes, total_liquido, total_descuentos_legales,
                     total_aportes_patronales, total_costo_empresa,
                     archivo_origen, archivo_hash, uploaded_by,
                     cantidad_empleados)
                VALUES
                    (:c, :p, :th, :tl, :tdl, :tap, :tce,
                     :origen, :hash, CAST(:u AS UUID), :cant)
                RETURNING id
                """
            ),
            {
                "c": empresa_codigo,
                "p": parsed.periodo,
                "th": parsed.total_haberes,
                "tl": parsed.total_liquido,
                "tdl": parsed.total_descuentos_legales,
                "tap": parsed.total_aportes_patronales,
                "tce": parsed.total_costo_empresa,
                "origen": parsed.archivo_origen,
                "hash": parsed.archivo_hash,
                "u": str(getattr(user, "sub", "") or ""),
                "cant": len(parsed.lineas),
            },
        )
    ).fetchone()
    libro_id = libro_id_row[0]

    # Insert líneas + upsert empleados
    for l in parsed.lineas:
        # Auto-crear empleado si no existe (operativo: el upload trae el catálogo)
        await db.execute(
            text(
                """
                INSERT INTO core.empleados
                    (rut, nombre, empresa_codigo, area, sueldo_base_actual, activo)
                VALUES (:rut, :nombre, :emp, :area, :sb, TRUE)
                ON CONFLICT (rut) DO UPDATE SET
                    nombre = EXCLUDED.nombre,
                    empresa_codigo = EXCLUDED.empresa_codigo,
                    area = COALESCE(EXCLUDED.area, core.empleados.area),
                    sueldo_base_actual = EXCLUDED.sueldo_base_actual,
                    updated_at = NOW()
                """
            ),
            {
                "rut": l.rut,
                "nombre": l.nombre,
                "emp": empresa_codigo,
                "area": l.area,
                "sb": l.sueldo_base,
            },
        )

        await db.execute(
            text(
                """
                INSERT INTO core.libro_remuneraciones_lineas (
                    libro_id, empleado_rut, nombre, area, dias_trabajados,
                    sueldo_base, horas_extras, gratificacion_legal,
                    otros_imponibles, total_imponibles,
                    asignacion_familiar, otros_no_imponibles,
                    total_no_imponibles, total_haberes,
                    prevision, salud, seguro_cesantia_trab,
                    otros_descuentos_legales, total_descuentos_legales,
                    descuentos_varios, total_descuentos, liquido_pagado,
                    aporte_afp_empleador, sis, seguro_cesantia_empleador,
                    seguro_social, mutual, total_aportes_patronales,
                    base_tributable, impuesto_unico,
                    costo_total_empresa
                ) VALUES (
                    :libro_id, :rut, :nombre, :area, :dt,
                    :sb, :he, :gl, :oi, :ti,
                    :af, :oni, :tni, :th,
                    :prev, :sal, :sct, :odl, :tdl,
                    :dv, :td, :liq,
                    :aae, :sis, :sce, :ss, :mut, :tap,
                    :bt, :iu, :cte
                )
                """
            ),
            {
                "libro_id": libro_id,
                "rut": l.rut,
                "nombre": l.nombre,
                "area": l.area,
                "dt": l.dias_trabajados,
                "sb": l.sueldo_base,
                "he": l.horas_extras,
                "gl": l.gratificacion_legal,
                "oi": l.otros_imponibles,
                "ti": l.total_imponibles,
                "af": l.asignacion_familiar,
                "oni": l.otros_no_imponibles,
                "tni": l.total_no_imponibles,
                "th": l.total_haberes,
                "prev": l.prevision,
                "sal": l.salud,
                "sct": l.seguro_cesantia_trab,
                "odl": l.otros_descuentos_legales,
                "tdl": l.total_descuentos_legales,
                "dv": l.descuentos_varios,
                "td": l.total_descuentos,
                "liq": l.liquido_pagado,
                "aae": l.aporte_afp_empleador,
                "sis": l.sis,
                "sce": l.seguro_cesantia_empleador,
                "ss": l.seguro_social,
                "mut": l.mutual,
                "tap": l.total_aportes_patronales,
                "bt": l.base_tributable,
                "iu": l.impuesto_unico,
                "cte": l.costo_total_empresa,
            },
        )

    await db.commit()

    return UploadResult(
        libro_id=libro_id,
        empresa_codigo=empresa_codigo,
        periodo=parsed.periodo,
        cantidad_empleados=len(parsed.lineas),
        total_costo_empresa=parsed.total_costo_empresa,
        reemplazo=reemplazo,
    )


@router.get("/costo-empresa")
async def costo_empresa(
    user: CurrentUser,
    db: DBSession,
    empresa_codigo: str = Query(...),
    desde: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
    hasta: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}$"),
) -> dict:
    """Costo agregado por empresa en un rango de periodos."""
    await _check_rrhh_access(user, db)
    wheres = ["empresa_codigo = :c"]
    params: dict = {"c": empresa_codigo}
    if desde:
        wheres.append("periodo >= :d")
        params["d"] = desde
    if hasta:
        wheres.append("periodo <= :h")
        params["h"] = hasta
    where_sql = " WHERE " + " AND ".join(wheres)
    rows = await db.execute(
        text(
            f"""
            SELECT periodo,
                   SUM(total_haberes) AS total_haberes,
                   SUM(total_liquido) AS total_liquido,
                   SUM(total_aportes_patronales) AS total_aportes_patronales,
                   SUM(total_costo_empresa) AS total_costo_empresa,
                   SUM(cantidad_empleados) AS cantidad_empleados
            FROM core.libros_remuneraciones
            {where_sql}
            GROUP BY periodo
            ORDER BY periodo
            """
        ),
        params,
    )
    series = [dict(r._mapping) for r in rows]
    total_costo = sum((Decimal(s["total_costo_empresa"] or 0) for s in series), Decimal("0"))
    return {
        "empresa_codigo": empresa_codigo,
        "periodos": series,
        "total_costo_acumulado": total_costo,
    }
