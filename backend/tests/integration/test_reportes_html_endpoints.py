"""Integration tests para los 8 endpoints HTML de reportes contables (V5++).

Verifica que cada endpoint:
  1. Sin auth → 401
  2. Con auth admin → 200 + Content-Type: text/html
  3. HTML válido (contiene <!DOCTYPE html> + <body>)
  4. Aún con DB vacía (sin vouchers/movimientos) renderea sin crashear

Estos endpoints se usan tanto en /reportes/contables UI como en links
directos (compartibles, archivables como PDF). Es crítico que NUNCA
devuelvan 500 con DB vacía — un cliente cargando el primer mes del año
debe ver "Sin movimientos" no un crash.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

pytestmark = pytest.mark.integration


# Lista canónica de endpoints HTML nuevos en V5+/V5++
ENDPOINTS_HTML = [
    {
        "url": "/api/v1/reportes/contables/libro-diario.html"
        "?empresa_codigo=TRONGKAI&fecha_desde=2026-01-01&fecha_hasta=2026-12-31",
        "label": "libro-diario",
    },
    {
        "url": "/api/v1/reportes/contables/balance-prueba.html"
        "?empresa_codigo=TRONGKAI&fecha_desde=2026-01-01&fecha_hasta=2026-12-31",
        "label": "balance-prueba",
    },
    {
        "url": "/api/v1/reportes/contables/cierre-mensual.html"
        "?empresa_codigo=TRONGKAI&anio=2026&mes=4",
        "label": "cierre-mensual",
    },
    {
        "url": "/api/v1/reportes/contables/cashflow-mensual.html"
        "?empresa_codigo=TRONGKAI&anio=2026",
        "label": "cashflow-mensual",
    },
    {
        "url": "/api/v1/reportes/contables/pl-mensual.html"
        "?empresa_codigo=TRONGKAI&anio=2026",
        "label": "pl-mensual",
    },
    {
        "url": "/api/v1/reportes/contables/estado-resultados.html"
        "?empresa_codigo=TRONGKAI&anio=2026",
        "label": "estado-resultados",
    },
    {
        "url": "/api/v1/reportes/contables/balance-general.html"
        "?empresa_codigo=TRONGKAI&fecha_corte=2026-12-31",
        "label": "balance-general",
    },
    {
        "url": "/api/v1/reportes/contables/consolidado-fondo.html?anio=2026",
        "label": "consolidado-fondo",
    },
]


class TestNoAuth:
    """Sin token, todos los endpoints deben rechazar con 401."""

    @pytest.mark.parametrize(
        "endpoint", ENDPOINTS_HTML, ids=lambda e: e["label"]
    )
    async def test_returns_401_without_auth(
        self, test_client_with_db: AsyncClient, endpoint: dict
    ) -> None:
        response = await test_client_with_db.get(endpoint["url"])
        assert response.status_code == 401, (
            f"{endpoint['label']} debe rechazar sin auth"
        )


class TestAdminCanRead:
    """Admin puede acceder y recibe HTML válido."""

    @pytest.mark.parametrize(
        "endpoint", ENDPOINTS_HTML, ids=lambda e: e["label"]
    )
    async def test_admin_gets_html_200(
        self,
        test_client_with_db: AsyncClient,
        auth_headers: dict[str, str],
        endpoint: dict,
    ) -> None:
        response = await test_client_with_db.get(
            endpoint["url"], headers=auth_headers
        )
        assert response.status_code == 200, (
            f"{endpoint['label']} debe devolver 200 con auth admin "
            f"(got {response.status_code}: {response.text[:200]})"
        )
        assert "text/html" in response.headers.get("content-type", "")

    @pytest.mark.parametrize(
        "endpoint", ENDPOINTS_HTML, ids=lambda e: e["label"]
    )
    async def test_html_is_well_formed(
        self,
        test_client_with_db: AsyncClient,
        auth_headers: dict[str, str],
        endpoint: dict,
    ) -> None:
        response = await test_client_with_db.get(
            endpoint["url"], headers=auth_headers
        )
        assert response.status_code == 200
        html = response.text
        assert "<!DOCTYPE html>" in html
        assert "<body>" in html or "<body " in html
        # CSS @media print embedido (signature de los reportes V5++)
        assert "@media print" in html or "@page" in html

    @pytest.mark.parametrize(
        "endpoint", ENDPOINTS_HTML, ids=lambda e: e["label"]
    )
    async def test_html_renders_with_empty_db(
        self,
        test_client_with_db: AsyncClient,
        auth_headers: dict[str, str],
        endpoint: dict,
    ) -> None:
        """DB vacía (sin vouchers ni movimientos) — HTML no debe crashear."""
        response = await test_client_with_db.get(
            endpoint["url"], headers=auth_headers
        )
        assert response.status_code == 200
        # Espera ver al menos el header del reporte (eyebrow + title)
        assert "Cehta" in response.text or "FIP CEHTA" in response.text


class TestPrintQueryParam:
    """`?print=1` agrega script de auto-print al HTML."""

    async def test_print_param_includes_window_print_script(
        self,
        test_client_with_db: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        url = (
            "/api/v1/reportes/contables/libro-diario.html"
            "?empresa_codigo=TRONGKAI"
            "&fecha_desde=2026-01-01&fecha_hasta=2026-12-31&print=1"
        )
        response = await test_client_with_db.get(url, headers=auth_headers)
        assert response.status_code == 200
        # El template wrap inyecta el script con check de print=1
        assert "window.print" in response.text


class TestVoucherHtml:
    """GET /vouchers/{id}.html — voucher individual imprimible."""

    async def test_voucher_404_for_missing(
        self,
        test_client_with_db: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        # voucher_id 999999 no existe
        response = await test_client_with_db.get(
            "/api/v1/vouchers/999999.html", headers=auth_headers
        )
        assert response.status_code == 404

    async def test_voucher_html_unauth_returns_401(
        self, test_client_with_db: AsyncClient
    ) -> None:
        response = await test_client_with_db.get("/api/v1/vouchers/1.html")
        assert response.status_code == 401
