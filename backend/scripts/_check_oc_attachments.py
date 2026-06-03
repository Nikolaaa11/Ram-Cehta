import psycopg2

conn = psycopg2.connect(
    "postgresql://postgres.mowkckwvezudbdcyhwyj:87ZXHn01Z2xs5900"
    "@aws-1-sa-east-1.pooler.supabase.com:5432/postgres"
)
cur = conn.cursor()
cur.execute("""
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='core' AND table_name='oc_attachments'
    ORDER BY ordinal_position
""")
rows = cur.fetchall()
if rows:
    print("core.oc_attachments columns:")
    for r in rows:
        print(f"  {r[0]:30s} {r[1]}")
else:
    print("core.oc_attachments NO EXISTE - hay que crearla")
cur.close()
conn.close()
