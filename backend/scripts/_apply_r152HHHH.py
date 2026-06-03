"""Aplica R152HHHH migration."""
import psycopg2
from pathlib import Path

DATABASE_URL = (
    "postgresql://postgres.mowkckwvezudbdcyhwyj:87ZXHn01Z2xs5900"
    "@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
)
SQL_PATH = (
    Path(__file__).resolve().parent / "sql" / "round152HHHH_inbox_oc_auto_link.sql"
)


def main() -> None:
    print("=== R152HHHH · inbox link entity auto-creada ===")
    sql = SQL_PATH.read_text(encoding="utf-8")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    try:
        cur.execute(sql)
        conn.commit()
        print("OK migration aplicada")
        cur.execute(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema='core' AND table_name='inbox_messages' "
            "AND column_name IN ('created_entity_type','created_entity_id','auto_create_error','auto_create_at') "
            "ORDER BY column_name"
        )
        for r in cur.fetchall():
            print(f"  columna {r[0]} presente")
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
