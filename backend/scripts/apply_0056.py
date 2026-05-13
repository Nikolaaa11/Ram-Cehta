"""Apply migration 0056 manually (logo_dropbox_path column).

Usage on Fly: flyctl ssh console -a cehta-backend -C "python scripts/apply_0056.py"
Idempotente — ADD COLUMN IF NOT EXISTS + actualiza alembic_version a 0056.
"""
from __future__ import annotations

import asyncio
import os


async def main() -> None:
    import asyncpg

    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    conn = await asyncpg.connect(url)
    try:
        await conn.execute(
            "ALTER TABLE core.empresas ADD COLUMN IF NOT EXISTS logo_dropbox_path TEXT"
        )
        # Bump alembic_version a 0056 (single-row tracking)
        await conn.execute("UPDATE alembic_version SET version_num = '0056'")
        head = await conn.fetchval("SELECT version_num FROM alembic_version")
        has_col = await conn.fetchval(
            """
            SELECT EXISTS(
              SELECT 1 FROM information_schema.columns
              WHERE table_schema='core' AND table_name='empresas'
                AND column_name='logo_dropbox_path'
            )
            """
        )
        print(f"alembic_version={head} logo_dropbox_path_exists={has_col}")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
