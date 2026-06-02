"""R152AAAA · Setear logo_dropbox_path con URLs HTTPS de Vercel."""
import psycopg2

DATABASE_URL = (
    "postgresql://postgres.mowkckwvezudbdcyhwyj:87ZXHn01Z2xs5900"
    "@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
)

MAPPING = [
    ("AFIS",      "https://cehta-capital.vercel.app/logos/afis.jpg"),
    ("CEHTA",     "https://cehta-capital.vercel.app/logos/cehta.png"),
    ("CSL",       "https://cehta-capital.vercel.app/logos/csl.png"),
    ("DTE",       "https://cehta-capital.vercel.app/logos/dte.png"),
    ("EVOQUE",    "https://cehta-capital.vercel.app/logos/evoque.png"),
    ("REVTECH",   "https://cehta-capital.vercel.app/logos/revtech.png"),
    ("RHO",       "https://cehta-capital.vercel.app/logos/rho.png"),
    ("TRONGKAI",  "https://cehta-capital.vercel.app/logos/trongkai.png"),
    ("FIP_CEHTA", "https://cehta-capital.vercel.app/logos/cehta.png"),
]


def main() -> None:
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor()

    for codigo, url in MAPPING:
        cur.execute(
            "UPDATE core.empresas SET logo_dropbox_path=%s, updated_at=NOW() "
            "WHERE codigo=%s",
            (url, codigo),
        )
        print(f"  OK  {codigo:12s} -> {url}")

    conn.commit()
    print()
    cur.execute(
        "SELECT codigo, logo_dropbox_path FROM core.empresas "
        "WHERE activo=TRUE ORDER BY codigo"
    )
    print("=== Estado final ===")
    for r in cur.fetchall():
        print(f"  {r[0]:12s} {r[1] or '(NULL)'}")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
