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

import json
import logging
from datetime import date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
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
from app.services.sii_conciliacion import conciliar_empresa
from app.services.sii_csv_import import parse_csv_rcv

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


class ImportCsvResponse(BaseModel):
    inserted: int
    updated: int
    errors: list[str]
    run_id: int


class ConciliarResponse(BaseModel):
    empresa_codigo: str
    periodo: str | None
    total_processed: int
    matched_exact: int
    matched_fuzzy: int
    unmatched: int


class TipoDteBreakdown(BaseModel):
    tipo_dte: int
    nombre: str
    count: int
    monto_neto: int
    monto_iva: int
    monto_total: int


class F29PreviewResponse(BaseModel):
    """Round 119 — F29 estimado a partir del RCV del SII."""
    empresa_codigo: str
    periodo: str
    # Sumas globales
    ventas_count: int
    compras_count: int
    iva_debito_fiscal: int  # IVA cobrado en ventas (sum monto_iva ventas)
    iva_credito_fiscal: int  # IVA pagado en compras (sum monto_iva compras)
    ventas_total: int
    compras_total: int
    ventas_neto: int
    compras_neto: int
    # F29 estimado: si débito > crédito → a pagar; sino → saldo a favor
    f29_estimado_a_pagar: int  # positive = a pagar; negative = saldo a favor
    # Conciliación con vouchers
    docs_conciliados: int
    docs_sin_voucher: int
    # Breakdown por tipo de doc tributario
    ventas_por_tipo: list[TipoDteBreakdown]
    compras_por_tipo: list[TipoDteBreakdown]


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
                        "raw": json.dumps(d.raw, default=str),
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


# =====================================================================
# Round 118 — Import CSV manual (fallback robusto)
# =====================================================================


@router.post(
    "/import-csv/{empresa_codigo}",
    response_model=ImportCsvResponse,
)
async def import_csv_rcv(
    empresa_codigo: str,
    user: CurrentUser,
    db: DBSession,
    flujo: Annotated[str, Query(pattern=r"^(compra|venta)$")],
    periodo_default: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
    file: Annotated[UploadFile, File(description="CSV bajado del portal SII")],
) -> ImportCsvResponse:
    """Import manual de RCV desde CSV bajado del portal sii.cl.

    El operador baja el CSV de sii.cl (RCV → Descargar) y lo sube via
    multipart/form-data. Útil cuando la auto-sync (httpx) falla por
    cambios del portal.

    El parser tolera reordering de columnas, encodings cp1252/latin1/utf-8,
    delimitador `;` o `,`, y filas vacías intercaladas.
    """
    await _require_admin(user)

    if not file.filename or not file.filename.lower().endswith(
        (".csv", ".tsv", ".txt"),
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo debe ser .csv, .tsv o .txt",
        )

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:  # 10 MB cap
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Archivo demasiado grande (>10MB). El SII raramente devuelve eso.",
        )

    docs, errors = parse_csv_rcv(
        content, flujo=flujo, periodo_default=periodo_default,
    )

    # Crear run de tipo rcv_compras o rcv_ventas
    run_tipo = "rcv_compras" if flujo == "compra" else "rcv_ventas"
    run_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.sii_sync_runs
                    (empresa_codigo, tipo, periodo, status, triggered_by, notas)
                VALUES (:c, :t, :p, 'STARTED', CAST(:u AS UUID), :n)
                RETURNING run_id
                """
            ),
            {
                "c": empresa_codigo, "t": run_tipo, "p": periodo_default,
                "u": str(user.sub),
                "n": f"Import CSV manual ({file.filename})",
            },
        )
    ).fetchone()
    await db.commit()
    run_id = run_row[0]

    inserted = 0
    updated = 0
    for d in docs:
        result = await db.execute(
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
                  updated_at = NOW()
                RETURNING (xmax = 0) AS inserted
                """
            ),
            {
                "c": empresa_codigo, "flujo": d["flujo"],
                "tipo": d["tipo_dte"], "folio": d["folio"], "p": d["periodo"],
                "rut": d["rut_contraparte"], "rsoc": d["razon_social_contraparte"],
                "fem": d["fecha_emision"], "frec": d["fecha_recepcion"],
                "mexe": d["monto_exento"], "mneto": d["monto_neto"],
                "miva": d["monto_iva"], "mtot": d["monto_total"],
                "est": d["estado_sii"], "rid": run_id,
                "raw": json.dumps(d, default=str),
            },
        )
        row = result.fetchone()
        if row and row[0]:
            inserted += 1
        else:
            updated += 1

    await db.execute(
        text(
            """
            UPDATE core.sii_sync_runs
            SET status = :s, finished_at = NOW(),
                documentos_count = :n,
                error_message = :err
            WHERE run_id = :id
            """
        ),
        {
            "s": "OK" if not errors else "PARTIAL",
            "n": inserted + updated,
            "err": "; ".join(errors)[:500] if errors else None,
            "id": run_id,
        },
    )
    await db.commit()

    return ImportCsvResponse(
        inserted=inserted, updated=updated,
        errors=errors[:20],  # cap, no devolvemos 1000s de errores
        run_id=run_id,
    )


