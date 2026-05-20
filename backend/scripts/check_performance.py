"""Round 127 — Check de performance + recomendaciones de optimización.

Uso:
    python -m scripts.check_performance

Hace varias mediciones contra producción y devuelve:
    - Latencia de /health
    - Modo del pool DB
    - Workers efectivos
    - Recomendaciones top 3
"""
from __future__ import annotations

import asyncio
import json
import time

import httpx


BACKEND = "https://cehta-backend.fly.dev"


async def measure_endpoint(client: httpx.AsyncClient, path: str, n: int = 5) -> dict:
    """Mide latencia de un endpoint N veces y devuelve stats."""
    latencies: list[float] = []
    for _ in range(n):
        start = time.monotonic()
        try:
            await client.get(f"{BACKEND}{path}", timeout=10.0)
        except Exception:
            continue
        latencies.append((time.monotonic() - start) * 1000)
    if not latencies:
        return {"path": path, "ok": False}
    return {
        "path": path,
        "ok": True,
        "n": len(latencies),
        "min_ms": int(min(latencies)),
        "max_ms": int(max(latencies)),
        "avg_ms": int(sum(latencies) / len(latencies)),
    }


async def get_perf_info(client: httpx.AsyncClient) -> dict:
    """Lee /api/v1/health/perf (público, no auth)."""
    try:
        r = await client.get(f"{BACKEND}/api/v1/health/perf", timeout=10.0)
        if r.status_code == 200:
            return r.json()
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}
    return {"status_code": r.status_code, "body": r.text[:200]}


async def main() -> int:
    async with httpx.AsyncClient() as client:
        print("Midiendo latencia /health (5 muestras)...")
        health = await measure_endpoint(client, "/health", n=5)

        print("Midiendo /api/v1/health/perf (3 muestras)...")
        perf_endpoint = await measure_endpoint(client, "/api/v1/health/perf", n=3)

        print("Obteniendo metadata de /health/perf...")
        perf_info = await get_perf_info(client)

    print("\n" + "=" * 60)
    print(" REPORTE DE PERFORMANCE · Ram-Cehta")
    print("=" * 60)
    print(f"\nBackend: {BACKEND}")
    print(f"\n/health:")
    print(f"  Latencia min/avg/max: {health['min_ms']}/{health['avg_ms']}/{health['max_ms']} ms")

    print(f"\n/health/perf:")
    print(f"  Latencia min/avg/max: {perf_endpoint['min_ms']}/{perf_endpoint['avg_ms']}/{perf_endpoint['max_ms']} ms")

    if "db_pool_mode" in perf_info:
        print(f"\nConfiguración DB:")
        print(f"  Pool mode: {perf_info.get('db_pool_mode')}")
        print(f"  Pool size: {perf_info.get('db_pool_size')}")
        print(f"  Max overflow: {perf_info.get('db_max_overflow')}")
        print(f"  Workers uvicorn: {perf_info.get('workers')}")

    print("\n" + "-" * 60)
    print(" RECOMENDACIONES (orden de impacto)")
    print("-" * 60)

    recs: list[str] = []

    pool_mode = perf_info.get("db_pool_mode", "")
    if "session" in pool_mode.lower() and "QueuePool" in pool_mode:
        recs.append(
            "[ALTA/GRATIS] Migrar DATABASE_URL a transaction pooler "
            "(port 6543). Permite 60+ conexiones vs cap actual de 15. "
            "Ver docs/PERFORMANCE_OPTIMIZATION.md seccion 1."
        )

    workers = perf_info.get("workers")
    if workers == 1 and "transaction" in pool_mode.lower():
        recs.append(
            "[MEDIA/GRATIS] Subir workers uvicorn de 1 a 2. Ya estas en "
            "transaction pooler, podes. Edit fly.toml + redeploy."
        )

    if health["avg_ms"] > 500:
        recs.append(
            "[+$7/mes] Backend lento (>500ms avg). Considera subir "
            "machine a shared-cpu-2x:1024MB: `fly scale vm shared-cpu-2x "
            "--memory 1024 -a cehta-backend`"
        )

    if not recs:
        recs.append("OK - Configuracion actual esta bien para el volumen de uso.")

    for r in recs:
        print(f"\n  {r}")

    print("\n" + "=" * 60)
    print()

    return 0


if __name__ == "__main__":
    import sys
    sys.exit(asyncio.run(main()))
