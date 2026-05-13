"""Habilita TODAS las cuentas del plan para CEHTA (staff operativo).

El importer standard solo habilita las 9 empresas del portfolio (CSL, RHO,
DTE, REVTECH, EVOQUE, TRONGKAI, AFIS, FIP_CEHTA, CENERGY). CEHTA es la
empresa staff y queda fuera del map del importer — por eso le faltaban
las 65 cuentas de niveles 1-3 (grupos/subgrupos/mayores).

Idempotente: UPSERT.
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
        # UPSERT para todas las cuentas del plan, habilitarlas para CEHTA.
        result = await conn.execute(
            """
            INSERT INTO core.plan_cuenta_empresa (
                cuenta_codigo, empresa_codigo, habilitada
            )
            SELECT codigo, 'CEHTA', TRUE
            FROM core.plan_cuentas
            ON CONFLICT (cuenta_codigo, empresa_codigo) DO UPDATE
                SET habilitada = TRUE,
                    habilitada_en = now()
            """
        )
        print(f"upsert result: {result}")

        # Verificar
        count = await conn.fetchval(
            "SELECT COUNT(*) FROM core.plan_cuenta_empresa "
            "WHERE empresa_codigo = 'CEHTA' AND habilitada"
        )
        print(f"CEHTA habilitaciones (habilitada=TRUE): {count}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
