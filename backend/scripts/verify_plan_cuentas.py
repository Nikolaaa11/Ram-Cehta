"""Quick check del estado del plan de cuentas en la DB.

Uso en Fly:
    flyctl ssh sftp put scripts/verify_plan_cuentas.py /app/scripts/verify_plan_cuentas.py -a cehta-backend
    flyctl ssh console -a cehta-backend -C "python /app/scripts/verify_plan_cuentas.py"
"""
from __future__ import annotations

import asyncio
import os


async def main() -> None:
    import asyncpg

    url = os.environ["DATABASE_URL"].replace(
        "postgresql+asyncpg://", "postgresql://"
    )
    conn = await asyncpg.connect(url)
    try:
        total = await conn.fetchval("SELECT COUNT(*) FROM core.plan_cuentas")
        print(f"plan_cuentas_total={total}")

        rows = await conn.fetch(
            """
            SELECT tipo, COUNT(*) AS n
            FROM core.plan_cuentas
            GROUP BY tipo
            ORDER BY tipo
            """
        )
        for r in rows:
            print(f"tipo {r['tipo']}: {r['n']}")

        rows = await conn.fetch(
            """
            SELECT empresa_codigo, COUNT(*) AS n
            FROM core.plan_cuenta_empresa
            WHERE habilitada
            GROUP BY empresa_codigo
            ORDER BY empresa_codigo
            """
        )
        print("habilitaciones por empresa:")
        for r in rows:
            print(f"  {r['empresa_codigo']}: {r['n']}")

        # Muestra primeras 5 subcuentas como sanity check
        rows = await conn.fetch(
            """
            SELECT codigo, nombre, tipo
            FROM core.plan_cuentas
            WHERE nivel = 4
            ORDER BY codigo
            LIMIT 5
            """
        )
        print("primeras 5 subcuentas:")
        for r in rows:
            print(f"  {r['codigo']} ({r['tipo']}): {r['nombre']}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
