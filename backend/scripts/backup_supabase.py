"""Backup manual de Supabase (reemplazo de pg_dump para tier Free).

Genera un único archivo `.sql` con:
  - Comentario header con timestamp + lista de tablas
  - INSERT INTO statements para cada fila de cada tabla en los schemas pertinentes
  - El archivo es completamente restorable con:
        psql "$DATABASE_URL" -f backup_cehta_YYYYMMDD_HHMMSS.sql

Schemas incluidos:
  - core         (todas las tablas del fondo: empresas, vouchers, funds, etc.)
  - audit        (audit_log, financial_audit)
  - public       (si tiene contenido custom)

Schemas EXCLUIDOS (Supabase los maneja automáticamente):
  - auth, storage, pgsodium, realtime, vault, extensions

Uso:
    cd backend
    python scripts/backup_supabase.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from uuid import UUID

import asyncpg

# Schemas con contenido aplicacional (los que NO maneja Supabase)
APP_SCHEMAS = ["core", "audit", "public"]

# Carpeta donde guardar los backups
BACKUP_DIR = Path("C:/Users/DELL/Documents/backups-cehta")


def _load_db_url() -> str:
    """Lee DATABASE_URL desde env o desde backend/.env."""
    url = os.getenv("DATABASE_URL")
    if not url:
        env_file = Path(__file__).resolve().parent.parent / ".env"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith("DATABASE_URL="):
                    url = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not url:
        print("ERROR: DATABASE_URL no encontrado ni en env ni en backend/.env", file=sys.stderr)
        sys.exit(1)
    # Normalizar SQLAlchemy -> asyncpg
    url = url.replace("postgresql+asyncpg://", "postgresql://")
    url = url.replace("postgres+asyncpg://", "postgresql://")
    return url


def _quote_scalar(v) -> str:
    """Serializa un valor escalar (no array, no jsonb)."""
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float, Decimal)):
        return str(v)
    if isinstance(v, (datetime, date, time)):
        return f"'{v.isoformat()}'"
    if isinstance(v, UUID):
        return f"'{v}'::uuid"
    if isinstance(v, bytes):
        return f"'\\x{v.hex()}'::bytea"
    s = str(v).replace("\\", "\\\\").replace("'", "''")
    return f"'{s}'"


def _quote_value(v, pg_type: str) -> str:
    """Convierte un valor Python a SQL literal seguro para INSERT.

    pg_type: nombre del tipo Postgres (e.g. 'text[]', 'jsonb', 'integer').
    """
    if v is None:
        return "NULL"

    # Tipos array (e.g. text[], integer[])
    if pg_type.endswith("[]"):
        if not isinstance(v, list):
            # Defensive fallback
            return _quote_scalar(v)
        if not v:
            return f"'{{}}'::{pg_type}"
        # Format as ARRAY['a','b',NULL,'c']::text[]
        elements = []
        for el in v:
            if el is None:
                elements.append("NULL")
            else:
                elements.append(_quote_scalar(el))
        return f"ARRAY[{','.join(elements)}]::{pg_type}"

    # JSONB / JSON
    if pg_type in ("jsonb", "json"):
        s = json.dumps(v, default=str).replace("'", "''")
        return f"'{s}'::{pg_type}"

    # Escalares
    return _quote_scalar(v)


async def main() -> None:
    db_url = _load_db_url()
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_file = BACKUP_DIR / f"backup_cehta_{ts}.sql"
    manifest_file = BACKUP_DIR / f"backup_cehta_{ts}_manifest.txt"

    print(f"Conectando a Supabase…")
    conn = await asyncpg.connect(db_url, timeout=30, statement_cache_size=0)

    db_version = await conn.fetchval("SELECT version()")
    print(f"  {db_version.split(',')[0]}")
    print(f"Destino: {out_file}\n")

    rows_total = 0
    tables_total = 0
    manifest_rows: list[tuple[str, str, int]] = []  # (schema, table, rowcount)

    with open(out_file, "w", encoding="utf-8") as f:
        # ============ HEADER ============
        f.write("-- ================================================================\n")
        f.write("-- Cehta Capital — Backup manual Supabase\n")
        f.write(f"-- Generado:    {datetime.now().isoformat()}\n")
        f.write(f"-- PostgreSQL:  {db_version}\n")
        f.write(f"-- Schemas:     {', '.join(APP_SCHEMAS)}\n")
        f.write("--\n")
        f.write("-- RESTORE:\n")
        f.write('--   psql "$DATABASE_URL" -f este_archivo.sql\n')
        f.write("--\n")
        f.write("-- IMPORTANTE: antes de restaurar a una DB vacía, ejecutar las\n")
        f.write("-- migraciones de backend/scripts/sql/ en orden para crear el schema.\n")
        f.write("-- Este archivo SOLO contiene DATOS (INSERT), no DDL (CREATE TABLE).\n")
        f.write("-- ================================================================\n\n")

        # Desactivar triggers durante el restore (FKs)
        f.write("SET session_replication_role = 'replica';\n\n")

        for schema in APP_SCHEMAS:
            tables = await conn.fetch(
                """
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = $1
                  AND tablename NOT LIKE '%_partition_%'
                ORDER BY tablename
                """,
                schema,
            )
            if not tables:
                continue

            f.write(f"\n-- ============================================================\n")
            f.write(f"-- SCHEMA: {schema}  ({len(tables)} tables)\n")
            f.write(f"-- ============================================================\n\n")

            for t in tables:
                table_name = t["tablename"]
                qualified = f'"{schema}"."{table_name}"'

                try:
                    rows = await conn.fetch(f"SELECT * FROM {qualified}")
                except Exception as e:
                    print(f"  [WARN] {qualified}: ERROR ({e})")
                    f.write(f"-- [WARN] ERROR backing up {qualified}: {e}\n\n")
                    continue

                row_count = len(rows)
                tables_total += 1
                rows_total += row_count
                manifest_rows.append((schema, table_name, row_count))

                f.write(f"-- Table: {qualified} ({row_count} rows)\n")
                if row_count == 0:
                    f.write("\n")
                    print(f"  {qualified}: 0")
                    continue

                cols = list(rows[0].keys())
                col_list = ", ".join(f'"{c}"' for c in cols)

                # Obtener tipo PG por columna para serializacion correcta
                type_rows = await conn.fetch(
                    """
                    SELECT column_name,
                           CASE
                               WHEN data_type = 'ARRAY' THEN
                                   regexp_replace(udt_name, '^_(.+)$', '\\1') || '[]'
                               WHEN data_type = 'USER-DEFINED' THEN udt_name
                               WHEN data_type = 'character varying' THEN 'text'
                               WHEN data_type = 'timestamp with time zone' THEN 'timestamptz'
                               WHEN data_type = 'timestamp without time zone' THEN 'timestamp'
                               WHEN data_type = 'double precision' THEN 'double precision'
                               ELSE data_type
                           END AS pg_type
                    FROM information_schema.columns
                    WHERE table_schema = $1 AND table_name = $2
                    ORDER BY ordinal_position
                    """,
                    schema,
                    table_name,
                )
                col_types = {r["column_name"]: r["pg_type"] for r in type_rows}

                # Batch INSERTs en grupos de 100
                for i in range(0, row_count, 100):
                    batch = rows[i : i + 100]
                    f.write(f"INSERT INTO {qualified} ({col_list}) VALUES\n")
                    value_lines = []
                    for row in batch:
                        vals = [_quote_value(row[c], col_types.get(c, "text")) for c in cols]
                        value_lines.append(f"  ({', '.join(vals)})")
                    f.write(",\n".join(value_lines))
                    f.write(";\n")
                f.write("\n")
                print(f"  {qualified}: {row_count}")

        # ============ FOOTER ============
        f.write("\n-- Restaurar triggers normales\n")
        f.write("SET session_replication_role = 'origin';\n")
        f.write(f"\n-- Backup completado: {datetime.now().isoformat()}\n")
        f.write(f"-- Total tablas: {tables_total}, total filas: {rows_total}\n")

    await conn.close()

    # ============ MANIFEST ============
    with open(manifest_file, "w", encoding="utf-8") as mf:
        mf.write(f"Cehta Capital — Backup Manifest\n")
        mf.write(f"Timestamp: {ts}\n")
        mf.write(f"File:      {out_file.name}\n")
        mf.write(f"Tables:    {tables_total}\n")
        mf.write(f"Rows:      {rows_total}\n\n")
        mf.write(f"{'Schema':<10} {'Table':<45} {'Rows':>10}\n")
        mf.write("-" * 67 + "\n")
        for schema, table, count in manifest_rows:
            mf.write(f"{schema:<10} {table:<45} {count:>10,}\n")

    size_mb = out_file.stat().st_size / 1024 / 1024

    print("\n" + "=" * 60)
    print(f"[OK] BACKUP COMPLETADO")
    print("=" * 60)
    print(f"  Archivo:   {out_file}")
    print(f"  Manifest:  {manifest_file.name}")
    print(f"  Tablas:    {tables_total}")
    print(f"  Filas:     {rows_total:,}")
    print(f"  Tamaño:    {size_mb:.2f} MB")
    print()
    print(f"  PARA RESTAURAR EN UN NUEVO SUPABASE:")
    print(f'    1. Aplicar migraciones en backend/scripts/sql/ (en orden)')
    print(f'    2. psql "<NUEVA_DATABASE_URL>" -f "{out_file}"')


if __name__ == "__main__":
    asyncio.run(main())
