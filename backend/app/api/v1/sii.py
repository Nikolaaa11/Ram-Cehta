"""Round 117 — Endpoints de integración con el SII.

  GET   /admin/sii/empresas
        Lista empresas que tienen credencial SII configurada + último sync.

  POST  /admin/sii/test-login/{empresa_codigo}
        Decifra la clave y prueba el login. NO descarga nada. Útil para
        validar credenciales sin tocar data productiva del SII.

  POST  /admin/sii/sync-rcv/{empresa_codigo}?periodo=YYYY-MM
        Sincroniza el RCV (compras + ventas) del período. Si periodo
        omite, usa el mes actual.

  GET   /admin/sii/runs/{empresa_codigo}
        Historial de runs de esa empresa.

  GET   /admin/sii/documentos/{empresa_codigo}?periodo=YYYY-MM&flujo=compra
        Lista los documentos descargados, filtrable por período y flujo.

Seguridad:
  - Todos requieren scope admin (estos endpoints manejan credenciales
    sensibles + tocan portal externo)
  - La clave SII solo se descifra en memoria al momento de uso, nunca
    se devuelve al cliente
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession, require_scope
from app.core.security import AuthenticatedUser
from app.services.credentials_service import (
    CredentialDecryptError,
    decrypt_credential,
)
from app.services.sii_client import (
    SiiAuthError,
    SiiClient,
    SiiClientError,
    test_login as sii_test_login,
)

log = logging.getLogger(__name__)
router = APIRouter()


# =====================================================================
# Schemas
# =====================================================================


class EmpresaSiiStatus(BaseModel):
    empresa_codigo: str
    razon_social: str | None
    rut: str | None
    tiene_credencial_sii: bool
    ultima_validacion_at: datetime | None
    ultima_validacion_ok: bool | None
    ultimo_sync_at: datetime | None
    ultimo_sync_status: str | None
    documentos_count: int


class TestLoginResponse(BaseModel):
    empresa_codigo: str
    ok: bool
    message: str
    error_type: str | None = None


class SyncRcvResponse(BaseModel):
    run_id: int
    empresa_codigo: str
    periodo: str
    compras_count: int
    ventas_count: int
    duracion_segundos: float
    status: str


class SiiDocumentoRead(BaseModel):
    sii_doc_id: int
    flujo: str
    tipo_dte: int
    folio: str
    periodo: str
    rut_contraparte: str
    razon_social_contraparte: str | None
    fecha_emision: date | None
    monto_neto: int
    monto_iva: int
    monto_total: int
    estado_sii: str | None
    voucher_id: int | None


class SiiRunRead(BaseModel):
    run_id: int
    tipo: str
    periodo: str | None
    status: str
    started_at: datetime
    finished_at: datetime | None
    documentos_count: int
    error_message: str | None


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


async def _get_credencial_sii(
    db: Any, empresa_codigo: str
) -> tuple[str, str]:
    """Devuelve (rut_usuario, clave_plaintext). Raise 404 si no hay credencial."""
    row = (
        await db.execute(
            text(
                """
                SELECT rut_usuario, password_encrypted
                FROM core.empresa_credenciales
                WHERE empresa_codigo = :c AND sistema = 'sii'
                """
            ),
            {"c": empresa_codigo},
        )
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No hay credencial SII configurada para {empresa_codigo}. "
                f"Cargala via el seed Round 116."
            ),
        )
    try:
        plain = decrypt_credential(row[1])
    except CredentialDecryptError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"No se pudo descifrar la credencial: {exc}",
        ) from exc
    return row[0], plain


def _periodo_actual() -> str:
    now = datetime.utcnow()
    return f"{now.year:04d}-{now.month:02d}"


# =====================================================================
# Endpoints
# =====================================================================


@router.get("/empresas", response_model=list[EmpresaSiiStatus])
async def list_empresas_sii(
    user: CurrentUser, db: DBSession
) -> list[EmpresaSiiStatus]:
    """Lista todas las empresas con credenciales SII + estado del último sync."""
    await _require_admin(user)
    rows = (
        await db.execute(
            text(
                """
                SELECT
                    e.codigo,
                    e.razon_social,
                    e.rut,
                    (cred.credencial_id IS NOT NULL) AS tiene_cred,
                    cred.ultima_validacion_at,
                    cred.ultima_validacion_ok,
                    last_run.finished_at AS ultimo_sync_at,
                    last_run.status AS ultimo_sync_status,
                    COALESCE(d.cnt, 0) AS documentos_count
                FROM core.empresas e
                LEFT JOIN core.empresa_credenciales cred
                    ON cred.empresa_codigo = e.codigo AND cred.sistema = 'sii'
                LEFT JOIN LATERAL (
                    SELECT finished_at, status
                    FROM core.sii_sync_runs r
                    WHERE r.empresa_codigo = e.codigo
                    ORDER BY started_at DESC LIMIT 1
                ) last_run ON TRUE
                LEFT JOIN (
                    SELECT empresa_codigo, COUNT(*) AS cnt
                    FROM core.sii_documentos
                    GROUP BY empresa_codigo
                ) d ON d.empresa_codigo = e.codigo
                WHERE e.activo = TRUE
                ORDER BY e.codigo
                """
            )
        )
    ).fetchall()

    return [
        EmpresaSiiStatus(
            empresa_codigo=r[0],
            razon_social=r[1],
            rut=r[2],
            tiene_credencial_sii=bool(r[3]),
            ultima_validacion_at=r[4],
            ultima_validacion_ok=r[5],
            ultimo_sync_at=r[6],
            ultimo_sync_status=r[7],
            documentos_count=int(r[8] or 0),
        )
        for r in rows
    ]


@router.post(
    "/test-login/{empresa_codigo}",
    response_model=TestLoginResponse,
)
async def test_credenciales_sii(
    empresa_codigo: str,
    user: CurrentUser,
    db: DBSession,
) -> TestLoginResponse:
    """Prueba que la clave SII abra sesión OK. NO baja data."""
    await _require_admin(user)
    rut_usuario, clave = await _get_credencial_sii(db, empresa_codigo)

    # Registrar el intento como un run de tipo 'test_login'
    run_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.sii_sync_runs
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

    result = await sii_test_login(rut_usuario, clave)

    # Update run + credencial con el resultado
    final_status = "OK" if result["ok"] else "FAILED"
    await db.execute(
        text(
            """
            UPDATE core.sii_sync_runs
            SET status = :s, finished_at = NOW(),
                error_message = :err
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
            WHERE empresa_codigo = :c AND sistema = 'sii'
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
    "/sync-rcv/{empresa_codigo}",
    response_model=SyncRcvResponse,
)
async def sync_rcv(
    empresa_codigo: str,
    user: CurrentUser,
    db: DBSession,
    periodo: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
) -> SyncRcvResponse:
    """Descarga RCV compras + ventas del período. Insert/Update en sii_documentos."""
    await _require_admin(user)
    p = periodo or _periodo_actual()

    rut_usuario, clave = await _get_credencial_sii(db, empresa_codigo)

    started = datetime.utcnow()

    run_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.sii_sync_runs
                    (empresa_codigo, tipo, periodo, status, triggered_by)
                VALUES (:c, 'rcv_compras', :p, 'STARTED', CAST(:u AS UUID))
                RETURNING run_id
                """
            ),
            {"c": empresa_codigo, "p": p, "u": str(user.sub)},
        )
    ).fetchone()
    await db.commit()
    run_id = run_row[0]

    compras_count = 0
    ventas_count = 0
    error_msg: str | None = None

    try:
        cli = await SiiClient.login(rut_usuario, clave)
        try:
            compras = await cli.descargar_rcv_compras(p)
            ventas = await cli.descargar_rcv_ventas(p)
        finally:
            await cli.close()

        # Upsert documentos
        for doc_list in (compras, ventas):
            for d in doc_list:
                await db.execute(
                    text(
                        """
                        INSERT INTO core.sii_documentos
                          (empresa_codigo, flujo, tipo_dte, folio, periodo,
                           rut_contraparte, razon_social_contraparte,
                           fecha_emision, fecha_recepcion,
                           monto_exento, monto_neto, monto_iva, monto_total,
                           estado_sii, run_id, raw_data)
                        VALUES
                          (:c, :flujo, :tipo, :folio, :p,
                           :rut, :rsoc, :fem, :frec,
                           :mexe, :mneto, :miva, :mtot,
                           :est, :rid, CAST(:raw AS jsonb))
                        ON CONFLICT (empresa_codigo, flujo, tipo_dte, folio, rut_contraparte)
                        DO UPDATE SET
                          razon_social_contraparte = COALESCE(EXCLUDED.razon_social_contraparte,
                                                               core.sii_documentos.razon_social_contraparte),
                          fecha_emision = COALESCE(EXCLUDED.fecha_emision, core.sii_documentos.fecha_emision),
                          monto_exento = EXCLUDED.monto_exento,
                          monto_neto = EXCLUDED.monto_neto,
                          monto_iva = EXCLUDED.monto_iva,
                          monto_total = EXCLUDED.monto_total,
                          estado_sii = EXCLUDED.estado_sii,
                          run_id = EXCLUDED.run_id,
                          raw_data = EXCLUDED.raw_data,
                          updated_at = NOW()
                        """
                    ),
                    {
                        "c": empresa_codigo, "flujo": d.flujo,
                        "tipo": d.tipo_dte, "folio": d.folio, "p": d.periodo,
                        "rut": d.rut_contraparte, "rsoc": d.razon_social_contraparte,
                        "fem": d.fecha_emision, "frec": d.fecha_recepcion,
                        "mexe": d.monto_exento, "mneto": d.monto_neto,
                        "miva": d.monto_iva, "mtot": d.monto_total,
                        "est": d.estado_sii, "rid": run_id,
                        "raw": __import__("json").dumps(d.raw, default=str),
                    },
                )

        compras_count = len(compras)
        ventas_count = len(ventas)

    except SiiAuthError as exc:
        error_msg = f"Auth: {exc}"
    except SiiClientError as exc:
        error_msg = f"Client: {exc}"
    except Exception as exc:  # noqa: BLE001 — defensive
        error_msg = f"Unexpected: {exc}"[:500]
        log.exception("sii_sync_unexpected_error",
                      extra={"empresa": empresa_codigo, "run_id": run_id})

    duracion = (datetime.utcnow() - started).total_seconds()
    final_status = "OK" if error_msg is None else "FAILED"

    await db.execute(
        text(
            """
            UPDATE core.sii_sync_runs
            SET status = :s, finished_at = NOW(),
                documentos_count = :n, error_message = :err
            WHERE run_id = :id
            """
        ),
        {
            "s": final_status,
            "n": compras_count + ventas_count,
            "err": error_msg,
            "id": run_id,
        },
    )
    await db.commit()

    if error_msg:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Sync falló: {error_msg}",
        )

    return SyncRcvResponse(
        run_id=run_id,
        empresa_codigo=empresa_codigo,
        periodo=p,
        compras_count=compras_count,
        ventas_count=ventas_count,
        duracion_segundos=duracion,
        status=final_status,
    )


@router.get("/runs/{empresa_codigo}", response_model=list[SiiRunRead])
async def list_runs(
    empresa_codigo: str,
    user: CurrentUser,
    db: DBSession,
    limit: Annotated[int, Query(ge=1, le=100)] = 20,
) -> list[SiiRunRead]:
    """Historial de runs SII de esta empresa."""
    await _require_admin(user)
    rows = (
        await db.execute(
            text(
                """
                SELECT run_id, tipo, periodo, status, started_at,
                       finished_at, documentos_count, error_message
                FROM core.sii_sync_runs
                WHERE empresa_codigo = :c
                ORDER BY started_at DESC
                LIMIT :l
                """
            ),
            {"c": empresa_codigo, "l": limit},
        )
    ).fetchall()
    return [
        SiiRunRead(
            run_id=r[0], tipo=r[1], periodo=r[2], status=r[3],
            started_at=r[4], finished_at=r[5],
            documentos_count=int(r[6] or 0),
            error_message=r[7],
        )
        for r in rows
    ]


@router.get("/documentos/{empresa_codigo}", response_model=list[SiiDocumentoRead])
async def list_documentos(
    empresa_codigo: str,
    user: CurrentUser,
    db: DBSession,
    periodo: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
    flujo: Annotated[str | None, Query(pattern=r"^(compra|venta)$")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[SiiDocumentoRead]:
    """Lista documentos SII de esta empresa con filtros opcionales."""
    await _require_admin(user)
    wheres = ["empresa_codigo = :c"]
    params: dict = {"c": empresa_codigo, "l": limit}
    if periodo:
        wheres.append("periodo = :p")
        params["p"] = periodo
    if flujo:
        wheres.append("flujo = :f")
        params["f"] = flujo
    sql = (
        f"""
        SELECT sii_doc_id, flujo, tipo_dte, folio, periodo,
               rut_contraparte, razon_social_contraparte,
               fecha_emision, monto_neto, monto_iva, monto_total,
               estado_sii, voucher_id
        FROM core.sii_documentos
        WHERE {' AND '.join(wheres)}
        ORDER BY fecha_emision DESC NULLS LAST, sii_doc_id DESC
        LIMIT :l
        """
    )
    rows = (await db.execute(text(sql), params)).fetchall()
    return [
        SiiDocumentoRead(
            sii_doc_id=r[0], flujo=r[1], tipo_dte=r[2], folio=r[3],
            periodo=r[4], rut_contraparte=r[5],
            razon_social_contraparte=r[6], fecha_emision=r[7],
            monto_neto=int(r[8] or 0), monto_iva=int(r[9] or 0),
            monto_total=int(r[10] or 0),
            estado_sii=r[11], voucher_id=r[12],
        )
        for r in rows
    ]
