"""Round 123 — Endpoints de integración con Nubox (remuneraciones).

  GET   /admin/nubox/empresas
  POST  /admin/nubox/test-login/{empresa}
  POST  /admin/nubox/sync-remuneraciones/{empresa}?periodo=YYYY-MM   (best-effort)
  POST  /admin/nubox/import-excel/{empresa}?periodo=YYYY-MM          (fallback robusto)
  GET   /admin/nubox/runs/{empresa}
  GET   /admin/nubox/remuneraciones/{empresa}?periodo=YYYY-MM
  GET   /admin/nubox/resumen/{empresa}?periodo=YYYY-MM

Solo admin. Credenciales Nubox cifradas en core.empresa_credenciales
con sistema='nubox' (mismo módulo Fernet que SII/Previred).
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.core.security import AuthenticatedUser
from app.services.credentials_service import (
    CredentialDecryptError,
    CredentialsKeyMissing,
    decrypt_credential,
)
from app.services.nubox_client import (
    NuboxAuthError,
    NuboxClient,
    NuboxClientError,
    test_login as nubox_test_login,
)
from app.services.nubox_excel_parser import parse_libro_remuneraciones

log = logging.getLogger(__name__)
router = APIRouter()


# =====================================================================
# Schemas
# =====================================================================


class EmpresaNuboxStatus(BaseModel):
    empresa_codigo: str
    razon_social: str | None
    rut: str | None
    tiene_credencial_nubox: bool
    ultima_validacion_at: datetime | None
    ultima_validacion_ok: bool | None
    ultimo_sync_at: datetime | None
    ultimo_sync_status: str | None
    remuneraciones_count: int


class TestLoginResponse(BaseModel):
    empresa_codigo: str
    ok: bool
    message: str
    error_type: str | None = None


class SyncRemuneracionesResponse(BaseModel):
    run_id: int
    empresa_codigo: str
    periodo: str
    remuneraciones_count: int
    duracion_segundos: float
    status: str
    method: str  # 'auto' | 'manual_excel'


class ImportExcelResponse(BaseModel):
    inserted: int
    updated: int
    errors: list[str]
    run_id: int


class RemuneracionRead(BaseModel):
    remuneracion_id: int
    periodo: str
    trabajador_rut: str
    trabajador_nombre: str | None
    sueldo_base: int
    total_haberes: int
    afp_descuento: int
    salud_descuento: int
    total_descuentos: int
    sueldo_liquido: int
    voucher_id: int | None


class ResumenRemuneraciones(BaseModel):
    empresa_codigo: str
    periodo: str
    trabajadores_count: int
    total_haberes: int
    total_descuentos: int
    total_liquido: int
    total_afp: int
    total_salud: int
    total_impuesto: int
    total_aportes_patronales: int  # SIS + AFC patronal + Mutual


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


async def _get_credencial_nubox(
    db: Any, empresa_codigo: str
) -> tuple[str, str]:
    """Devuelve (rut_usuario, clave_plaintext). 404 si no hay."""
    row = (
        await db.execute(
            text(
                """
                SELECT rut_usuario, password_encrypted
                FROM core.empresa_credenciales
                WHERE empresa_codigo = :c AND sistema = 'nubox'
                """
            ),
            {"c": empresa_codigo},
        )
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No hay credencial Nubox para {empresa_codigo}. "
                f"Insertala manualmente en core.empresa_credenciales o "
                f"cargá el Libro de Remuneraciones via /import-excel."
            ),
        )
    try:
        plain = decrypt_credential(row[1])
    except (CredentialDecryptError, CredentialsKeyMissing) as exc:
        # R152UUUUUU — mensaje genérico al cliente (R152HHHHHH quedó
        # incompleto en este router: str(exc) filtraba detalle cripto) y
        # captura también CredentialsKeyMissing (Fernet key sin configurar
        # → antes 500 crudo, ahora 503 con mensaje accionable).
        log.error(
            "nubox.credential_decrypt_failed",
            extra={"err": str(exc)[:200]},
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "No se pudieron leer las credenciales de Nubox. Verificá "
                "que CREDENTIALS_FERNET_KEY esté configurada y las "
                "credenciales re-guardadas."
            ),
        ) from exc
    return row[0], plain


async def _persistir_remuneraciones(
    db: Any,
    empresa_codigo: str,
    items: list[dict[str, Any]],
    run_id: int,
) -> tuple[int, int]:
    """UPSERT en nubox_remuneraciones. Devuelve (inserted, updated)."""
    inserted = 0
    updated = 0
    for it in items:
        result = await db.execute(
            text(
                """
                INSERT INTO core.nubox_remuneraciones (
                    empresa_codigo, periodo, trabajador_rut, trabajador_nombre,
                    sueldo_base, gratificacion, horas_extras, bonos,
                    colacion, movilizacion, otros_haberes, total_haberes,
                    afp_descuento, salud_descuento, afc_descuento,
                    impuesto_unico, otros_descuentos, total_descuentos,
                    sueldo_liquido, sis_patronal, afc_patronal, mutual_patronal,
                    run_id, raw_data
                ) VALUES (
                    :c, :p, :rut, :nombre,
                    :sbase, :grat, :he, :bonos,
                    :col, :mov, :ohab, :thab,
                    :afp, :sal, :afc,
                    :imp, :odesc, :tdesc,
                    :liq, :sis, :afcp, :mut,
                    :rid, CAST(:raw AS jsonb)
                )
                ON CONFLICT (empresa_codigo, periodo, trabajador_rut)
                DO UPDATE SET
                    trabajador_nombre = COALESCE(EXCLUDED.trabajador_nombre,
                                                 core.nubox_remuneraciones.trabajador_nombre),
                    sueldo_base = EXCLUDED.sueldo_base,
                    gratificacion = EXCLUDED.gratificacion,
                    horas_extras = EXCLUDED.horas_extras,
                    bonos = EXCLUDED.bonos,
                    colacion = EXCLUDED.colacion,
                    movilizacion = EXCLUDED.movilizacion,
                    otros_haberes = EXCLUDED.otros_haberes,
                    total_haberes = EXCLUDED.total_haberes,
                    afp_descuento = EXCLUDED.afp_descuento,
                    salud_descuento = EXCLUDED.salud_descuento,
                    afc_descuento = EXCLUDED.afc_descuento,
                    impuesto_unico = EXCLUDED.impuesto_unico,
                    otros_descuentos = EXCLUDED.otros_descuentos,
                    total_descuentos = EXCLUDED.total_descuentos,
                    sueldo_liquido = EXCLUDED.sueldo_liquido,
                    sis_patronal = EXCLUDED.sis_patronal,
                    afc_patronal = EXCLUDED.afc_patronal,
                    mutual_patronal = EXCLUDED.mutual_patronal,
                    run_id = EXCLUDED.run_id,
                    raw_data = EXCLUDED.raw_data,
                    updated_at = NOW()
                RETURNING (xmax = 0) AS inserted
                """
            ),
            {
                "c": empresa_codigo,
                "p": it["periodo"],
                "rut": it["trabajador_rut"],
                "nombre": it["trabajador_nombre"],
                "sbase": it["sueldo_base"],
                "grat": it["gratificacion"],
                "he": it["horas_extras"],
                "bonos": it["bonos"],
                "col": it["colacion"],
                "mov": it["movilizacion"],
                "ohab": it["otros_haberes"],
                "thab": it["total_haberes"],
                "afp": it["afp_descuento"],
                "sal": it["salud_descuento"],
                "afc": it["afc_descuento"],
                "imp": it["impuesto_unico"],
                "odesc": it["otros_descuentos"],
                "tdesc": it["total_descuentos"],
                "liq": it["sueldo_liquido"],
                "sis": it["sis_patronal"],
                "afcp": it["afc_patronal"],
                "mut": it["mutual_patronal"],
                "rid": run_id,
                "raw": json.dumps(it, default=str),
            },
        )
        row = result.fetchone()
        if row and row[0]:
            inserted += 1
        else:
            updated += 1
    return inserted, updated


# =====================================================================
# Endpoints
# =====================================================================


@router.get("/empresas", response_model=list[EmpresaNuboxStatus])
async def list_empresas_nubox(
    user: CurrentUser, db: DBSession
) -> list[EmpresaNuboxStatus]:
    """Lista todas las empresas con su estado de integración Nubox."""
    await _require_admin(user)

    # Detección defensiva: si la migración Round 123 no se aplicó, devolver
    # empresas con flags en false en lugar de crashear.
    table_exists = (
        await db.execute(
            text(
                """
                SELECT EXISTS (SELECT 1 FROM information_schema.tables
                               WHERE table_schema = 'core' AND table_name = 'nubox_remuneraciones')
                """
            )
        )
    ).fetchone()[0]

    if not table_exists:
        # Migración no aplicada — devolver solo empresas base
        rows = (
            await db.execute(
                text(
                    """
                    SELECT codigo, razon_social, rut
                    FROM core.empresas
                    WHERE activo = TRUE
                    ORDER BY codigo
                    """
                )
            )
        ).fetchall()
        return [
            EmpresaNuboxStatus(
                empresa_codigo=r[0], razon_social=r[1], rut=r[2],
                tiene_credencial_nubox=False,
                ultima_validacion_at=None, ultima_validacion_ok=None,
                ultimo_sync_at=None, ultimo_sync_status=None,
                remuneraciones_count=0,
            )
            for r in rows
        ]

    rows = (
        await db.execute(
            text(
                """
                SELECT
                    e.codigo, e.razon_social, e.rut,
                    (cred.credencial_id IS NOT NULL) AS tiene_cred,
                    cred.ultima_validacion_at,
                    cred.ultima_validacion_ok,
                    last_run.finished_at AS ultimo_sync_at,
                    last_run.status AS ultimo_sync_status,
                    COALESCE(r.cnt, 0) AS rem_count
                FROM core.empresas e
                LEFT JOIN core.empresa_credenciales cred
                    ON cred.empresa_codigo = e.codigo AND cred.sistema = 'nubox'
                LEFT JOIN LATERAL (
                    SELECT finished_at, status
                    FROM core.nubox_sync_runs sr
                    WHERE sr.empresa_codigo = e.codigo
                    ORDER BY started_at DESC LIMIT 1
                ) last_run ON TRUE
                LEFT JOIN (
                    SELECT empresa_codigo, COUNT(*) AS cnt
                    FROM core.nubox_remuneraciones
                    GROUP BY empresa_codigo
                ) r ON r.empresa_codigo = e.codigo
                WHERE e.activo = TRUE
                ORDER BY e.codigo
                """
            )
        )
    ).fetchall()

    return [
        EmpresaNuboxStatus(
            empresa_codigo=r[0], razon_social=r[1], rut=r[2],
            tiene_credencial_nubox=bool(r[3]),
            ultima_validacion_at=r[4], ultima_validacion_ok=r[5],
            ultimo_sync_at=r[6], ultimo_sync_status=r[7],
            remuneraciones_count=int(r[8] or 0),
        )
        for r in rows
    ]


@router.post(
    "/test-login/{empresa_codigo}",
    response_model=TestLoginResponse,
)
async def test_credenciales_nubox(
    empresa_codigo: str, user: CurrentUser, db: DBSession,
) -> TestLoginResponse:
    """Prueba que la clave Nubox abra sesión. NO baja data."""
    await _require_admin(user)
    rut_usuario, clave = await _get_credencial_nubox(db, empresa_codigo)

    run_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.nubox_sync_runs
                    (empresa_codigo, tipo, status, triggered_by)
                VALUES (:c, 'test_login', 'STARTED', CAST(:u AS UUID))
                RETURNING run_id
                """
            ),
            {"c": empresa_codigo, "u": str(user.sub)},
        )
    ).fetchone()
    await db.commit()
    run_id = run_row[0]

    result = await nubox_test_login(rut_usuario, clave)
    final_status = "OK" if result["ok"] else "FAILED"

    await db.execute(
        text(
            """
            UPDATE core.nubox_sync_runs
            SET status = :s, finished_at = NOW(), error_message = :err
            WHERE run_id = :id
            """
        ),
        {
            "s": final_status,
            "err": None if result["ok"] else result.get("message", "")[:500],
            "id": run_id,
        },
    )
    await db.execute(
        text(
            """
            UPDATE core.empresa_credenciales
            SET ultima_validacion_at = NOW(),
                ultima_validacion_ok = :ok,
                updated_at = NOW()
            WHERE empresa_codigo = :c AND sistema = 'nubox'
            """
        ),
        {"ok": result["ok"], "c": empresa_codigo},
    )
    await db.commit()

    return TestLoginResponse(
        empresa_codigo=empresa_codigo,
        ok=result["ok"],
        message=result["message"],
        error_type=result.get("error_type"),
    )