# =====================================================================
# Round 118 — Conciliar sii_documentos con vouchers
# =====================================================================


@router.post(
    "/conciliar/{empresa_codigo}",
    response_model=ConciliarResponse,
)
async def conciliar(
    empresa_codigo: str,
    user: CurrentUser,
    db: DBSession,
    periodo: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
) -> ConciliarResponse:
    """Matchea docs SII no conciliados contra vouchers locales.

    Match exact (score=1.0): mismo tipo + folio + RUT contraparte + monto±1.
    Match fuzzy (score=0.7): mismo tipo + folio, RUT/monto difieren <=5%.
    No-match: queda voucher_id=NULL para que el operador revise.
    """
    await _require_admin(user)
    result = await conciliar_empresa(db, empresa_codigo, periodo=periodo)
    return ConciliarResponse(
        empresa_codigo=empresa_codigo,
        periodo=periodo,
        total_processed=result.total_processed,
        matched_exact=result.matched_exact,
        matched_fuzzy=result.matched_fuzzy,
        unmatched=result.unmatched,
    )


# =====================================================================
# Round 119 — F29 estimado a partir del RCV bajado del SII
# =====================================================================

# Nombres legibles de los DTE más comunes (espejo del frontend DTE_NAMES)
_DTE_NAMES_BACKEND: dict[int, str] = {
    33: "Factura",
    34: "Factura exenta",
    39: "Boleta",
    41: "Boleta exenta",
    43: "Liquidación factura",
    46: "Factura compra",
    52: "Guía despacho",
    56: "Nota débito",
    61: "Nota crédito",
    110: "Factura exportación",
    111: "Nota débito exportación",
    112: "Nota crédito exportación",
}


