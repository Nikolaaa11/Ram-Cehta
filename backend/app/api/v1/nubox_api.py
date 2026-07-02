"""Round 124 — Endpoints API REST oficial de Nubox (Factura y Administración).

  GET   /admin/nubox-api/empresas
        Lista empresas con credencial API Nubox + último sync.

  POST  /admin/nubox-api/credentials/{empresa}
        Setea o actualiza partner_token + api_key + environment.

  POST  /admin/nubox-api/test/{empresa}
        Valida que las credenciales abran sesión OK.

  POST  /admin/nubox-api/emit-from-voucher/{voucher_id}
        Emite un DTE oficial vía Nubox desde un voucher local.
        El voucher debe ser tipo VENTA/COMPRA con doc_tributario_tipo válido.

  POST  /admin/nubox-api/sync-sales/{empresa}?periodo=YYYY-MM
        Baja todas las ventas emitidas en el período (espejo Nubox del RCV SII).

  GET   /admin/nubox-api/sales/{empresa}?periodo=YYYY-MM
        Lista las ventas Nubox almacenadas en core.nubox_ventas.

  GET   /admin/nubox-api/sales/{empresa}/{nubox_document_id}/pdf
        Proxy al PDF firmado de Nubox.

  GET   /admin/nubox-api/sales/{empresa}/{nubox_document_id}/xml
        Proxy al XML con validez SII.
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import date, datetime
from typing import Annotated, Any

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.api.deps import CurrentUser, DBSession
from app.core.security import AuthenticatedUser
from app.services.credentials_service import (
    CredentialDecryptError,
    CredentialsKeyMissing,
    decrypt_credential,
    encrypt_credential,
)
from app.services.nubox_api_client import (
    DEFAULT_PROD_URL,
    DEFAULT_UAT_URL,
    NuboxApiAuthError,
    NuboxApiClient,
    NuboxApiError,
    NuboxApiValidationError,
    test_connection,
)
from app.services.nubox_api_mapper import (
    NuboxMapperError,
    parse_nubox_emit_response,
    voucher_to_nubox_payload,
)

log = logging.getLogger(__name__)
router = APIRouter()


# =====================================================================
# Schemas
# =====================================================================


class EmpresaNuboxApiStatus(BaseModel):
    empresa_codigo: str
    razon_social: str | None
    rut: str | None
    tiene_credencial_api: bool
    environment: str | None
    ultima_validacion_at: datetime | None
    ultima_validacion_ok: bool | None
    ultima_validacion_msg: str | None
    ventas_count: int


class SetCredencialesRequest(BaseModel):
    partner_token: str = Field(min_length=10, description="Bearer token del partner")
    api_key: str = Field(min_length=10, description="X-Api-Key de la empresa")
    environment: str = Field(default="uat", pattern=r"^(uat|prod)$")
    base_url: str | None = Field(
        default=None,
        description="URL base (opcional, default según environment)",
    )


class TestResponse(BaseModel):
    empresa_codigo: str
    ok: bool
    message: str
    error_type: str | None = None


class EmitFromVoucherResponse(BaseModel):
    voucher_id: int
    nubox_document_id: int | None
    folio: str | None
    estado: str
    idempotence_id: str
    errors: list[dict] = []
    message: str


class SyncSalesResponse(BaseModel):
    empresa_codigo: str
    periodo: str
    sales_count: int
    duracion_segundos: float


class VentaNuboxRead(BaseModel):
    venta_id: int
    nubox_document_id: int
    folio: str | None
    tipo_dte: int
    periodo: str
    fecha_emision: datetime | None
    cliente_rut: str
    cliente_razon_social: str | None
    monto_neto: int
    monto_iva: int
    monto_total: int
    estado_emision_id: int | None
    estado_emision_name: str | None
    sii_track_id: int | None
    voucher_id: int | None


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


def _resolve_base_url(environment: str, override: str | None) -> str:
    if override:
        return override.rstrip("/")
    return (DEFAULT_PROD_URL if environment == "prod" else DEFAULT_UAT_URL).rstrip("/")


async def _get_active_credentials(
    db: Any, empresa_codigo: str,
) -> tuple[str, str, str, str]:
    """Devuelve (partner_token, api_key, base_url, environment).

    Si hay múltiples (uat+prod), prioriza prod. 404 si no hay.
    """
    row = (
        await db.execute(
            text(
                """
                SELECT partner_token_encrypted, company_api_key_encrypted,
                       base_url, environment
                FROM core.nubox_api_credenciales
                WHERE empresa_codigo = :c
                ORDER BY (environment = 'prod') DESC, updated_at DESC
                LIMIT 1
                """
            ),
            {"c": empresa_codigo},
        )
    ).fetchone()
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No hay credenciales API Nubox para {empresa_codigo}. "
                f"Cargalas via POST /admin/nubox-api/credentials/{empresa_codigo}"
            ),
        )
    try:
        partner_token = decrypt_credential(row[0])
        api_key = decrypt_credential(row[1])
    except (CredentialDecryptError, CredentialsKeyMissing) as exc:
        # R152HHHHHH — mensaje genérico al frontend; detalle solo al log.
        log.error(
            "nubox_api.credential_decrypt_failed",
            extra={"empresa": empresa_codigo, "err": str(exc)[:200]},
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=(
                "No se pudieron descifrar las credenciales Nubox. Verificá "
                "CREDENTIALS_FERNET_KEY en el servidor."
            ),
        ) from exc
    return partner_token, api_key, row[2], row[3]


# =====================================================================
# Endpoints
# =====================================================================


@router.get("/empresas", response_model=list[EmpresaNuboxApiStatus])
async def list_empresas_nubox_api(
    user: CurrentUser, db: DBSession
) -> list[EmpresaNuboxApiStatus]:
    """Lista empresas con status de credencial API Nubox."""
    await _require_admin(user)

    # Defensive: si tablas no existen, devolver lista vacía con flag
    tables_exist = (
        await db.execute(
            text(
                """
                SELECT EXISTS (SELECT 1 FROM information_schema.tables
                               WHERE table_schema = 'core' AND table_name = 'nubox_api_credenciales')
                """
            )
        )
    ).fetchone()[0]
    if not tables_exist:
        rows = (
            await db.execute(
                text(
                    """
                    SELECT codigo, razon_social, rut FROM core.empresas
                    WHERE activo = TRUE ORDER BY codigo
                    """
                )
            )
        ).fetchall()
        return [
            EmpresaNuboxApiStatus(
                empresa_codigo=r[0], razon_social=r[1], rut=r[2],
                tiene_credencial_api=False, environment=None,
                ultima_validacion_at=None, ultima_validacion_ok=None,
                ultima_validacion_msg=None, ventas_count=0,
            )
            for r in rows
        ]

    rows = (
        await db.execute(
            text(
                """
                SELECT
                    e.codigo, e.razon_social, e.rut,
                    cred.credencial_id, cred.environment,
                    cred.ultima_validacion_at, cred.ultima_validacion_ok,
                    cred.ultima_validacion_msg,
                    COALESCE(v.cnt, 0) AS ventas_count
                FROM core.empresas e
                LEFT JOIN LATERAL (
                    SELECT credencial_id, environment, ultima_validacion_at,
                           ultima_validacion_ok, ultima_validacion_msg
                    FROM core.nubox_api_credenciales nac
                    WHERE nac.empresa_codigo = e.codigo
                    ORDER BY (environment = 'prod') DESC, updated_at DESC
                    LIMIT 1
                ) cred ON TRUE
                LEFT JOIN (
                    SELECT empresa_codigo, COUNT(*) AS cnt
                    FROM core.nubox_ventas GROUP BY empresa_codigo
                ) v ON v.empresa_codigo = e.codigo
                WHERE e.activo = TRUE
                ORDER BY e.codigo
                """
            )
        )
    ).fetchall()

    return [
        EmpresaNuboxApiStatus(
            empresa_codigo=r[0], razon_social=r[1], rut=r[2],
            tiene_credencial_api=r[3] is not None,
            environment=r[4],
            ultima_validacion_at=r[5],
            ultima_validacion_ok=r[6],
            ultima_validacion_msg=r[7],
            ventas_count=int(r[8] or 0),
        )
        for r in rows
    ]


@router.post(
    "/credentials/{empresa_codigo}",
    response_model=EmpresaNuboxApiStatus,
)
async def set_credentials(
    empresa_codigo: str,
    body: SetCredencialesRequest,
    user: CurrentUser, db: DBSession,
) -> EmpresaNuboxApiStatus:
    """Setea o actualiza las credenciales API Nubox de una empresa.

    Cifra partner_token + api_key con Fernet y guarda en
    core.nubox_api_credenciales (UPSERT por empresa+environment).
    """
    await _require_admin(user)

    # Validar que la empresa existe
    exists = (
        await db.execute(
            text("SELECT 1 FROM core.empresas WHERE codigo = :c"),
            {"c": empresa_codigo},
        )
    ).fetchone()
    if not exists:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Empresa {empresa_codigo} no existe",
        )

    base_url = _resolve_base_url(body.environment, body.base_url)
    # R152UUUUUU — encrypt_credential lanza CredentialsKeyMissing si la
    # CREDENTIALS_FERNET_KEY no está seteada (el estado actual de prod
    # hasta que se corra `fly secrets set`): antes 500 crudo al intentar
    # guardar credenciales, ahora 503 con instrucción clara.
    try:
        partner_enc = encrypt_credential(body.partner_token)
        api_key_enc = encrypt_credential(body.api_key)
    except CredentialsKeyMissing as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "El cifrado de credenciales no está configurado "
                "(CREDENTIALS_FERNET_KEY ausente en el backend). "
                "Configurala y reintentá."
            ),
        ) from exc

    await db.execute(
        text(
            """
            INSERT INTO core.nubox_api_credenciales
                (empresa_codigo, partner_token_encrypted, company_api_key_encrypted,
                 environment, base_url)
            VALUES (:c, :pt, :ak, :env, :url)
            ON CONFLICT (empresa_codigo, environment)
            DO UPDATE SET
                partner_token_encrypted = EXCLUDED.partner_token_encrypted,
                company_api_key_encrypted = EXCLUDED.company_api_key_encrypted,
                base_url = EXCLUDED.base_url,
                updated_at = NOW()
            """
        ),
        {
            "c": empresa_codigo, "pt": partner_enc, "ak": api_key_enc,
            "env": body.environment, "url": base_url,
        },
    )
    await db.commit()

    # Devolver el estado actualizado
    statuses = await list_empresas_nubox_api(user, db)
    match = next((s for s in statuses if s.empresa_codigo == empresa_codigo), None)
    if match:
        return match
    # Fallback (no debería pasar)
    return EmpresaNuboxApiStatus(
        empresa_codigo=empresa_codigo, razon_social=None, rut=None,
        tiene_credencial_api=True, environment=body.environment,
        ultima_validacion_at=None, ultima_validacion_ok=None,
        ultima_validacion_msg=None, ventas_count=0,
    )


@router.post("/test/{empresa_codigo}", response_model=TestResponse)
async def test_credentials(
    empresa_codigo: str, user: CurrentUser, db: DBSession,
) -> TestResponse:
    """Prueba que las credenciales API Nubox respondan OK."""
    await _require_admin(user)
    partner_token, api_key, base_url, environment = await _get_active_credentials(
        db, empresa_codigo,
    )

    run_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.nubox_api_runs
                    (empresa_codigo, tipo, environment, status, triggered_by)
                VALUES (:c, 'test_credentials', :env, 'STARTED', CAST(:u AS UUID))
                RETURNING run_id
                """
            ),
            {"c": empresa_codigo, "env": environment, "u": str(user.sub)},
        )
    ).fetchone()
    await db.commit()
    run_id = run_row[0]

    result = await test_connection(partner_token, api_key, base_url)
    final_status = "OK" if result["ok"] else "FAILED"

    await db.execute(
        text(
            """
            UPDATE core.nubox_api_runs
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
            UPDATE core.nubox_api_credenciales
            SET ultima_validacion_at = NOW(),
                ultima_validacion_ok = :ok,
                ultima_validacion_msg = :msg,
                updated_at = NOW()
            WHERE empresa_codigo = :c AND environment = :env
            """
        ),
        {
            "ok": result["ok"],
            "msg": result.get("message", "")[:500],
            "c": empresa_codigo, "env": environment,
        },
    )
    await db.commit()

    return TestResponse(
        empresa_codigo=empresa_codigo,
        ok=result["ok"],
        message=result["message"],
        error_type=result.get("error_type"),
    )