@router.post(
    "/sync-remuneraciones/{empresa_codigo}",
    response_model=SyncRemuneracionesResponse,
)
async def sync_remuneraciones(
    empresa_codigo: str,
    user: CurrentUser,
    db: DBSession,
    periodo: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
) -> SyncRemuneracionesResponse:
    """Best-effort: intenta auto-login + descarga del Libro de Remuneraciones.

    Si el portal Nubox no responde al patrón esperado, retorna 502 con
    sugerencia clara de usar /import-excel manual.
    """
    await _require_admin(user)
    rut_usuario, clave = await _get_credencial_nubox(db, empresa_codigo)

    started = datetime.utcnow()
    run_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.nubox_sync_runs
                    (empresa_codigo, tipo, periodo, status, triggered_by)
                VALUES (:c, 'remuneraciones', :p, 'STARTED', CAST(:u AS UUID))
                RETURNING run_id
                """
            ),
            {"c": empresa_codigo, "p": periodo, "u": str(user.sub)},
        )
    ).fetchone()
    await db.commit()
    run_id = run_row[0]

    error_msg: str | None = None
    inserted = 0
    updated = 0

    try:
        cli = await NuboxClient.login(rut_usuario, clave)
        try:
            xlsx_bytes = await cli.descargar_libro_remuneraciones(periodo)
        finally:
            await cli.close()

        items, parse_errors = parse_libro_remuneraciones(xlsx_bytes, periodo)
        if parse_errors:
            log.warning("nubox_parse_warnings", extra={"errors": parse_errors})

        inserted, updated = await _persistir_remuneraciones(
            db, empresa_codigo, items, run_id,
        )

    except NuboxAuthError as exc:
        error_msg = f"Auth: {exc}"
    except NuboxClientError as exc:
        error_msg = f"Client: {exc}"
    except Exception as exc:  # noqa: BLE001
        error_msg = f"Unexpected: {exc}"[:500]
        log.exception("nubox_sync_error", extra={"empresa": empresa_codigo})

    duracion = (datetime.utcnow() - started).total_seconds()
    final_status = "OK" if error_msg is None else "FAILED"

    await db.execute(
        text(
            """
            UPDATE core.nubox_sync_runs
            SET status = :s, finished_at = NOW(),
                documentos_count = :n, error_message = :err
            WHERE run_id = :id
            """
        ),
        {
            "s": final_status,
            "n": inserted + updated,
            "err": error_msg,
            "id": run_id,
        },
    )
    await db.commit()

    if error_msg:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=(
                f"Auto-sync Nubox falló: {error_msg}. "
                f"Usá el flujo manual: bajá el Libro de Remuneraciones desde "
                f"Nubox a mano y subilo via 'Subir Excel' en esta misma página."
            ),
        )

    return SyncRemuneracionesResponse(
        run_id=run_id, empresa_codigo=empresa_codigo, periodo=periodo,
        remuneraciones_count=inserted + updated,
        duracion_segundos=duracion, status=final_status, method="auto",
    )


@router.post(
    "/import-excel/{empresa_codigo}",
    response_model=ImportExcelResponse,
)
async def import_excel_remuneraciones(
    empresa_codigo: str,
    user: CurrentUser,
    db: DBSession,
    periodo: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
    file: Annotated[UploadFile, File(description="xlsx del Libro de Remuneraciones bajado de Nubox")],
) -> ImportExcelResponse:
    """Upload manual del Libro de Remuneraciones desde Nubox.

    Plan B robusto cuando auto-sync no funciona. El operador baja el
    Libro de Remuneraciones del mes desde el portal Nubox (web →
    Remuneraciones → Reportes → Libro de Remuneraciones → Descargar
    Excel) y lo sube acá.
    """
    await _require_admin(user)

    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo debe ser .xlsx o .xls",
        )

    content = await file.read()
    if len(content) > 20 * 1024 * 1024:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo demasiado grande (>20MB)",
        )

    run_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.nubox_sync_runs
                    (empresa_codigo, tipo, periodo, status, triggered_by, notas)
                VALUES (:c, 'import_excel', :p, 'STARTED', CAST(:u AS UUID), :n)
                RETURNING run_id
                """
            ),
            {
                "c": empresa_codigo, "p": periodo, "u": str(user.sub),
                "n": f"Import manual Excel ({file.filename})",
            },
        )
    ).fetchone()
    await db.commit()
    run_id = run_row[0]

    items, errors = parse_libro_remuneraciones(content, periodo)

    inserted, updated = 0, 0
    if items:
        inserted, updated = await _persistir_remuneraciones(
            db, empresa_codigo, items, run_id,
        )

    final_status = "OK" if items and not errors else "PARTIAL" if items else "FAILED"
    await db.execute(
        text(
            """
            UPDATE core.nubox_sync_runs
            SET status = :s, finished_at = NOW(),
                documentos_count = :n, error_message = :err
            WHERE run_id = :id
            """
        ),
        {
            "s": final_status,
            "n": inserted + updated,
            "err": "; ".join(errors)[:500] if errors else None,
            "id": run_id,
        },
    )
    await db.commit()

    return ImportExcelResponse(
        inserted=inserted, updated=updated, errors=errors[:20], run_id=run_id,
    )


