"""R152QQQQQ · Smoke tests E2E contra producción.

Objetivo: detectar regresiones graves dentro de los 2 minutos posteriores
a un deploy. Si alguno de estos tests falla, hay un problema serio que
requiere rollback inmediato.

Filosofía:
    - SOLO read-only. NUNCA mutamos data en producción.
    - Idempotentes — se pueden correr 100 veces sin efectos.
    - Rápidos — todo el suite debe completar en <30s.
    - Pocos tests, pero los que importan.

Si un test falla:
    - Health: backend está down. Rollback inmediato vía `fly releases rollback`.
    - Admin auth: el JWT venció o falló la verificación Supabase.
    - Perf-stats: el deploy R152NNNNN no quedó vivo.
    - Feature-usage: el deploy R152PPPPP no quedó vivo o falta migración SQL.
    - Listings: hay un bug en queries o falló el connection pool.

Cómo correr localmente:
    cd backend
    export SMOKE_BASE_URL="https://cehta-backend.fly.dev"
    export SMOKE_ADMIN_JWT="<tu-jwt-de-admin>"
    pytest tests/e2e/ -v

Cómo correr en CI:
    Ver .github/workflows/smoke-backend-prod.yml
"""
from __future__ import annotations

import time

import pytest
import requests


# ============================================================================
# Tests no-auth — validan que el backend responde
# ============================================================================


def test_liveness_endpoint(base_url: str, timeout: int) -> None:
    """GET / o /health debe responder 200 — confirma que uvicorn está vivo."""
    r = requests.get(f"{base_url}/health", timeout=timeout)
    assert r.status_code == 200, (
        f"Liveness check falló (status {r.status_code}). "
        f"Backend está caído. Revisar `fly status -a cehta-backend`."
    )
    body = r.json()
    assert body.get("status") == "alive", f"Liveness body inesperado: {body}"


def test_root_endpoint(base_url: str, timeout: int) -> None:
    """GET / debe devolver service name (smoke test mínimo)."""
    r = requests.get(f"{base_url}/", timeout=timeout)
    assert r.status_code == 200, f"Root endpoint falló: {r.status_code}"
    body = r.json()
    assert "service" in body, f"Root body inesperado: {body}"


def test_api_health_endpoint(base_url: str, timeout: int) -> None:
    """GET /api/v1/health — health check del router v1 (incluye DB ping)."""
    r = requests.get(f"{base_url}/api/v1/health", timeout=timeout)
    assert r.status_code == 200, (
        f"API health check falló (status {r.status_code}). "
        f"Probablemente Supabase está caído o las credenciales son inválidas."
    )


def test_openapi_docs_available(base_url: str, timeout: int) -> None:
    """GET /openapi.json — confirma que la spec OpenAPI sigue exponiéndose."""
    r = requests.get(f"{base_url}/openapi.json", timeout=timeout)
    assert r.status_code == 200, f"OpenAPI spec no disponible: {r.status_code}"
    spec = r.json()
    assert "paths" in spec, "OpenAPI spec malformada"
    # Sanity check: debe haber al menos algunos endpoints registrados
    assert len(spec["paths"]) > 20, (
        f"Solo {len(spec['paths'])} endpoints — algo se perdió en el deploy"
    )


def test_cors_headers_present(base_url: str, timeout: int) -> None:
    """OPTIONS preflight con origin Vercel debe responder con CORS headers.

    Si esto falla, los browsers del frontend van a tirar 'CORS error' y la
    app se ve rota aunque el backend funcione.
    """
    r = requests.options(
        f"{base_url}/api/v1/health",
        headers={
            "Origin": "https://cehta-capital.vercel.app",
            "Access-Control-Request-Method": "GET",
        },
        timeout=timeout,
    )
    # Status puede ser 200 o 204 según el middleware — ambos son OK
    assert r.status_code in (200, 204), (
        f"CORS preflight falló: {r.status_code}. "
        f"El frontend NO va a poder hablar con el backend."
    )
    assert "access-control-allow-origin" in {
        k.lower() for k in r.headers
    }, "Header CORS faltante en preflight"


# ============================================================================
# Tests auth — validan que un admin puede consultar endpoints sensibles
# ============================================================================


