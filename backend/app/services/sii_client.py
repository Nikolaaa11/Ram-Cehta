"""Round 117 — Cliente HTTP para el portal del SII Chile.

Diseño:
  - Login al portal con (rut, clave) → obtiene cookie de sesión
  - Acceso a servicios JSON internos del SII para descargar RCV (Registro
    de Compras y Ventas).
  - Sin browser (Playwright/Selenium) — todo httpx + parseo de JSON.

Endpoints relevantes del SII (estado al 2025-2026):
  Login:  https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi
  RCV:    https://www4.sii.cl/anotacionesRcvInternetUI/services/data/MaintainerResource.svc/
          - GetDteRecibidos/{periodo}/{tipo_dte}/{rut}/{dv}/{estado}
          - GetDteEmitidos/{periodo}/{tipo_dte}/{rut}/{dv}/{estado}

LIMITACIONES CONOCIDAS:
  - El SII cambia URLs/cookies sin previo aviso. Este cliente se diseña
    para fallar loud (raise SiiClientError) en cualquier desviación del
    contrato esperado.
  - El SII puede aplicar CAPTCHA después de N intentos fallidos. Si pasa,
    hay que esperar o usar otra IP.
  - Algunas operaciones necesitan certificado digital (.p12). Las que
    soportamos (RCV resumido) NO lo necesitan — alcanza con rut + clave.

NUNCA:
  - Loguear la clave en plaintext (ni en logs estructurados ni en errores)
  - Persistir cookies de sesión más allá del request (son válidas pocos min)
  - Compartir cookies entre empresas distintas
"""
from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import date
from typing import Any

import httpx

log = logging.getLogger(__name__)


SII_LOGIN_URL = "https://zeusr.sii.cl/cgi_AUT2000/CAutInicio.cgi"
SII_HOME_URL = "https://homer.sii.cl/"
SII_RCV_BASE = "https://www4.sii.cl/anotacionesRcvInternetUI/services/data"


# Tipos DTE comunes (lista oficial del SII tiene >50, estos son los más usuales)
DTE_TIPOS = {
    33: "Factura electrónica",
    34: "Factura no afecta o exenta electrónica",
    39: "Boleta electrónica",
    41: "Boleta no afecta o exenta electrónica",
    43: "Liquidación factura electrónica",
    46: "Factura de compra electrónica",
    52: "Guía de despacho electrónica",
    56: "Nota de débito electrónica",
    61: "Nota de crédito electrónica",
    110: "Factura de exportación electrónica",
    111: "Nota de débito de exportación electrónica",
    112: "Nota de crédito de exportación electrónica",
}


class SiiClientError(Exception):
    """Error genérico del cliente SII."""


class SiiAuthError(SiiClientError):
    """Falló el login — clave incorrecta, captcha, o SII caído."""


@dataclass(frozen=True)
class SiiDocumento:
    """Una fila del RCV. Espejo de la columna del CSV/JSON del SII."""
    flujo: str  # 'compra' o 'venta'
    tipo_dte: int
    folio: str
    periodo: str  # YYYY-MM
    rut_contraparte: str
    razon_social_contraparte: str | None
    fecha_emision: date | None
    fecha_recepcion: date | None
    monto_exento: int
    monto_neto: int
    monto_iva: int
    monto_total: int
    estado_sii: str | None
    raw: dict[str, Any]


def _split_rut(rut_completo: str) -> tuple[str, str]:
    """Separa '77.018.739-7' → ('77018739', '7'). Tolerante con puntos/guiones."""
    cleaned = re.sub(r"[^0-9kK]", "", rut_completo)
    if len(cleaned) < 2:
        raise SiiClientError(f"RUT inválido: {rut_completo!r}")
    return cleaned[:-1], cleaned[-1].upper()


def _normalizar_periodo(periodo: str) -> str:
    """Acepta 'YYYY-MM' o 'YYYYMM' → 'YYYY-MM' canónico."""
    p = periodo.replace("-", "")
    if len(p) != 6 or not p.isdigit():
        raise SiiClientError(f"Período inválido (esperado YYYY-MM): {periodo!r}")
    return f"{p[:4]}-{p[4:]}"


def _to_int(value: Any) -> int:
    """Convierte '1.234.567' / '1234567' / 1234567 → 1234567."""
    if value is None or value == "":
        return 0
    if isinstance(value, int | float):
        return int(value)
    s = str(value).replace(".", "").replace(",", "").strip()
    if not s or s == "-":
        return 0
    try:
        return int(s)
    except ValueError:
        return 0


def _to_date(value: Any) -> date | None:
    """Parsea formatos comunes del SII: 'DD/MM/YYYY' o 'YYYY-MM-DD'."""
    if not value:
        return None
    s = str(value).strip()
    for fmt in ("%d/%m/%Y", "%Y-%m-%d"):
        try:
            from datetime import datetime
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