@router.get(
    "/remuneraciones/{empresa_codigo}",
    response_model=list[RemuneracionRead],
)
async def list_remuneraciones(
    empresa_codigo: str,
    user: CurrentUser, db: DBSession,
    periodo: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[RemuneracionRead]:
    await _require_admin(user)
    wheres = ["empresa_codigo = :c"]
    params: dict = {"c": empresa_codigo, "l": limit}
    if periodo:
        wheres.append("periodo = :p")
        params["p"] = periodo
    sql = f"""
        SELECT remuneracion_id, periodo, trabajador_rut, trabajador_nombre,
               sueldo_base, total_haberes, afp_descuento, salud_descuento,
               total_descuentos, sueldo_liquido, voucher_id
        FROM core.nubox_remuneraciones
        WHERE {' AND '.join(wheres)}
        ORDER BY periodo DESC, trabajador_nombre ASC
        LIMIT :l
    """
    rows = (await db.execute(text(sql), params)).fetchall()
    return [
        RemuneracionRead(
            remuneracion_id=r[0], periodo=r[1], trabajador_rut=r[2],
            trabajador_nombre=r[3],
            sueldo_base=int(r[4] or 0),
            total_haberes=int(r[5] or 0),
            afp_descuento=int(r[6] or 0),
            salud_descuento=int(r[7] or 0),
            total_descuentos=int(r[8] or 0),
            sueldo_liquido=int(r[9] or 0),
            voucher_id=r[10],
        )
        for r in rows
    ]


@router.get(
    "/resumen/{empresa_codigo}",
    response_model=ResumenRemuneraciones,
)
async def resumen_remuneraciones(
    empresa_codigo: str,
    user: CurrentUser, db: DBSession,
    periodo: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
) -> ResumenRemuneraciones:
    """Resumen mensual: total a pagar en sueldos + aportes patronales.

    Es lo que el operador necesita para preparar el voucher mensual de
    sueldos sin abrir cada liquidación individual.
    """
    await _require_admin(user)
    row = (
        await db.execute(
            text(
                """
                SELECT
                    COUNT(*) AS trabajadores,
                    COALESCE(SUM(total_haberes), 0),
                    COALESCE(SUM(total_descuentos), 0),
                    COALESCE(SUM(sueldo_liquido), 0),
                    COALESCE(SUM(afp_descuento), 0),
                    COALESCE(SUM(salud_descuento), 0),
                    COALESCE(SUM(impuesto_unico), 0),
                    COALESCE(SUM(sis_patronal + afc_patronal + mutual_patronal), 0)
                FROM core.nubox_remuneraciones
                WHERE empresa_codigo = :c AND periodo = :p
                """
            ),
            {"c": empresa_codigo, "p": periodo},
        )
    ).fetchone()

    return ResumenRemuneraciones(
        empresa_codigo=empresa_codigo,
        periodo=periodo,
        trabajadores_count=int(row[0] or 0),
        total_haberes=int(row[1] or 0),
        total_descuentos=int(row[2] or 0),
        total_liquido=int(row[3] or 0),
        total_afp=int(row[4] or 0),
        total_salud=int(row[5] or 0),
        total_impuesto=int(row[6] or 0),
        total_aportes_patronales=int(row[7] or 0),
    )