@router.get(
    "/f29-preview/{empresa_codigo}",
    response_model=F29PreviewResponse,
)
async def f29_preview(
    empresa_codigo: str,
    user: CurrentUser,
    db: DBSession,
    periodo: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
) -> F29PreviewResponse:
    """Estima el F29 a pagar para un período a partir del RCV bajado.

    F29 simplificado:
        IVA a pagar = SUM(IVA débito ventas) - SUM(IVA crédito compras)
        Las notas de crédito (tipo 61) en ventas SE RESTAN del débito.
        Las notas de crédito recibidas (tipo 61) en compras SE RESTAN del crédito.

    Esta vista NO reemplaza el F29 oficial — es un preview que el
    operador usa para preparar la declaración o detectar gaps.
    """
    await _require_admin(user)

    # 1. Sumas globales por flujo, ajustando notas de crédito como negativas
    sums = (
        await db.execute(
            text(
                """
                SELECT
                    flujo,
                    -- Las notas de crédito (tipo 61) reducen el monto
                    SUM(CASE WHEN tipo_dte = 61 THEN -monto_iva ELSE monto_iva END) AS iva_sum,
                    SUM(CASE WHEN tipo_dte = 61 THEN -monto_total ELSE monto_total END) AS total_sum,
                    SUM(CASE WHEN tipo_dte = 61 THEN -monto_neto ELSE monto_neto END) AS neto_sum,
                    COUNT(*) AS cnt
                FROM core.sii_documentos
                WHERE empresa_codigo = :e AND periodo = :p
                GROUP BY flujo
                """
            ),
            {"e": empresa_codigo, "p": periodo},
        )
    ).fetchall()

    iva_debito = 0  # ventas
    iva_credito = 0  # compras
    ventas_count = 0
    compras_count = 0
    ventas_total = 0
    compras_total = 0
    ventas_neto = 0
    compras_neto = 0
    for s in sums:
        if s[0] == "venta":
            iva_debito = int(s[1] or 0)
            ventas_total = int(s[2] or 0)
            ventas_neto = int(s[3] or 0)
            ventas_count = int(s[4] or 0)
        elif s[0] == "compra":
            iva_credito = int(s[1] or 0)
            compras_total = int(s[2] or 0)
            compras_neto = int(s[3] or 0)
            compras_count = int(s[4] or 0)

    # 2. Conciliación stats
    concil = (
        await db.execute(
            text(
                """
                SELECT
                    COUNT(*) FILTER (WHERE voucher_id IS NOT NULL) AS conciled,
                    COUNT(*) FILTER (WHERE voucher_id IS NULL) AS uncocniled
                FROM core.sii_documentos
                WHERE empresa_codigo = :e AND periodo = :p
                """
            ),
            {"e": empresa_codigo, "p": periodo},
        )
    ).fetchone()
    docs_conciliados = int(concil[0] or 0)
    docs_sin_voucher = int(concil[1] or 0)

    # 3. Breakdown por tipo DTE (separado venta vs compra)
    breakdown_rows = (
        await db.execute(
            text(
                """
                SELECT flujo, tipo_dte,
                       COUNT(*) AS cnt,
                       SUM(monto_neto) AS neto,
                       SUM(monto_iva) AS iva,
                       SUM(monto_total) AS total
                FROM core.sii_documentos
                WHERE empresa_codigo = :e AND periodo = :p
                GROUP BY flujo, tipo_dte
                ORDER BY flujo, tipo_dte
                """
            ),
            {"e": empresa_codigo, "p": periodo},
        )
    ).fetchall()

    ventas_por_tipo: list[TipoDteBreakdown] = []
    compras_por_tipo: list[TipoDteBreakdown] = []
    for r in breakdown_rows:
        item = TipoDteBreakdown(
            tipo_dte=int(r[1]),
            nombre=_DTE_NAMES_BACKEND.get(int(r[1]), f"DTE {r[1]}"),
            count=int(r[2] or 0),
            monto_neto=int(r[3] or 0),
            monto_iva=int(r[4] or 0),
            monto_total=int(r[5] or 0),
        )
        if r[0] == "venta":
            ventas_por_tipo.append(item)
        else:
            compras_por_tipo.append(item)

    return F29PreviewResponse(
        empresa_codigo=empresa_codigo,
        periodo=periodo,
        ventas_count=ventas_count,
        compras_count=compras_count,
        iva_debito_fiscal=iva_debito,
        iva_credito_fiscal=iva_credito,
        ventas_total=ventas_total,
        compras_total=compras_total,
        ventas_neto=ventas_neto,
        compras_neto=compras_neto,
        f29_estimado_a_pagar=iva_debito - iva_credito,
        docs_conciliados=docs_conciliados,
        docs_sin_voucher=docs_sin_voucher,
        ventas_por_tipo=ventas_por_tipo,
        compras_por_tipo=compras_por_tipo,
    )
