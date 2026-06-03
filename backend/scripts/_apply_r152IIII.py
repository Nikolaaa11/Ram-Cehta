"""Aplica R152IIII migration: emails CC + audit OC envío."""
import psycopg2
from pathlib import Path

DATABASE_URL = (
    "postgresql://postgres.mowkckwvezudbdcyhwyj:87ZXHn01Z2xs5900"
    "@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
)
SQL_PATH = Path(__file__).resolve().parent / "sql" / "round152IIII_oc_auto_email.sql"


def main() -> None:
    print("=== R152IIII · OC auto-email ===")
    sql = SQL_PATH.read_text(encoding="utf-8")
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()
    try:
        cur.execute(sql)
        conn.commit()
        print("OK migration aplicada")
        # Verificar columnas
        for table, cols in [
            ("empresas", ["emails_oc_cc", "auto_send_oc_emails"]),
            ("ordenes_compra", ["oc_sent_to", "oc_sent_cc", "oc_sent_at",
                                "oc_send_error", "oc_send_message_id"]),
        ]:
            cur.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema='core' AND table_name=%s "
                "AND column_name = ANY(%s) ORDER BY column_name",
                (table, cols),
            )
            found = [r[0] for r in cur.fetchall()]
            print(f"  core.{table}: {len(found)}/{len(cols)} columns OK")
        # Estado emails_oc_cc seedeado
        cur.execute(
            "SELECT codigo, emails_oc_cc, auto_send_oc_emails "
            "FROM core.empresas WHERE activo=TRUE ORDER BY codigo"
        )
        print()
        print("Estado por empresa:")
        for r in cur.fetchall():
            cc = (r[1] or [])[:2]
            cc_str = ", ".join(cc) if cc else "(vacío)"
            print(f"  {r[0]:12s} auto_send={r[2]} cc={cc_str}")
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
