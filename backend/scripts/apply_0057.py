"""Apply migration 0057 manually (perf indices marcha blanca).

Usage on Fly:
    flyctl ssh sftp put scripts/apply_0057.py /app/scripts/apply_0057.py -a cehta-backend
    flyctl ssh console -a cehta-backend -C "python /app/scripts/apply_0057.py"

Idempotente — CREATE INDEX IF NOT EXISTS.
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
        # Indice parcial movimientos
        print("Creando idx_movimientos_saldos_real...")
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_movimientos_saldos_real
            ON core.movimientos (empresa_codigo, banco, fecha DESC, movimiento_id DESC)
            WHERE real_proyectado = 'Real'
              AND saldo_contable IS NOT NULL
            """
        )
        print("  OK")

        # Indice attachments
        print("Creando idx_voucher_attachments_voucher_uploaded...")
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_voucher_attachments_voucher_uploaded
            ON core.voucher_attachments (voucher_id, uploaded_at ASC)
            """
        )
        print("  OK")

        # Bump alembic version
        await conn.execute(
            "UPDATE alembic_version SET version_num = '0057'"
        )
        head = await conn.fetchval(
            "SELECT version_num FROM alembic_version"
        )
        print(f"alembic_version actualizado a: {head}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
