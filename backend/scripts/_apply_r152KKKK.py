"""Aplica R152KKKK migration: oc_attachments table."""
import psycopg2
from pathlib import Path

DATABASE_URL = (
    "postgresql://postgres.mowkckwvezudbdcyhwyj:87ZXHn01Z2xs5900"
    "@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
)
SQL_PATH = Path(__file__).resolve().parent / "sql" / "round152KKKK_oc_attachments.sql"


def main() -> None:
    print("=== R152KKKK · oc_attachments ===")
    sql = SQL_PATH.read_text(encoding="utf-8")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    try:
        cur.execute(sql)
        conn.commit()
        print("OK migration aplicada")
        cur.execute("""
            SELECT column_name, data_type FROM information_schema.columns
            WHERE table_schema='core' AND table_name='oc_attachments'
            ORDER BY ordinal_position
        """)
        cols = cur.fetchall()
        print(f"core.oc_attachments con {len(cols)} columnas:")
        for c in cols:
            print(f"  {c[0]:25s} {c[1]}")
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
