"""Round 130 — Aplicador batch de migraciones SQL pendientes.

Reemplaza el paso manual de "copiar/pegar cada archivo SQL en Supabase
Studio" por UN SOLO COMANDO local.

USO:
    cd backend
    python -m scripts.apply_pending_migrations

EFECTO:
    Lee los .sql en scripts/sql/round{NNN}_*.sql, los aplica en orden a
    DATABASE_URL, y reporta qué hizo. IDEMPOTENTE: chequea si la tabla
    representativa de cada round ya existe; si sí, skip.

SEGURIDAD:
    - Solo aplica los archivos del directorio scripts/sql/ del repo
    - No acepta SQL arbitrario por stdin/env
    - Cada migración corre en una transacción independiente
    - Si una falla, las siguientes NO se ejecutan (fail-fast)
    - Connection con sslmode=require (Supabase)

REQUISITOS:
    - DATABASE_URL en backend/.env (formato Postgres directo o session pooler)
    - psycopg2 instalado (ya está en deps)
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(Path(__file__).parent.parent / ".env")

url_raw = os.getenv("DATABASE_URL", "")
if not url_raw:
    print("✗ DATABASE_URL no configurada en backend/.env")
    sys.exit(1)

# Convertir +asyncpg → +psycopg2 (este script es sync)
url = re.sub(r"\+asyncpg|\+psycopg(?!2)", "+psycopg2", url_raw)
# Si la URL es transaction pooler (port 6543), usar driver normal sin prep stmts
is_txn_pooler = ":6543" in url

# Round → (archivo SQL, tabla canónica para detección de "ya aplicada")
# Si la tabla existe, el round se considera aplicado y se skipea.
MIGRATIONS = [
    ("115", "round115_migration.sql", ("core", "empresa_credenciales")),
    ("117", "round117_sii_migration.sql", ("core", "sii_documentos")),
    ("123", "round123_nubox_migration.sql", ("core", "nubox_remuneraciones")),
    ("124", "round124_nubox_api_migration.sql", ("core", "nubox_api_credenciales")),
    ("126", "round126_monitor_migration.sql", ("core", "system_health_checks")),
]


def table_exists(conn, schema: str, table: str) -> bool:
    row = conn.execute(
        text(
            """
            SELECT EXISTS (
                SELECT 1 FROM information_schema.tables
                WHERE table_schema = :s AND table_name = :t
            )
            """
        ),
        {"s": schema, "t": table},
    ).fetchone()
    return bool(row[0])


def run() -> int:
    sql_dir = Path(__file__).parent / "sql"
    if not sql_dir.exists():
        print(f"✗ Directorio no existe: {sql_dir}")
        return 1

    engine_kwargs: dict = {}
    if not is_txn_pooler:
        engine_kwargs["connect_args"] = {"sslmode": "require"}

    engine = create_engine(url, **engine_kwargs)

    applied = 0
    skipped = 0
    failed = 0

    print(f"🔍 Aplicando migraciones pendientes contra {url[:60]}...\n")

    # R138 fix: usar AUTOCOMMIT isolation para DDL — SQLAlchemy 2.x
    # autobegin invalida el patrón `with conn.begin()` después de un select.
    # En migraciones DDL no necesitamos rollback granular (cada archivo
    # SQL ya tiene BEGIN/COMMIT internos si los necesita).
    with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as conn:
        for round_num, filename, (schema, canonical_table) in MIGRATIONS:
            sql_path = sql_dir / filename
            if not sql_path.exists():
                print(f"⚠ Round {round_num}: archivo no encontrado ({filename}) — skip")
                continue

            # Detectar si ya está aplicado
            try:
                already = table_exists(conn, schema, canonical_table)
            except Exception as exc:
                print(f"✗ Round {round_num}: error consultando schema — {exc}")
                failed += 1
                break

            if already:
                print(f"⊙ Round {round_num}: ya aplicado (tabla {schema}.{canonical_table} existe) — skip")
                skipped += 1
                continue

            print(f"→ Round {round_num}: aplicando {filename}...")
            sql_text = sql_path.read_text(encoding="utf-8")

            # En AUTOCOMMIT cada statement se comitea automáticamente.
            # Las migraciones pueden tener múltiples statements separados por ';'.
            # R138 fix: usar raw cursor (no exec_driver_sql) para evitar
            # que psycopg2 interprete `%` literales en LIKE '%foo%' como
            # parameter substitution. exec_driver_sql pasa params={} que
            # dispara substitution; el raw cursor con params=None no.
            try:
                raw_conn = conn.connection
                cur = raw_conn.cursor()
                try:
                    cur.execute(sql_text)
                finally:
                    cur.close()
                # Re-verificar
                if table_exists(conn, schema, canonical_table):
                    print(f"✓ Round {round_num}: aplicado OK")
                    applied += 1
                else:
                    print(
                        f"⚠ Round {round_num}: SQL ejecutado pero tabla "
                        f"{schema}.{canonical_table} no apareció. "
                        "Revisar manualmente."
                    )
                    failed += 1
                    break
            except Exception as exc:
                print(f"✗ Round {round_num}: error al ejecutar SQL — {exc}")
                failed += 1
                break

    print("\n" + "=" * 60)
    print(f"Aplicadas:    {applied}")
    print(f"Skipeadas:    {skipped} (ya estaban)")
    print(f"Fallidas:     {failed}")
    print("=" * 60)

    if failed > 0:
        print("\n⚠ Hubo errores. Migraciones posteriores NO se ejecutaron.")
        print("  Revisar el output arriba para diagnosticar.")
        return 2

    if applied == 0 and skipped == len(MIGRATIONS):
        print("\n✓ Todas las migraciones ya estaban aplicadas. Nada que hacer.")
        return 0

    print("\n✓ Migraciones pendientes aplicadas correctamente.")
    print("\nPróximos pasos:")
    print("  1. Setear CREDENTIALS_FERNET_KEY (si no está):")
    print("     fly secrets set CREDENTIALS_FERNET_KEY=... -a cehta-backend")
    print("  2. Correr seed: python -m scripts.seed_empresas_excel_round116 'C:/Users/DELL/Downloads/Data (4).xlsx'")
    print("  3. Ver progreso en /admin/marcha-blanca")
    return 0


if __name__ == "__main__":
    sys.exit(run())
