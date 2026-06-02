"""Aplica R152BBBB trigger en Supabase."""
import psycopg2
from pathlib import Path

DATABASE_URL = (
    "postgresql://postgres.mowkckwvezudbdcyhwyj:87ZXHn01Z2xs5900"
    "@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
)

SQL_PATH = Path(__file__).resolve().parent / "sql" / "round152BBBB_cuota_voucher_sync_trigger.sql"


def main() -> None:
    sql = SQL_PATH.read_text(encoding="utf-8")
    print(f"=== R152BBBB cuota<->voucher sync trigger ===")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    try:
        cur.execute(sql)
        conn.commit()
        print("Trigger aplicado OK")
        # Verificar
        cur.execute(
            "SELECT trigger_name FROM information_schema.triggers "
            "WHERE event_object_schema='core' "
            "AND event_object_table='vouchers' "
            "AND trigger_name='trg_sync_cuota_estado'"
        )
        if cur.fetchone():
            print("Trigger trg_sync_cuota_estado registrado en core.vouchers")
        else:
            print("WARN: trigger no detectado en information_schema")
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