@router.post(
    "/emit-from-voucher/{voucher_id}",
    response_model=EmitFromVoucherResponse,
)
async def emit_from_voucher(
    voucher_id: int, user: CurrentUser, db: DBSession,
) -> EmitFromVoucherResponse:
    """Emite un DTE oficial vía Nubox API desde un voucher local."""
    await _require_admin(user)

    # Cargar voucher + líneas
    voucher_row = (
        await db.execute(
            text(
                """
                SELECT v.voucher_id, v.empresa_codigo, v.tipo,
                       v.doc_tributario_tipo, v.doc_tributario_folio,
                       v.fecha_documento, v.fecha_contable, v.fecha_ejecucion,
                       v.glosa, v.moneda, v.contraparte_rut, v.contraparte_nombre,
                       v.status
                FROM core.vouchers v
                WHERE v.voucher_id = :id
                """
            ),
            {"id": voucher_id},
        )
    ).fetchone()
    if not voucher_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Voucher {voucher_id} no existe",
        )

    voucher_dict = {
        "voucher_id": voucher_row[0],
        "empresa_codigo": voucher_row[1],
        "tipo": voucher_row[2],
        "doc_tributario_tipo": voucher_row[3],
        "doc_tributario_folio": voucher_row[4],
        "fecha_documento": voucher_row[5],
        "fecha_contable": voucher_row[6],
        "fecha_ejecucion": voucher_row[7],
        "glosa": voucher_row[8],
        "moneda": voucher_row[9],
        "contraparte_rut": voucher_row[10],
        "contraparte_nombre": voucher_row[11],
    }
    empresa_codigo = voucher_dict["empresa_codigo"]

    if voucher_row[12] in ("REJECTED", "VOID"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Voucher en estado {voucher_row[12]} — no se puede emitir",
        )

    line_rows = (
        await db.execute(
            text(
                """
                SELECT line_number, cuenta_codigo, descripcion,
                       debit, credit, iva_tratamiento
                FROM core.voucher_lines
                WHERE voucher_id = :id
                ORDER BY line_number
                """
            ),
            {"id": voucher_id},
        )
    ).fetchall()
    lines = [
        {
            "line_number": l[0], "cuenta_codigo": l[1],
            "descripcion": l[2], "debit": l[3], "credit": l[4],
            "iva_tratamiento": l[5],
        }
        for l in line_rows
    ]

    # Mappear a payload Nubox
    try:
        payload = voucher_to_nubox_payload(voucher_dict, lines, sequence=1)
    except NuboxMapperError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No se puede mappear voucher a Nubox: {exc}",
        ) from exc

    # Cargar credenciales
    partner_token, api_key, base_url, environment = await _get_active_credentials(
        db, empresa_codigo,
    )

    idempotence_id = str(uuid.uuid4())
    run_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.nubox_api_runs
                    (empresa_codigo, tipo, environment, idempotence_id,
                     request_body, status, triggered_by)
                VALUES (:c, 'emit_from_voucher', :env, CAST(:idem AS UUID),
                        CAST(:body AS jsonb), 'STARTED', CAST(:u AS UUID))
                RETURNING run_id
                """
            ),
            {
                "c": empresa_codigo, "env": environment,
                "idem": idempotence_id, "body": json.dumps([payload], default=str),
                "u": str(user.sub),
            },
        )
    ).fetchone()
    await db.commit()
    run_id = run_row[0]

    nubox_doc_id: int | None = None
    folio: str | None = None
    estado = "FAILED"
    error_msg: str | None = None
    errors: list[dict] = []

    try:
        async with NuboxApiClient(partner_token, api_key, base_url) as cli:
            response_body, _ = await cli.emit_documents(
                [payload], idempotence_id=idempotence_id,
            )

        successful, failed = parse_nubox_emit_response(response_body)

        if successful and successful[0].get("id"):
            doc = successful[0]
            nubox_doc_id = int(doc["id"])
            folio = str(doc.get("number") or "") or None
            estado = "OK"

            # Persistir en core.nubox_ventas + linkear con voucher
            await db.execute(
                text(
                    """
                    INSERT INTO core.nubox_ventas
                        (empresa_codigo, nubox_document_id, folio, tipo_dte,
                         periodo, cliente_rut, cliente_razon_social,
                         voucher_id, idempotence_id, raw_data, fecha_emision)
                    VALUES
                        (:c, :doc, :folio, :tipo,
                         :p, :rut, :rsoc, :vid, CAST(:idem AS UUID),
                         CAST(:raw AS jsonb), NOW())
                    ON CONFLICT (empresa_codigo, nubox_document_id) DO NOTHING
                    """
                ),
                {
                    "c": empresa_codigo, "doc": nubox_doc_id, "folio": folio,
                    "tipo": int(payload["type"]["legalCode"]),
                    "p": str(voucher_dict["fecha_documento"])[:7],
                    "rut": voucher_dict["contraparte_rut"],
                    "rsoc": voucher_dict["contraparte_nombre"],
                    "vid": voucher_id,
                    "idem": idempotence_id,
                    "raw": json.dumps(doc, default=str),
                },
            )

            # Marcar el voucher local con folio + tracking
            await db.execute(
                text(
                    """
                    UPDATE core.vouchers
                    SET nubox_folio = :folio,
                        nubox_synced_at = NOW(),
                        nubox_status = 'EMITTED',
                        updated_at = NOW()
                    WHERE voucher_id = :vid
                    """
                ),
                {"folio": folio, "vid": voucher_id},
            )
        elif failed:
            errors = failed[0].get("errors") or []
            error_msg = f"Validación Nubox falló: {len(errors)} errores"
        else:
            error_msg = "Respuesta Nubox sin id ni errores"

    except NuboxApiValidationError as exc:
        error_msg = f"Validación: {exc}"
        errors = exc.errors
    except NuboxApiAuthError as exc:
        error_msg = f"Auth: {exc}"
    except NuboxApiError as exc:
        error_msg = f"API: {exc}"
    except Exception as exc:  # noqa: BLE001
        error_msg = f"Error inesperado: {exc}"[:500]
        log.exception("nubox_api_emit_error", extra={"voucher_id": voucher_id})

    await db.execute(
        text(
            """
            UPDATE core.nubox_api_runs
            SET status = :s, http_status = :http, finished_at = NOW(),
                error_message = :err
            WHERE run_id = :id
            """
        ),
        {
            "s": estado, "http": 200 if estado == "OK" else 400,
            "err": error_msg, "id": run_id,
        },
    )
    await db.commit()

    if estado != "OK":
        return EmitFromVoucherResponse(
            voucher_id=voucher_id, nubox_document_id=None, folio=None,
            estado=estado, idempotence_id=idempotence_id,
            errors=errors, message=error_msg or "Falla desconocida",
        )

    return EmitFromVoucherResponse(
        voucher_id=voucher_id, nubox_document_id=nubox_doc_id, folio=folio,
        estado=estado, idempotence_id=idempotence_id,
        errors=[],
        message=f"DTE emitido OK con folio {folio} (nubox_document_id={nubox_doc_id})",
    )


@router.post(
    "/sync-sales/{empresa_codigo}",
    response_model=SyncSalesResponse,
)
async def sync_sales(
    empresa_codigo: str,
    user: CurrentUser, db: DBSession,
    periodo: Annotated[str, Query(pattern=r"^\d{4}-\d{2}$")],
) -> SyncSalesResponse:
    """Descarga las ventas emitidas en el período vía Nubox API."""
    await _require_admin(user)
    partner_token, api_key, base_url, environment = await _get_active_credentials(
        db, empresa_codigo,
    )
    started = datetime.utcnow()

    run_row = (
        await db.execute(
            text(
                """
                INSERT INTO core.nubox_api_runs
                    (empresa_codigo, tipo, environment, status, triggered_by)
                VALUES (:c, 'list_sales', :env, 'STARTED', CAST(:u AS UUID))
                RETURNING run_id
                """
            ),
            {"c": empresa_codigo, "env": environment, "u": str(user.sub)},
        )
    ).fetchone()
    await db.commit()
    run_id = run_row[0]

    count = 0
    error_msg: str | None = None

    try:
        async with NuboxApiClient(partner_token, api_key, base_url) as cli:
            page = 1
            while True:
                sales, total = await cli.list_sales(
                    period=periodo, page=page, size=100,
                    sort=["emissionDate,desc"],
                )
                if not sales:
                    break
                for s in sales:
                    fecha_iso = s.fecha_emision
                    fecha_dt: datetime | None = None
                    if fecha_iso:
                        try:
                            fecha_dt = datetime.fromisoformat(
                                fecha_iso.replace("Z", "+00:00")
                            )
                        except ValueError:
                            fecha_dt = None
                    await db.execute(
                        text(
                            """
                            INSERT INTO core.nubox_ventas
                                (empresa_codigo, nubox_document_id, folio, tipo_dte,
                                 periodo, fecha_emision, cliente_rut, cliente_razon_social,
                                 monto_neto, monto_exento, monto_iva, monto_total,
                                 estado_emision_id, estado_emision_name, sii_track_id,
                                 raw_data)
                            VALUES
                                (:c, :doc, :folio, :tipo,
                                 :p, :fe, :rut, :rsoc,
                                 :neto, :exe, :iva, :total,
                                 :esti, :estn, :tid,
                                 CAST(:raw AS jsonb))
                            ON CONFLICT (empresa_codigo, nubox_document_id)
                            DO UPDATE SET
                                folio = EXCLUDED.folio,
                                periodo = EXCLUDED.periodo,
                                fecha_emision = EXCLUDED.fecha_emision,
                                cliente_razon_social = COALESCE(EXCLUDED.cliente_razon_social,
                                                                 core.nubox_ventas.cliente_razon_social),
                                monto_neto = EXCLUDED.monto_neto,
                                monto_exento = EXCLUDED.monto_exento,
                                monto_iva = EXCLUDED.monto_iva,
                                monto_total = EXCLUDED.monto_total,
                                estado_emision_id = EXCLUDED.estado_emision_id,
                                estado_emision_name = EXCLUDED.estado_emision_name,
                                sii_track_id = COALESCE(EXCLUDED.sii_track_id,
                                                         core.nubox_ventas.sii_track_id),
                                raw_data = EXCLUDED.raw_data,
                                updated_at = NOW()
                            """
                        ),
                        {
                            "c": empresa_codigo, "doc": s.id, "folio": s.folio,
                            "tipo": s.tipo_dte, "p": periodo,
                            "fe": fecha_dt,
                            "rut": s.cliente_rut, "rsoc": s.cliente_razon_social,
                            "neto": s.monto_neto, "exe": s.monto_exento,
                            "iva": s.monto_iva, "total": s.monto_total,
                            "esti": s.estado_emision_id,
                            "estn": s.estado_emision_name,
                            "tid": s.sii_track_id,
                            "raw": json.dumps(s.raw, default=str),
                        },
                    )
                    count += 1
                if page * 100 >= total:
                    break
                page += 1
    except NuboxApiAuthError as exc:
        error_msg = f"Auth: {exc}"
    except NuboxApiError as exc:
        error_msg = f"API: {exc}"
    except Exception as exc:  # noqa: BLE001
        error_msg = f"Error: {exc}"[:500]
        log.exception("nubox_api_sync_error", extra={"empresa": empresa_codigo})

    duracion = (datetime.utcnow() - started).total_seconds()
    final_status = "OK" if error_msg is None else "FAILED"

    await db.execute(
        text(
            """
            UPDATE core.nubox_api_runs
            SET status = :s, finished_at = NOW(), error_message = :err
            WHERE run_id = :id
            """
        ),
        {"s": final_status, "err": error_msg, "id": run_id},
    )
    await db.commit()

    if error_msg:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Sync Nubox falló: {error_msg}",
        )

    return SyncSalesResponse(
        empresa_codigo=empresa_codigo, periodo=periodo,
        sales_count=count, duracion_segundos=duracion,
    )


@router.get(
    "/sales/{empresa_codigo}",
    response_model=list[VentaNuboxRead],
)
async def list_ventas(
    empresa_codigo: str,
    user: CurrentUser, db: DBSession,
    periodo: Annotated[str | None, Query(pattern=r"^\d{4}-\d{2}$")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
) -> list[VentaNuboxRead]:
    """Lista ventas Nubox almacenadas en core.nubox_ventas."""
    await _require_admin(user)
    wheres = ["empresa_codigo = :c"]
    params: dict = {"c": empresa_codigo, "l": limit}
    if periodo:
        wheres.append("periodo = :p")
        params["p"] = periodo
    sql = f"""
        SELECT venta_id, nubox_document_id, folio, tipo_dte, periodo,
               fecha_emision, cliente_rut, cliente_razon_social,
               monto_neto, monto_iva, monto_total,
               estado_emision_id, estado_emision_name, sii_track_id, voucher_id
        FROM core.nubox_ventas
        WHERE {' AND '.join(wheres)}
        ORDER BY fecha_emision DESC NULLS LAST, venta_id DESC
        LIMIT :l
    """
    rows = (await db.execute(text(sql), params)).fetchall()
    return [
        VentaNuboxRead(
            venta_id=r[0], nubox_document_id=r[1], folio=r[2],
            tipo_dte=r[3], periodo=r[4], fecha_emision=r[5],
            cliente_rut=r[6], cliente_razon_social=r[7],
            monto_neto=int(r[8] or 0), monto_iva=int(r[9] or 0),
            monto_total=int(r[10] or 0),
            estado_emision_id=r[11], estado_emision_name=r[12],
            sii_track_id=r[13], voucher_id=r[14],
        )
        for r in rows
    ]


@router.get("/sales/{empresa_codigo}/{nubox_document_id}/pdf")
async def get_pdf(
    empresa_codigo: str,
    nubox_document_id: int,
    user: CurrentUser, db: DBSession,
    template: Annotated[str, Query(pattern=r"^TEMPLATE_(A4|80MM)$")] = "TEMPLATE_A4",
) -> Response:
    """Proxy al PDF firmado de Nubox."""
    await _require_admin(user)
    partner_token, api_key, base_url, _ = await _get_active_credentials(
        db, empresa_codigo,
    )
    async with NuboxApiClient(partner_token, api_key, base_url) as cli:
        pdf_bytes = await cli.get_pdf(nubox_document_id, template=template)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="dte-{nubox_document_id}.pdf"',
        },
    )


@router.get("/sales/{empresa_codigo}/{nubox_document_id}/xml")
async def get_xml(
    empresa_codigo: str, nubox_document_id: int,
    user: CurrentUser, db: DBSession,
) -> Response:
    """Proxy al XML con validez SII de Nubox."""
    await _require_admin(user)
    partner_token, api_key, base_url, _ = await _get_active_credentials(
        db, empresa_codigo,
    )
    async with NuboxApiClient(partner_token, api_key, base_url) as cli:
        xml_bytes = await cli.get_xml(nubox_document_id)
    return Response(
        content=xml_bytes,
        media_type="application/xml",
        headers={
            "Content-Disposition": f'attachment; filename="dte-{nubox_document_id}.xml"',
        },
    )
