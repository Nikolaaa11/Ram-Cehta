"""Round 123 — Cliente HTTP para el portal de Nubox.

DESCLAIMER IMPORTANTE:
  Nubox NO tiene API pública. Este cliente intenta hacer scraping del
  portal web (https://web.nubox.com). El portal usa autenticación con
  tokens dinámicos JavaScript-side, así que un cliente httpx puro puede
  fallar el primer intento.

  Si la auto-sync no funciona, el operador SIEMPRE puede usar el flujo
  manual: bajar el Libro de Remuneraciones desde Nubox a mano y subirlo
  via /admin/nubox/import-excel (Round 123 también).

  Este scaffolding se diseña para ser fácil de iterar — los URLs y
  selectores están centralizados arriba del archivo.

Estado al 2026-05: NO PROBADO con cuenta real. El operador debe correr
`POST /admin/nubox/test-login/{empresa}` para validar.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Any

import httpx

log = logging.getLogger(__name__)


# URLs del portal Nubox — pueden cambiar sin previo aviso.
NUBOX_BASE = "https://web.nubox.com"
NUBOX_LOGIN_URL = f"{NUBOX_BASE}/Sitio/Login"
NUBOX_REMUNERACIONES_BASE = f"{NUBOX_BASE}/Remuneraciones"
# Posibles paths para reporte (varían según versión Nubox):
NUBOX_LIBRO_REPORT_PATHS = [
    "/Reportes/LibroRemuneraciones",
    "/Liquidaciones/Libro",
]


class NuboxClientError(Exception):
    """Error genérico del cliente Nubox."""


class NuboxAuthError(NuboxClientError):
    """Login falló — credenciales incorrectas, captcha, o portal caído."""


class NuboxClient:
    """Cliente con sesión activa al portal Nubox.

    Uso:
        cli = await NuboxClient.login(rut, clave)
        try:
            data = await cli.descargar_libro_remuneraciones("2026-04")
        finally:
            await cli.close()
    """

    def __init__(self, rut: str, clave: str, http: httpx.AsyncClient) -> None:
        self._rut = rut
        self._clave = clave  # NUNCA loguear
        self._http = http
        self._logged_in = False

    @classmethod
    async def login(cls, rut: str, clave: str, timeout: float = 30.0) -> NuboxClient:
        """Hace login al portal Nubox. Raise NuboxAuthError si falla."""
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

    async def close(self) -> None:
        await self._http.aclose()

    async def _do_login(self) -> None:
        """Login flow:
        1. GET /Sitio/Login → recolectar tokens hidden (CSRF, ViewState si ASP)
        2. POST /Sitio/Login con rut + clave + tokens → cookies de sesión
        3. Verificar redirect a dashboard o presencia de 'Cerrar sesión'.
        """
        # 1. Fetch login page para tokens hidden
        try:
            resp = await self._http.get(NUBOX_LOGIN_URL)
        except httpx.RequestError as exc:
            raise NuboxAuthError(f"No se pudo contactar Nubox: {exc}") from exc

        if resp.status_code != 200:
            raise NuboxAuthError(
                f"GET login devolvió {resp.status_code}. "
                f"El portal puede estar caído."
            )

        # Extraer __VIEWSTATE / __EVENTVALIDATION / __RequestVerificationToken
        # (Nubox usa ASP.NET tradicional)
        hidden_tokens = self._extract_hidden_fields(resp.text)

        # 2. POST login con credenciales + tokens
        payload = {
            "rut": self._rut,
            "clave": self._clave,
            "password": self._clave,  # algunos forms usan 'password'
            "Login": "Ingresar",
            **hidden_tokens,
        }
        try:
            post_resp = await self._http.post(
                NUBOX_LOGIN_URL,
                data=payload,
                headers={"Referer": NUBOX_LOGIN_URL},
            )
        except httpx.RequestError as exc:
            raise NuboxAuthError(f"POST login falló: {exc}") from exc

        text = (post_resp.text or "")[:80_000]
        text_low = text.lower()

        # 3. Detectar errores conocidos PRIMERO (varias redacciones).
        _ERROR_SIGNALS = (
            "clave incorrecta",
            "clave es incorrecta",
            "credenciales incorrectas",
            "usuario o clave",
            "datos incorrectos",
            "rut o clave",
        )
        if any(sig in text_low for sig in _ERROR_SIGNALS) or (
            "clave" in text_low and ("incorrecta" in text_low or "invalid" in text_low)
        ):
            raise NuboxAuthError("Credenciales Nubox incorrectas")
        if "captcha" in text_low:
            raise NuboxAuthError(
                "Nubox pidió CAPTCHA. Loguear manualmente una vez para destrabar."
            )

        # R152HHHHHH — 2FA / verificación en dos pasos.
        _2FA_SIGNALS = (
            "código de verificación",
            "codigo de verificacion",
            "segundo factor",
            "doble factor",
            "verificación en dos pasos",
            "verificacion en dos pasos",
            "autenticación de dos",
        )
        if any(sig in text_low for sig in _2FA_SIGNALS):
            raise NuboxAuthError(
                "Nubox pidió verificación en dos pasos (2FA). El login "
                "automático no la soporta. Usá el fallback de upload de Excel."
            )

        # 4. R152HHHHHH — Verificación POSITIVA, no solo ausencia de error.
        #    ANTES: cualquier cookie + ausencia del form de login contaba
        #    como éxito → un cambio de copy del portal pasaba un login
        #    fallido como bueno y la descarga bajaba HTML basura.
        #    AHORA exigimos al menos una señal positiva real:
        #      (a) la URL final ya NO es la página de login, o
        #      (b) el HTML muestra un marcador de sesión iniciada, o
        #      (c) hay una cookie con pinta de sesión (auth/session/.aspxauth).
        final_url = str(post_resp.url).lower()
        left_login_page = "/sitio/login" not in final_url
        _SUCCESS_MARKERS = (
            "cerrar sesión",
            "cerrar sesion",
            "mi cuenta",
            "remuneraciones",
            "seleccione empresa",
            "menú principal",
            "menu principal",
        )
        has_success_marker = any(m in text_low for m in _SUCCESS_MARKERS)
        cookie_names = {c.lower() for c in self._http.cookies.keys()}
        has_session_cookie = any(
            tok in n
            for n in cookie_names
            for tok in ("auth", "session", "sesion", ".aspxauth", "nubox")
        )
        still_on_login_form = (
            "ingresar" in text_low
            and "clave" in text_low
            and not has_success_marker
        )

        if still_on_login_form and not left_login_page:
            raise NuboxAuthError(
                "Login no avanzó (sigue en la pantalla de ingreso). El portal "
                "puede haber cambiado el flow de auth. Usá el fallback de Excel."
            )
        if not (left_login_page or has_success_marker or has_session_cookie):
            raise NuboxAuthError(
                "Login Nubox sin señal de sesión iniciada. Verificá credenciales "
                "o usá el fallback de upload de Excel."
            )

        self._logged_in = True
        # R152SSSSS — Compliance Ley 19.628: no loggear RUT completo.
        rut_suffix = str(self._rut)[-3:] if self._rut else "???"
        log.info("nubox_login_ok", extra={"rut_suffix": rut_suffix})

    @staticmethod
    def _extract_hidden_fields(html: str) -> dict[str, str]:
        """Extrae __VIEWSTATE, __EVENTVALIDATION, __RequestVerificationToken, etc.

        Nubox usa ASP.NET Web Forms en partes del portal, así que estos
        campos hidden son obligatorios en el POST.
        """
        out: dict[str, str] = {}
        # R152HHHHHH — Parse tolerante al orden de atributos.
        #   ANTES: un único regex exigía `type="hidden" ... name=... value=...`
        #   EN ESE ORDEN. ASP.NET MVC suele emitir `name=... value=...` sin
        #   `type="hidden"` explícito en el token CSRF, y a veces invierte
        #   name/value → el regex no matcheaba y el POST iba sin token → 403.
        #   AHORA: iteramos cada tag <input>, y dentro extraemos name y value
        #   por separado (orden indiferente).
        attr_name = re.compile(r'\bname=["\']([^"\']+)["\']', re.IGNORECASE)
        attr_value = re.compile(r'\bvalue=["\']([^"\']*)["\']', re.IGNORECASE)
        input_tag = re.compile(r"<input\b[^>]*>", re.IGNORECASE)
        for tag in input_tag.finditer(html):
            chunk = tag.group(0)
            nm = attr_name.search(chunk)
            if not nm:
                continue
            name = nm.group(1)
            # Solo tokens conocidos para evitar inyectar basura
            if not (name.startswith("__") or "Token" in name or "Csrf" in name):
                continue
            vm = attr_value.search(chunk)
            out[name] = vm.group(1) if vm else ""
        return out

    async def descargar_libro_remuneraciones(
        self, periodo: str
    ) -> bytes:
        """Intenta bajar el Libro de Remuneraciones como bytes (xlsx).

        Si Nubox devuelve XLSX directamente, retorna los bytes. El llamador
        después usa nubox_excel_parser.parse_libro_remuneraciones() para
        convertir a dicts.

        NOTA: este endpoint es speculative — la URL exacta y query params
        varían según la versión del portal. Si falla, capturar el error y
        sugerir al user usar el flujo manual de upload.
        """
        if not self._logged_in:
            raise NuboxClientError("Cliente no logueado")

        periodo_clean = periodo.replace("-", "")
        session_expired = False
        for path in NUBOX_LIBRO_REPORT_PATHS:
            url = f"{NUBOX_REMUNERACIONES_BASE}{path}"
            try:
                resp = await self._http.get(
                    url,
                    params={"periodo": periodo_clean, "formato": "xlsx"},
                    headers={"Accept": "application/octet-stream"},
                )
            except httpx.RequestError as exc:
                log.warning("nubox_report_path_failed",
                            extra={"path": path, "error": str(exc)})
                continue

            ctype = resp.headers.get("content-type", "")
            if resp.status_code == 200 and ctype.startswith((
                "application/vnd.openxmlformats",
                "application/octet-stream",
            )):
                return resp.content

            # R152HHHHHH — distinguir "ruta equivocada" de "sesión caída".
            #   Si nos devuelven HTML (login) con 200/302, la sesión expiró:
            #   no tiene sentido seguir probando rutas, mejor avisar claro.
            if "text/html" in ctype.lower():
                body_low = (resp.text or "")[:5_000].lower()
                if any(m in body_low for m in ("iniciar sesión", "login", "ingresar", "clave")):
                    session_expired = True
                    log.warning(
                        "nubox_report_session_expired",
                        extra={"path": path, "status": resp.status_code},
                    )
                    break
            log.warning(
                "nubox_report_unexpected_response",
                extra={"path": path, "status": resp.status_code, "ctype": ctype},
            )

        if session_expired:
            raise NuboxAuthError(
                "La sesión Nubox expiró durante la descarga. Reintentá el "
                "login, o bajá el Libro manualmente y subilo via "
                "/admin/nubox/import-excel."
            )
        raise NuboxClientError(
            "No se pudo descargar el Libro de Remuneraciones automáticamente. "
            "Bajalo manualmente desde Nubox y subilo via /admin/nubox/import-excel."
        )


# =====================================================================
# High-level helper para test de conexión (no levanta)
# =====================================================================


async def test_login(rut: str, clave: str, timeout: float = 30.0) -> dict[str, Any]:
    """Intenta login y devuelve dict con resultado. NO levanta."""
    try:
        cli = await asyncio.wait_for(
            NuboxClient.login(rut, clave, timeout=timeout),
            timeout=timeout,
        )
        await cli.close()
        return {"ok": True, "message": "Login Nubox exitoso"}
    except NuboxAuthError as exc:
        return {"ok": False, "message": str(exc), "error_type": "auth"}
    except NuboxClientError as exc:
        return {"ok": False, "message": str(exc), "error_type": "client"}
    except asyncio.TimeoutError:
        return {"ok": False, "message": "Timeout al portal Nubox", "error_type": "timeout"}
    except Exception as exc:  # noqa: BLE001
        return {"ok": False, "message": f"Error: {exc}", "error_type": "unknown"}
