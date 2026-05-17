"""Crear 30 vouchers de prueba (3 por empresa: COMPRA, EGRESO, INGRESO).

Round 79 — pedido del operador para tener data en TODAS las empresas
y poder testear el flow voucher end-to-end.

Run: python backend/scripts/create_test_vouchers_round79.py
"""
import os
import re
from pathlib import Path

from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Carga .env del backend/
load_dotenv(Path(__file__).parent.parent / ".env")

url_raw = os.getenv("DATABASE_URL", "")
url = re.sub(r"\+asyncpg|\+psycopg(?!2)", "+psycopg2", url_raw)
engine = create_engine(url, connect_args={"sslmode": "require"})

EMPRESAS = [
    "AFIS", "CEHTA", "CENERGY", "CSL", "DTE",
    "EVOQUE", "FIP_CEHTA", "REVTECH", "RHO", "TRONGKAI",
]

# (tipo, short, monto, debe_cta, haber_cta)
PLANTILLAS = [
    ("COMPRA", "COM", 52000, "4102-01", "1101-02"),
    ("EGRESO", "EGR", 28000, "4102-01", "1101-01"),
    ("INGRESO", "ING", 125000, "1101-02", "4101-01"),
]

ADMIN_UID = "b4307866-f9c9-4230-aad6-41b61d07a830"  # contactocehta@gmail.com


def main() -> None:
    with engine.connect() as c:
        provs = c.execute(text("""
            SELECT proveedor_id, razon_social, rut FROM core.proveedores
            WHERE activo = TRUE AND rut IS NOT NULL
            ORDER BY random() LIMIT 30
        """)).fetchall()
    if not provs:
        raise RuntimeError("No hay proveedores activos en core.proveedores")

    created = []
    with engine.begin() as c:
        idx = 0
        for emp in EMPRESAS:
            for tipo, short, monto, debe, haber in PLANTILLAS:
                prov = provs[idx % len(provs)]
                idx += 1
                codigo = f"{emp}-2026-{short}-09{idx:03d}"
                glosa = f"TEST Round 79 - {tipo.lower()} demo {emp}"
                vid = c.execute(
                    text("""
                        INSERT INTO core.vouchers
                          (codigo, empresa_codigo, tipo, status,
                           fecha_documento, fecha_contable, glosa,
                           total_debit, total_credit, moneda,
                           threshold_aplicado, contraparte_rut,
                           contraparte_nombre, contraparte_tipo,
                           created_by, source, forma_pago)
                        VALUES
                          (:codigo, :emp, :tipo, 'DRAFT',
                           '2026-05-15', '2026-05-15', :glosa,
                           :monto, :monto, 'CLP',
                           FALSE, :rut, :nombre, 'PROVEEDOR',
                           CAST(:uid AS UUID), 'manual',
                           CASE WHEN :tipo2 IN ('COMPRA','EGRESO')
                                THEN 'TRANSFERENCIA' ELSE NULL END)
                        RETURNING voucher_id
                    """),
                    {
                        "codigo": codigo, "emp": emp, "tipo": tipo,
                        "tipo2": tipo, "glosa": glosa, "monto": monto,
                        "rut": prov[2], "nombre": prov[1], "uid": ADMIN_UID,
                    },
                ).scalar()
                c.execute(
                    text("""
                        INSERT INTO core.voucher_lines
                          (voucher_id, line_number, cuenta_codigo,
                           debit, credit, balance_treatment, tipo_imputacion)
                        VALUES
                          (:v, 1, :debe, :monto, 0, 'NA', 'CONTABLE'),
                          (:v, 2, :haber, 0, :monto, 'NA', 'FINANCIERA')
                    """),
                    {"v": vid, "debe": debe, "haber": haber, "monto": monto},
                )
                created.append((vid, codigo, emp, tipo, monto))

    print(f"\n{len(created)} vouchers de prueba creados:\n")
    for v in created:
        print(f"  vid={v[0]:3d}  {v[1]:30s}  {v[2]:10s}  {v[3]:7s}  ${v[4]:,}")


if __name__ == "__main__":
    main()
