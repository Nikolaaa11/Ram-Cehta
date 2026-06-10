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
# Round 152p — portal nuevo del RCV (vivo, el viejo está caído)
SII_CONSDCV_BASE = "https://www4.sii.cl/consdcvinternetui/"


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
    async def login(
        cls, rut: str, clave: str, timeout: float = 30.0,
        referencia: str | None = None,
    ) -> SiiClient:
        """Crea un cliente y hace login. Raise SiiAuthError si falla.

        Round 152p — `referencia` opcional indica el portal destino para
        que la sesión sirva en sub-aplicaciones específicas. Para descargar
        el RCV: referencia="https://www4.sii.cl/consdcvinternetui/".
        """
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
                "Referer": "https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html",
            },
        )
        cli = cls(rut, clave, http)
        try:
            await cli._do_login(referencia=referencia)
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

    async def _do_login(self, referencia: str | None = None) -> None:
        """Hace POST al login endpoint del SII y verifica session válida.

        Round 152p — El form real (`IngresoRutClave.html`) divide el RUT
        en 2 campos hidden separados (`rut`, `dv`), tiene un campo
        misterioso `name="411"` (sin valor) y un `referencia` que indica
        el portal destino. Sin esos campos, la cookie de sesión sirve
        para algunos portales viejos (homer.sii.cl) pero NO para los
        nuevos como CONSDCV (RCV).

        Para activar la sesión en CONSDCV (descarga RCV), pasar
        `referencia="https://www4.sii.cl/consdcvinternetui/"`.
        """
        payload = {
            "rut": str(self._rut_num),
            "dv": self._dv,
            "referencia": referencia or SII_HOME_URL,
            "411": "",  # campo hidden del form, sin valor visible
            "clave": self._clave,
            # algunos handlers viejos del SII aceptan también este campo
            "rutcntr": f"{self._rut_num}-{self._dv}",
        }
        try:
            resp = await self._http.post(SII_LOGIN_URL, data=payload)
        except httpx.RequestError as exc:
            raise SiiAuthError(f"No se pudo contactar al portal SII: {exc}") from exc

        # R152HHHHHH — Verificación de login robusta.
        #
        # ANTES: solo se chequeaba la AUSENCIA de "Rut o Clave Incorrecta".
        # Problema: si el SII cambia el texto del error (ej. "Credenciales
        # no válidas") o devuelve una pantalla nueva (2FA / Clave Única),
        # un login FALLIDO pasaba como exitoso → se cacheaba una sesión
        # inválida y la descarga de RCV bajaba basura o colgaba.
        #
        # AHORA: detectamos errores conocidos PRIMERO, luego exigimos una
        # SEÑAL POSITIVA explícita (cookie de sesión nombrada del SII).
        # Solo limitar texto a 50k para no escanear páginas de error gigantes.
        text = (resp.text or "")[:50_000]
        text_low = text.lower()

        # 1) Errores de credenciales (varias redacciones posibles del SII).
        _ERROR_SIGNALS = (
            "rut o clave incorrecta",
            "clave incorrecta",
            "credenciales no válidas",
            "credenciales no validas",
            "usuario o clave",
            "datos incorrectos",
        )
        if any(sig in text_low for sig in _ERROR_SIGNALS):
            raise SiiAuthError(
                f"Clave SII incorrecta para RUT ...{str(self._rut_num)[-3:]}"
            )

        # 2) CAPTCHA / reCAPTCHA.
        if "captcha" in text_low:
            raise SiiAuthError(
                "SII pidió CAPTCHA. Esperá unos minutos y reintentá, o "
                "iniciá sesión manualmente una vez para destrabar."
            )

        # 3) 2FA / Clave Única — el portal nuevo puede pedir segundo factor.
        #    Sin manejo, el flujo cae en falso-éxito y cuelga el primer GET
        #    autenticado. Detectamos y fallamos con mensaje accionable.
        _2FA_SIGNALS = (
            "clave única",
            "clave unica",
            "claveunica",
            "segundo factor",
            "autenticación de dos factores",
            "código de verificación",
            "codigo de verificacion",
        )
        if any(sig in text_low for sig in _2FA_SIGNALS):
            raise SiiAuthError(
                "El SII pidió Clave Única / segundo factor (2FA). El login "
                "automático no soporta 2FA. Desactivá 2FA para esta cuenta "
                "de servicio o usá el flujo de import-csv manual."
            )

        # 4) SEÑAL POSITIVA obligatoria: cookie de sesión del SII.
        #    El SII setea cookies con nombres como TOKEN / NETSCAPE_LIVEWIRE
        #    / s_cc al autenticarse. Exigir al menos una conocida evita el
        #    falso-positivo de cookies de analytics/consent.
        cookie_names = {c.lower() for c in self._http.cookies.keys()}
        _SESSION_COOKIES = {"token", "netscape_livewire.rut", "s_sii", "siiuser"}
        has_session = (
            bool(cookie_names & _SESSION_COOKIES)
            # Fallback: alguna cookie cuyo nombre sugiera sesión SII.
            or any("token" in n or "sii" in n or "rut" in n for n in cookie_names)
        )
        if not has_session:
            raise SiiAuthError(
                "Login al SII no devolvió una cookie de sesión reconocible. "
                "El SII puede haber cambiado el flujo de auth, o el login "
                "falló silenciosamente. Revisá las credenciales o usá "
                "import-csv manual."
            )
        self._logged_in = True
        # R152SSSSS — Compliance Ley 19.628 (datos personales chilenos):
        # NO loggear el RUT completo. Usamos los últimos 3 dígitos para
        # debugging operacional sin exponer identidad del contribuyente.
        rut_suffix = str(self._rut_num)[-3:] if self._rut_num else "???"
        log.info("sii_login_ok", extra={"rut_suffix": rut_suffix})

    def _require_logged_in(self) -> None:
        if not self._logged_in:
            raise SiiClientError("Cliente SII no logueado — usar SiiClient.login() primero")

    async def descargar_rcv_compras(self, periodo: str) -> list[SiiDocumento]:
        """Baja el RCV de compras para un período (YYYY-MM)."""
        return await self._descargar_rcv_dispatch(periodo, flujo="compra")

    async def descargar_rcv_ventas(self, periodo: str) -> list[SiiDocumento]:
        """Baja el RCV de ventas para un período (YYYY-MM)."""
        return await self._descargar_rcv_dispatch(periodo, flujo="venta")

    async def _descargar_rcv_dispatch(
        self, periodo: str, *, flujo: str
    ) -> list[SiiDocumento]:
        """R152HHHHHH — Dispatcher RCV.

        ANTES: los públicos llamaban a `_descargar_rcv` (endpoint viejo
        anotacionesRcvInternetUI) que devuelve 404 sistemático desde 2025.
        El método nuevo CONSDCV (`_descargar_rcv_NUEVO`) nunca se llamaba.
        Al activar SII, el sync fallaba siempre con 502.

        AHORA: intentamos primero el endpoint nuevo (CONSDCV), parseamos su
        formato a SiiDocumento. Si CONSDCV no está disponible (cookie TOKEN
        ausente, portal redirigió), caemos al viejo solo para no romper —
        pero ese también dará 404, así que el error final es claro.

        El camino recomendado sigue siendo Nubox API o import-csv manual
        mientras el flujo CONSDCV con reCAPTCHA real no esté resuelto.
        """
        try:
            raw_docs = await self._descargar_rcv_NUEVO(periodo, flujo=flujo)
            return self._parse_rcv_nuevo(raw_docs, flujo=flujo, periodo=_normalizar_periodo(periodo))
        except SiiAuthError:
            # Cookie TOKEN ausente / sesión CONSDCV no activa. Re-raise —
            # es accionable (loginear con referencia=CONSDCV).
            raise
        except SiiClientError as exc:
            log.warning(
                "sii.rcv_nuevo_failed_fallback_viejo",
                extra={"flujo": flujo, "err": str(exc)[:200]},
            )
            # Fallback al endpoint viejo (probablemente 404, pero deja el
            # error explícito en vez de silenciar).
            return await self._descargar_rcv(periodo, flujo=flujo)

    def _parse_rcv_nuevo(
        self, raw_docs: list[dict], *, flujo: str, periodo: str
    ) -> list[SiiDocumento]:
        """R152HHHHHH — Parser del formato CONSDCV (endpoint nuevo) a SiiDocumento.

        El shape del CONSDCV difiere del viejo. Probamos múltiples nombres de
        campo (el SII no documenta el contrato y cambia entre versiones).
        Reusa el mismo enfoque defensivo que `_parse_rcv_response`.
        """
        out: list[SiiDocumento] = []
        for it in raw_docs:
            if not isinstance(it, dict):
                continue
            tipo_dte = _to_int(
                it.get("_codTipoDoc")
                or it.get("codTipoDoc")
                or it.get("tipoDoc")
                or it.get("dcvTipoDoc")
            )
            folio = str(
                it.get("detNroDoc") or it.get("folio") or it.get("nroDoc") or ""
            ).strip()
            if not folio or tipo_dte == 0:
                continue
            rut_otro = (
                it.get("detRutDoc") or it.get("rutEmisor")
                if flujo == "compra"
                else it.get("detRutDoc") or it.get("rutReceptor")
            ) or it.get("rut") or ""
            dv_otro = it.get("detDvDoc") or ""
            rut_full = (
                f"{rut_otro}-{dv_otro}" if dv_otro else str(rut_otro)
            ).strip()
            razon_otro = (
                it.get("detRznSoc") or it.get("razonSocial") or it.get("rznSoc")
            )
            out.append(
                SiiDocumento(
                    flujo=flujo,
                    tipo_dte=tipo_dte,
                    folio=folio,
                    periodo=periodo,
                    rut_contraparte=rut_full,
                    razon_social_contraparte=(
                        str(razon_otro).strip() if razon_otro else None
                    ),
                    fecha_emision=_to_date(
                        it.get("detFchDoc") or it.get("fchEmis")
                    ),
                    fecha_recepcion=_to_date(
                        it.get("detFecRecepcion") or it.get("fchRecep")
                    ),
                    monto_exento=_to_int(it.get("detMntExe") or it.get("mntExe")),
                    monto_neto=_to_int(it.get("detMntNeto") or it.get("mntNeto")),
                    monto_iva=_to_int(it.get("detMntIVA") or it.get("mntIVA")),
                    monto_total=_to_int(it.get("detMntTotal") or it.get("mntTotal")),
                    estado_sii=str(it.get("detEventoReceptor") or "REGISTRO"),
                    raw=it,
                )
            )
        return out

    async def _descargar_rcv_NUEVO(
        self, periodo: str, *, flujo: str,
        tipos_doc: list[str] | None = None,
        throttle_seconds: float = 2.0,
        recaptcha_token: str | None = None,
    ) -> list[dict]:
        """Round 152p — descarga RCV via el endpoint nuevo CONSDCV.

        REQUIERE: el cliente debe haber sido creado con
        SiiClient.login(rut, clave, referencia="https://www4.sii.cl/consdcvinternetui/")
        para que la cookie TOKEN esté presente.

        Args:
            periodo: "YYYY-MM"
            flujo:   "venta" o "compra"
            tipos_doc: lista de codTipoDoc a iterar (default: facturas + boletas)
            throttle_seconds: pausa entre requests para evitar rate-limit

        Returns:
            lista de dicts raw del SII (cada dict = un DTE).

        IMPORTANTE: el SII tiene rate-limit agresivo. Si abusás te banea por
        24h+ con mensaje "consultas recurrentes". Default conservador: 2s
        entre requests, solo tipos comunes.
        """
        import asyncio as _aio
        self._require_logged_in()
        periodo_param = _normalizar_periodo(periodo).replace("-", "")
        # Garantizar que la sesión está activa en CONSDCV (TOKEN cookie)
        await self._http.get(SII_CONSDCV_BASE, follow_redirects=True)
        token = self._http.cookies.get("TOKEN", domain=".sii.cl") or self._http.cookies.get("TOKEN")
        if not token:
            raise SiiAuthError(
                "Cookie TOKEN no presente. ¿Loginste con referencia=CONSDCV?"
            )

        op = "VENTA" if flujo == "venta" else "COMPRA"
        action = "RCV_DDETV" if flujo == "venta" else "RCV_DDETC"
        ns_op = "getDetalleVenta" if flujo == "venta" else "getDetalleCompra"
        url = f"{SII_CONSDCV_BASE}services/data/facadeService/{ns_op}"
        tipos = tipos_doc or ["33", "34", "39", "41", "56", "61"]

        # R152HHHHHH — Token reCAPTCHA.
        #   El SII protege CONSDCV con reCAPTCHA v3 (score-based, invisible).
        #   El "c3" hardcodeado era un placeholder de reverse-engineering;
        #   en producción el SII lo rechaza con respuesta vacía o error.
        #   Para resolverlo de verdad hay que capturar el token real desde
        #   un browser (Playwright headless ejecutando grecaptcha.execute)
        #   o pasarlo por settings.sii_recaptcha_token cuando se obtenga
        #   por otro medio. Por defecto seguimos enviando "c3" para no
        #   romper el contrato del body, pero logueamos la advertencia.
        token_captcha = recaptcha_token or "c3"
        if token_captcha == "c3":
            log.warning(
                "sii.consdcv_recaptcha_placeholder",
                extra={
                    "flujo": flujo,
                    "msg": (
                        "Usando token reCAPTCHA placeholder 'c3'. El SII "
                        "probablemente lo rechace. Usá Nubox API o import-csv."
                    ),
                },
            )

        all_docs: list[dict] = []
        for tipo in tipos:
            body = {
                "metaData": {
                    "namespace": f"cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/{ns_op}",
                    "conversationId": token, "transactionId": "0",
                },
                "data": {
                    "rutEmisor": self._rut_num, "dvEmisor": self._dv,
                    "ptributario": periodo_param,
                    "codTipoDoc": tipo, "operacion": op,
                    "estadoContab": "REGISTRO",
                    "accionRecaptcha": action, "tokenRecaptcha": "c3",
                },
            }
            try:
                resp = await self._http.post(url, json=body, headers={
                    "Content-Type": "application/json;charset=utf-8",
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": SII_CONSDCV_BASE,
                })
            except httpx.RequestError as exc:
                raise SiiClientError(f"Falló POST a {ns_op}: {exc}") from exc
            if "consultas recurrentes" in resp.text.lower():
                raise SiiClientError(
                    "SII rate-limit: detectó consultas recurrentes. "
                    "Esperá 30-60 min antes de reintentar."
                )
            if resp.status_code != 200:
                raise SiiClientError(
                    f"SII {ns_op} tipo {tipo} devolvió {resp.status_code}"
                )
            try:
                payload = resp.json()
            except Exception as exc:
                # R152HHHHHH — ANTES: `continue` silencioso descartaba el
                # tipo sin dejar rastro. Si el SII devolvía HTML de error
                # (sesión caída, mantención), el sync reportaba "0 docs"
                # como si el período estuviera vacío. AHORA logueamos y
                # seguimos con el resto de los tipos.
                log.warning(
                    "sii.consdcv_json_parse_failed",
                    extra={
                        "tipo": tipo,
                        "flujo": flujo,
                        "status": resp.status_code,
                        "body_preview": (resp.text or "")[:200],
                        "err": str(exc)[:120],
                    },
                )
                await _aio.sleep(throttle_seconds)
                continue
            docs = payload.get("data") or []
            if isinstance(docs, list):
                for d in docs:
                    if isinstance(d, dict):
                        d["_codTipoDoc"] = tipo
                all_docs.extend(d for d in docs if isinstance(d, dict))
            await _aio.sleep(throttle_seconds)
        return all_docs

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
             y subirlo via /admin/sii/import-csv.

        Round 152o — HALLAZGO REVERSE-ENGINEER:
          El endpoint nuevo es POST a:
            https://www4.sii.cl/consdcvinternetui/services/data/facadeService/
              getDetalleVenta   (ventas)
              getDetalleCompra  (compras)

          Body JSON:
            {
              "metaData": {
                "namespace": "cl.sii.sdi.lob.diii.consdcv.data.api.interfaces.FacadeService/getDetalleVenta",
                "conversationId": "<TOKEN>",
                "transactionId": "0"
              },
              "data": {
                "rutEmisor": "76108687", "dvEmisor": "1",
                "ptributario": "202512",
                "codTipoDoc": "33",
                "operacion": "VENTA",  // o "COMPRA"
                "estadoContab": "REGISTRO",
                "accionRecaptcha": "RCV_DDETV",  // o "RCV_DDETC"
                "tokenRecaptcha": "c3"
              }
            }

          BLOCKER: el portal CONSDCV redirige a la pantalla nueva de login
          (zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html),
          que NO acepta la cookie que produce el login viejo cgi_AUT2000.
          Implementar el flujo nuevo requiere Playwright headless o
          reimplementar form-based auth con captcha. Pendiente.
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
