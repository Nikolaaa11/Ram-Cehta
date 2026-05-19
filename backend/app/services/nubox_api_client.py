"""Round 124 — Cliente para la API REST oficial de Nubox (Factura y Administración).

Documentación oficial:
  Esta es la API REST nueva de Nubox para emisión de DTE (facturas,
  boletas, notas crédito/débito). Reemplaza al scraping del portal.

Autenticación dual:
  Authorization: Bearer <partner_token>   (token del partner = Cehta)
  X-Api-Key: <company_api_key>            (key específica por empresa)

Ambientes:
  - UAT: certificación, disponible L-V 11:00-00:00 GMT
  - PROD: producción

URLs base las entrega Nubox al solicitar credenciales (soporte@nubox.com).

Tipos de DTE soportados:
  33: Factura Electrónica
  34: Factura No Afecta o Exenta Electrónica
  56: Nota de Débito Electrónica
  61: Nota de Crédito Electrónica
  38: Boleta Exenta Electrónica
  41: Boleta Electrónica
  52: Guía de Despacho
  110/111/112: Factura/NC/ND exportación electrónica

Diseño:
  - Asíncrono (httpx) — Nubox internamente es async, nuestro cliente también
  - Idempotente: cada POST /issuance lleva un UUID v4 nuevo
  - Fail-loud: errores tipados (NuboxApiError, NuboxApiAuthError, etc)
  - Nunca loguea el partner_token o api_key en plaintext
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass
from typing import Any

import httpx

log = logging.getLogger(__name__)


# Default URLs (las entregadas oficialmente por Nubox al solicitar credenciales).
# Almacenadas en cada credencial DB para evitar hardcoding si Nubox las cambia.
DEFAULT_UAT_URL = "https://api.test-nubox.com/nbxpymapi-uat"
DEFAULT_PROD_URL = "https://api.nubox.com/nbxpymapi"


# Tipos DTE soportados por la API
DTE_TIPOS_SOPORTADOS = {33, 34, 38, 41, 52, 56, 61, 110, 111, 112}


class NuboxApiError(Exception):
    """Error genérico de la API Nubox."""

    def __init__(self, message: str, status: int | None = None,
                 errors: list[dict] | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.errors = errors or []


class NuboxApiAuthError(NuboxApiError):
    """Auth falló — partner_token o api_key inválidos, o no asociados."""


class NuboxApiValidationError(NuboxApiError):
    """400 — payload con errores de validación. `errors` lista campos rechazados."""


@dataclass(frozen=True)
class NuboxDocumentSummary:
    """Vista resumida de un documento Nubox (espejo de GET /v1/sales)."""
    id: int
    number: str | None
    tipo_dte: int
    folio: str | None
    fecha_emision: str | None
    cliente_rut: str
    cliente_razon_social: str | None
    monto_neto: int
    monto_exento: int
    monto_iva: int
    monto_total: int
    estado_emision_id: int
    estado_emision_name: str
    sii_track_id: int | None
    annulled: bool
    raw: dict[str, Any]


class NuboxApiClient:
    """Cliente HTTP para la API REST Nubox.

    Uso:
        cli = NuboxApiClient(partner_token, api_key, base_url)
        try:
            result = await cli.emit_document(...)
            sales = await cli.list_sales(period="2026-04")
        finally:
            await cli.close()
    """

    def __init__(
        self,
        partner_token: str,
        api_key: str,
        base_url: str,
        timeout: float = 30.0,
    ) -> None:
        if not partner_token or not api_key:
            raise NuboxApiError("partner_token y api_key son requeridos")
        self._partner_token = partner_token  # NUNCA loguear
        self._api_key = api_key              # NUNCA loguear
        self._base_url = base_url.rstrip("/")
        self._http = httpx.AsyncClient(
            timeout=timeout,
            headers={
                # Headers comunes a TODAS las requests
                "Authorization": f"Bearer {partner_token}",
                "X-Api-Key": api_key,
                "Content-Type": "application/json",
                "Accept": "application/json",
                "User-Agent": "RamCehta/1.0 (FIP CEHTA ESG; +https://ram-cehta.vercel.app)",
            },
        )

    async def __aenter__(self) -> NuboxApiClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def close(self) -> None:
        await self._http.aclose()

    # ------------------------------------------------------------------
    # Helpers internos
    # ------------------------------------------------------------------

    def _build_url(self, path: str) -> str:
        if not path.startswith("/"):
            path = "/" + path
        return f"{self._base_url}{path}"

    async def _raise_for_error(self, resp: httpx.Response) -> None:
        """Convierte respuestas no-2xx en excepciones tipadas."""
        if 200 <= resp.status_code < 300:
            return

        # Intentar parsear el body como JSON Nubox
        body: dict | None = None
        try:
            body = resp.json() if resp.text else None
        except Exception:
            body = None

        message = (body or {}).get("message") if body else None
        if not message:
            message = f"Nubox {resp.status_code}: {resp.text[:200]}"
        errors = (body or {}).get("errors") or []

        if resp.status_code in (401, 403):
            raise NuboxApiAuthError(
                message, status=resp.status_code, errors=errors,
            )
        if resp.status_code == 400:
            raise NuboxApiValidationError(
                message, status=resp.status_code, errors=errors,
            )
        raise NuboxApiError(message, status=resp.status_code, errors=errors)

    # ------------------------------------------------------------------
    # POST /v1/sales/issuance — emitir documentos
    # ------------------------------------------------------------------

    async def emit_documents(
        self,
        documents: list[dict[str, Any]],
        idempotence_id: str | None = None,
    ) -> tuple[list[dict], str]:
        """Envía un batch de documentos a emitir.

        Returns: (response_body_list, idempotence_id_used)

        El idempotence_id debe ser único por llamada. Si lo pasás, se
        usa; sino se genera uno random (UUID v4). Reintentos con el
        MISMO id devuelven la misma respuesta (no duplican emisiones).

        El array de `documents` tiene un cap de 50 por llamada.
        """
        if not documents:
            raise NuboxApiError("Lista de documentos vacía")
        if len(documents) > 50:
            raise NuboxApiError(
                f"Máximo 50 documentos por llamada (recibidos {len(documents)})"
            )

        if idempotence_id is None:
            idempotence_id = str(uuid.uuid4())

        url = self._build_url("/v1/sales/issuance")
        try:
            resp = await self._http.post(
                url,
                json=documents,
                headers={"X-Idempotence-Id": idempotence_id},
            )
        except httpx.RequestError as exc:
            raise NuboxApiError(f"Falló POST /sales/issuance: {exc}") from exc

        # 207 Multi-Status = batch procesado con éxitos+errores individuales
        # 200 OK también posible
        # 400 = validación global del batch
        # 401/403 = auth
        if resp.status_code not in (200, 207):
            await self._raise_for_error(resp)

        try:
            body = resp.json()
        except Exception as exc:
            raise NuboxApiError(f"Respuesta no es JSON: {resp.text[:200]}") from exc

        if not isinstance(body, list):
            raise NuboxApiError(
                f"Respuesta esperada: array. Recibido: {type(body).__name__}"
            )
        return body, idempotence_id

    # ------------------------------------------------------------------
    # GET /v1/sales — listar ventas
    # ------------------------------------------------------------------

    async def list_sales(
        self,
        period: str | None = None,
        document_number: int | None = None,
        emission_status_id: int | None = None,
        document_status_id: int | None = None,
        types: list[int] | None = None,
        page: int = 1,
        size: int = 100,
        sort: list[str] | None = None,
    ) -> tuple[list[NuboxDocumentSummary], int]:
        """Lista documentos emitidos.

        - `period` (YYYY-MM): obligatorio si no se especifica document_number
        - `types`: array de tipos DTE (ej. [33, 39])
        - `sort`: array de "<campo>,asc|desc" (ej. ["emissionDate,desc"])

        Returns: (lista de docs, total_count)
        """
        params: dict[str, Any] = {"page": page, "size": size}
        if period:
            params["period"] = period
        if document_number is not None:
            params["documentNumber"] = document_number
        if emission_status_id is not None:
            params["emissionStatusId"] = emission_status_id
        if document_status_id is not None:
            params["documentStatusId"] = document_status_id
        if types:
            params["type"] = types
        if sort:
            params["sort"] = sort

        url = self._build_url("/v1/sales")
        try:
            resp = await self._http.get(url, params=params)
        except httpx.RequestError as exc:
            raise NuboxApiError(f"Falló GET /sales: {exc}") from exc

        if resp.status_code == 204:
            return [], 0
        await self._raise_for_error(resp)

        total = int(resp.headers.get("x-total-count", "0") or "0")
        try:
            body = resp.json()
        except Exception as exc:
            raise NuboxApiError(f"Respuesta no es JSON: {resp.text[:200]}") from exc

        if not isinstance(body, list):
            raise NuboxApiError("Respuesta esperada: array")

        return [self._parse_sale_summary(d) for d in body], total

    # ------------------------------------------------------------------
    # GET /v1/sales/{id} — detalle de una venta
    # ------------------------------------------------------------------

    async def get_sale(self, document_id: int) -> NuboxDocumentSummary:
        url = self._build_url(f"/v1/sales/{document_id}")
        try:
            resp = await self._http.get(url)
        except httpx.RequestError as exc:
            raise NuboxApiError(f"Falló GET /sales/{document_id}: {exc}") from exc

        if resp.status_code == 404:
            raise NuboxApiError(
                f"Documento {document_id} no encontrado", status=404,
            )
        await self._raise_for_error(resp)

        try:
            body = resp.json()
        except Exception as exc:
            raise NuboxApiError(f"Respuesta no es JSON: {resp.text[:200]}") from exc

        return self._parse_sale_summary(body)

    # ------------------------------------------------------------------
    # GET /v1/sales/{id}/pdf y /xml
    # ------------------------------------------------------------------

    async def get_pdf(
        self, document_id: int, template: str = "TEMPLATE_A4",
    ) -> bytes:
        """Descarga el PDF firmado de Nubox.

        - template: 'TEMPLATE_A4' o 'TEMPLATE_80MM' (voucher/boleta)
        """
        if template not in {"TEMPLATE_A4", "TEMPLATE_80MM"}:
            raise NuboxApiError(f"Template inválido: {template}")
        url = self._build_url(f"/v1/sales/{document_id}/pdf")
        try:
            resp = await self._http.get(
                url,
                params={"template": template},
                headers={"Accept": "application/pdf"},
            )
        except httpx.RequestError as exc:
            raise NuboxApiError(f"Falló GET PDF: {exc}") from exc

        if resp.status_code == 404:
            raise NuboxApiError(f"PDF {document_id} no encontrado", status=404)
        await self._raise_for_error(resp)
        return resp.content

    async def get_xml(self, document_id: int) -> bytes:
        """Descarga el XML con validez tributaria SII."""
        url = self._build_url(f"/v1/sales/{document_id}/xml")
        try:
            resp = await self._http.get(
                url,
                headers={"Accept": "application/xml"},
            )
        except httpx.RequestError as exc:
            raise NuboxApiError(f"Falló GET XML: {exc}") from exc

        if resp.status_code == 404:
            raise NuboxApiError(f"XML {document_id} no encontrado", status=404)
        await self._raise_for_error(resp)
        return resp.content

    # ------------------------------------------------------------------
    # Parser de respuesta GET /sales (compartido entre list y get_one)
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_sale_summary(d: dict[str, Any]) -> NuboxDocumentSummary:
        type_info = d.get("type") or {}
        client = d.get("client") or {}
        client_id = client.get("identification") or {}
        emission_status = d.get("emissionStatus") or {}
        data_cl = d.get("dataCl") or {}

        return NuboxDocumentSummary(
            id=int(d.get("id") or 0),
            number=str(d.get("number") or "") or None,
            tipo_dte=int(type_info.get("legalCode") or 0),
            folio=str(d.get("number") or "") or None,
            fecha_emision=d.get("emissionDate"),
            cliente_rut=str(client_id.get("value") or ""),
            cliente_razon_social=client.get("tradeName"),
            monto_neto=int(d.get("totalNetAmount") or 0),
            monto_exento=int(d.get("totalExemptAmount") or 0),
            monto_iva=int(d.get("totalTaxVatAmount") or 0),
            monto_total=int(d.get("totalAmount") or 0),
            estado_emision_id=int(emission_status.get("id") or 0),
            estado_emision_name=str(emission_status.get("name") or ""),
            sii_track_id=(
                int(data_cl.get("trackId")) if data_cl.get("trackId") else None
            ),
            annulled=bool(data_cl.get("annulled", False)),
            raw=d,
        )


# =====================================================================
# High-level: test de conexión que no levanta
# =====================================================================


async def test_connection(
    partner_token: str,
    api_key: str,
    base_url: str,
    timeout: float = 15.0,
) -> dict[str, Any]:
    """Valida las credenciales pegándole a GET /v1/sales con page=1, size=1.

    Si responde 200/204/207 → credenciales OK.
    Si responde 401/403 → credenciales mal.
    Otros errores → reportados.
    """
    try:
        async with NuboxApiClient(
            partner_token, api_key, base_url, timeout=timeout,
        ) as cli:
            # Hacemos una llamada barata: list con page=1 size=1
            # No requiere period si es solo verificación, pero por safety
            # usamos el mes actual
            from datetime import datetime
            now = datetime.utcnow()
            period = f"{now.year:04d}-{now.month:02d}"
            try:
                _, total = await asyncio.wait_for(
                    cli.list_sales(period=period, page=1, size=1),
                    timeout=timeout,
                )
                return {
                    "ok": True,
                    "message": f"API Nubox responde OK. Documentos en {period}: {total}",
                }
            except NuboxApiAuthError as exc:
                return {
                    "ok": False, "error_type": "auth",
                    "message": f"Auth rechazada: {exc}",
                }
            except NuboxApiError as exc:
                return {
                    "ok": False, "error_type": "api",
                    "message": str(exc),
                }
    except asyncio.TimeoutError:
        return {
            "ok": False, "error_type": "timeout",
            "message": f"Timeout >{timeout}s al pegar a {base_url}",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "ok": False, "error_type": "unknown",
            "message": f"Error inesperado: {exc}",
        }