class SiiClient:
    """Cliente para interactuar con el portal del SII.

    Lifecycle:
        async with SiiClient.login(rut, clave) as cli:
            docs_compras = await cli.descargar_rcv_compras("2026-04")
            docs_ventas  = await cli.descargar_rcv_ventas("2026-04")

    El context manager cierra el HTTP client al salir.
    """

    def __init__(self, rut: str, clave: str, http: httpx.AsyncClient) -> None:
        self._rut_num, self._dv = _split_rut(rut)
        self._clave = clave  # NUNCA loguear esto
        self._http = http
        self._logged_in = False

    @classmethod
    async def login(cls, rut: str, clave: str, timeout: float = 30.0) -> SiiClient:
        """Crea un cliente y hace login. Raise SiiAuthError si falla."""
        http = httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            headers={
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/121.0 Safari/537.36"
                ),
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "es-CL,es;q=0.9,en;q=0.8",
            },
        )
        cli = cls(rut, clave, http)
        try:
            await cli._do_login()
        except Exception:
            await http.aclose()
            raise
        return cli

    async def __aenter__(self) -> SiiClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        await self.close()

    async def close(self) -> None:
        await self._http.aclose()

    async def _do_login(self) -> None:
        """Hace POST al login endpoint del SII y verifica session válida."""
        # El portal SII espera el RUT con DV como un solo campo
        # más algunos campos hidden. El payload mínimo es:
        payload = {
            "rut": f"{self._rut_num}-{self._dv}",
            "clave": self._clave,
            "referencia": SII_HOME_URL,
        }
        try:
            resp = await self._http.post(SII_LOGIN_URL, data=payload)
        except httpx.RequestError as exc:
            raise SiiAuthError(f"No se pudo contactar al portal SII: {exc}") from exc

        # El SII responde 200 incluso en login fallido, pero:
        #   - Si OK: la respuesta contiene "Cerrar Sesión" o "Mi SII" + cookies session
        #   - Si FAIL: contiene "Rut o Clave Incorrecta"
        text = resp.text or ""
        if "Rut o Clave Incorrecta" in text or "clave incorrecta" in text.lower():
            raise SiiAuthError(f"Clave SII incorrecta para RUT {self._rut_num}-{self._dv}")
        if "captcha" in text.lower() or "Captcha" in text:
            raise SiiAuthError(
                "SII pidió CAPTCHA. Esperá unos minutos y reintentá, o "
                "iniciá sesión manualmente una vez para destrabar."
            )

        # Verificar que recibimos al menos una cookie de sesión
        if not self._http.cookies:
            raise SiiAuthError(
                "Login al SII no devolvió cookies de sesión. "
                "El SII puede haber cambiado el flujo de auth."
            )
        self._logged_in = True
        log.info("sii_login_ok", extra={"rut": f"{self._rut_num}-{self._dv}"})

    def _require_logged_in(self) -> None:
        if not self._logged_in:
            raise SiiClientError("Cliente SII no logueado — usar SiiClient.login() primero")

    async def descargar_rcv_compras(self, periodo: str) -> list[SiiDocumento]:
        """Baja el RCV de compras para un período (YYYY-MM)."""
        return await self._descargar_rcv(periodo, flujo="compra")

    async def descargar_rcv_ventas(self, periodo: str) -> list[SiiDocumento]:
        """Baja el RCV de ventas para un período (YYYY-MM)."""
        return await self._descargar_rcv(periodo, flujo="venta")

    async def _descargar_rcv(self, periodo: str, *, flujo: str) -> list[SiiDocumento]:
        """Pega al endpoint JSON del RCV y parsea el resultado.

        Round 152n — IMPORTANTE: el SII desmanteló el portal
        anotacionesRcvInternetUI en 2025 y los endpoints de este método
        ahora devuelven 404 sistemáticamente. La login al SII sigue
        funcionando (zeusr.sii.cl/cgi_AUT2000) pero la descarga de RCV
        no. Para obtener los DTEs hay 2 caminos vivos:

          1) Nubox API REST (recomendado, automático):
             NuboxApiClient.list_sales()       → ventas (= RCV-ventas)
             NuboxApiClient.list_purchases()   → compras (= RCV-compras)
             NuboxApiClient.list_expenses()    → gastos (honorarios, etc)

          2) SII manual: bajar el CSV desde el portal nuevo del SII
             (siichile.cl) y subirlo via /admin/sii/import-csv.

        Este método se mantiene por compat hasta tener la URL del portal
        nuevo del SII reverse-engineered. Si lo llamás, vas a recibir 404.
        """
        self._require_logged_in()
        periodo_norm = _normalizar_periodo(periodo)
        periodo_param = periodo_norm.replace("-", "")  # SII espera YYYYMM

        # El SII tiene dos servicios distintos: GetDteRecibidos (compras) y GetDteEmitidos (ventas)
        endpoint_path = (
            "GetDteRecibidos" if flujo == "compra" else "GetDteEmitidos"
        )

        # Tipo DTE = 0 significa "todos los tipos". Estado = "REGISTRO" filtra los activos.
        url = (
            f"{SII_RCV_BASE}/MaintainerResource.svc/{endpoint_path}/"
            f"{periodo_param}/0/{self._rut_num}/{self._dv}/REGISTRO"
        )

        try:
            resp = await self._http.get(
                url,
                headers={
                    "Accept": "application/json, text/plain, */*",
                    "Referer": (
                        "https://www4.sii.cl/anotacionesRcvInternetUI/menu/"
                        "registroCompraVentaInternet"
                    ),
                },
            )
        except httpx.RequestError as exc:
            raise SiiClientError(f"Falló GET al RCV: {exc}") from exc

        if resp.status_code == 401 or resp.status_code == 403:
            raise SiiAuthError(
                f"SII rechazó la sesión ({resp.status_code}). Re-loguear."
            )
        if resp.status_code != 200:
            raise SiiClientError(
                f"SII devolvió {resp.status_code}: {resp.text[:200]}"
            )

        try:
            data = resp.json()
        except Exception as exc:
            raise SiiClientError(f"Respuesta no es JSON: {resp.text[:200]}") from exc

        return self._parse_rcv_response(data, flujo=flujo, periodo=periodo_norm)

    def _parse_rcv_response(
        self, data: Any, *, flujo: str, periodo: str
    ) -> list[SiiDocumento]:
        """Convierte el JSON crudo del SII a lista de SiiDocumento.

        El shape del SII tiene variaciones según versión del servicio. Probamos
        los patrones más comunes y caemos a una lista vacía si no matchea.
        """
        items: list[Any]
        if isinstance(data, dict):
            # Pattern A: {"data": [...]}
            items = data.get("data") or data.get("Data") or []
            # Pattern B: {"detalle": [...]} (otro endpoint antiguo)
            if not items:
                items = data.get("detalle") or []
        elif isinstance(data, list):
            items = data
        else:
            return []

        out: list[SiiDocumento] = []
        for it in items:
            if not isinstance(it, dict):
                continue
            # Los campos del SII vienen con nombres tipo "rutEmisor", "razonSocial",
            # "folio", "tipoDoc", "fchEmis", "mntTotal" etc.
            tipo_dte = _to_int(it.get("tipoDoc") or it.get("tipo_doc") or it.get("dteType"))
            folio = str(it.get("folio") or it.get("Folio") or "").strip()
            if not folio or tipo_dte == 0:
                continue

            rut_otro = (
                it.get("rutEmisor") if flujo == "compra"
                else it.get("rutReceptor")
            ) or it.get("rut") or ""
            razon_otro = (
                it.get("razonSocial")
                or it.get("rznSoc")
                or it.get("nombreEmisor")
                or it.get("nombreReceptor")
            )

            doc = SiiDocumento(
                flujo=flujo,
                tipo_dte=tipo_dte,
                folio=folio,
                periodo=periodo,
                rut_contraparte=str(rut_otro).strip(),
                razon_social_contraparte=str(razon_otro).strip() if razon_otro else None,
                fecha_emision=_to_date(it.get("fchEmis") or it.get("fechaEmision")),
                fecha_recepcion=_to_date(it.get("fchRecep") or it.get("fechaRecepcion")),
                monto_exento=_to_int(it.get("mntExe") or it.get("montoExento")),
                monto_neto=_to_int(it.get("mntNeto") or it.get("montoNeto")),
                monto_iva=_to_int(it.get("mntIVA") or it.get("iva") or it.get("montoIVA")),
                monto_total=_to_int(it.get("mntTotal") or it.get("montoTotal")),
                estado_sii=str(it.get("estadoSii") or it.get("estado") or "REGISTRO"),
                raw=it,
            )
            out.append(doc)
        return out


# =====================================================================
# Función de alto nivel para test de conexión
# =====================================================================

async def test_login(rut: str, clave: str, timeout: float = 30.0) -> dict[str, Any]:
    """Intenta login y devuelve dict con resultado. NO levanta.

    Útil para el endpoint `/admin/sii/test-credentials/{empresa}` que no
    quiere reventar — solo reportar OK/FAIL para que el operador sepa.
    """
    try:
        cli = await asyncio.wait_for(SiiClient.login(rut, clave, timeout=timeout), timeout=timeout)
        await cli.close()
        return {"ok": True, "message": "Login exitoso"}
    except SiiAuthError as exc:
        return {"ok": False, "message": str(exc), "error_type": "auth"}
    except SiiClientError as exc:
        return {"ok": False, "message": str(exc), "error_type": "client"}
    except asyncio.TimeoutError:
        return {"ok": False, "message": "Timeout (>30s) al SII", "error_type": "timeout"}
    except Exception as exc:  # noqa: BLE001 — defensive
        return {"ok": False, "message": f"Error inesperado: {exc}", "error_type": "unknown"}