def test_admin_perf_stats_authorized(
    base_url: str, auth_headers: dict, timeout: int
) -> None:
    """GET /api/v1/admin/perf-stats con JWT admin debe devolver 200.

    Valida que:
      - El JWT se está verificando correctamente.
      - El deploy de R152NNNNN sigue vivo.
      - El cache de empresas funciona.
    """
    r = requests.get(
        f"{base_url}/api/v1/admin/perf-stats",
        headers=auth_headers,
        timeout=timeout,
    )
    assert r.status_code == 200, (
        f"Perf-stats falló con status {r.status_code}. "
        f"Body: {r.text[:300]}"
    )
    body = r.json()
    assert "catalog_cache" in body, f"Estructura inesperada: {body.keys()}"
    assert "db_pool" in body, f"Estructura inesperada: {body.keys()}"


def test_admin_feature_usage_authorized(
    base_url: str, auth_headers: dict, timeout: int
) -> None:
    """GET /api/v1/admin/feature-usage con JWT admin debe devolver 200.

    Valida que el deploy R152PPPPP esté vivo + la migración SQL aplicada.
    Si esto falla con 500, probablemente falta correr round152PPPPP_feature_usage.sql
    en Supabase.
    """
    r = requests.get(
        f"{base_url}/api/v1/admin/feature-usage",
        headers=auth_headers,
        timeout=timeout,
    )
    assert r.status_code == 200, (
        f"Feature-usage falló con status {r.status_code}. "
        f"Body: {r.text[:300]}\n"
        f"¿Aplicaste round152PPPPP_feature_usage.sql en Supabase?"
    )
    body = r.json()
    assert "top_20_most_used" in body
    assert "bottom_20_least_used" in body
    assert "totals" in body


def test_admin_only_endpoint_rejects_no_auth(
    base_url: str, timeout: int
) -> None:
    """Sin Authorization header, los endpoints admin deben rechazar (401/403).

    Esto es un test de SEGURIDAD: si pasa 200 sin auth, hay un bug crítico
    de privilegios.
    """
    r = requests.get(
        f"{base_url}/api/v1/admin/perf-stats",
        timeout=timeout,
    )
    assert r.status_code in (401, 403), (
        f"🚨 ALERTA SEGURIDAD: /admin/perf-stats devolvió {r.status_code} "
        f"sin auth. Debería ser 401 o 403. ROLLBACK INMEDIATO."
    )


# ============================================================================
# Test de performance — el backend no debe estar lento
# ============================================================================


def test_backend_responds_under_3_seconds(
    base_url: str, timeout: int
) -> None:
    """Después de un warm-up, el health endpoint debe responder en <3s.

    Si tarda más, hay un problema serio: cold start crónico, pool saturado,
    o DB lenta. 3s es generoso pero detecta problemas reales.
    """
    # Warm-up — descartar primera request por cold start de Fly
    requests.get(f"{base_url}/health", timeout=timeout)

    t0 = time.monotonic()
    r = requests.get(f"{base_url}/api/v1/health", timeout=timeout)
    elapsed = time.monotonic() - t0

    assert r.status_code == 200, "Health falló en test de perf"
    assert elapsed < 3.0, (
        f"API health tardó {elapsed:.2f}s (>3s). "
        f"Investigar Fly logs, Supabase status, pool stats."
    )


# ============================================================================
# Smoke "summary" — meta-test que reporta versión + estado general
# ============================================================================


def test_summary_print(base_url: str, timeout: int, capsys) -> None:
    """No es un test funcional — solo imprime estado para el CI log.

    R152RRRRR — Aseguro que SI o SI haya un assert, sino pytest lo marca
    como 'no assert' en warning. Validamos que el body tenga lo esperado.
    """
    r = requests.get(f"{base_url}/", timeout=timeout)
    body = r.json()
    assert "service" in body
    assert "version" in body
    print(f"\n{'='*60}")
    print(f"Backend smoke tests OK")
    print(f"Service: {body.get('service')}")
    print(f"Version: {body.get('version')}")
    print(f"URL: {base_url}")
    print(f"{'='*60}\n")
