"""Round 81 — seed de proyectos y subsidios de ejemplo para el operador.

Crea 1 subsidio CORFO ejemplo + 1 proyecto por entidad piloto (Trongkai,
RevTech, Cenergy) ya configurado con % de reparto y cuentas para que el
operador pueda probar el flow E completo sin armar el catalogo a mano.

Cuentas usadas (del plan IFRS Nubox cargado):
  - cuenta_aporte_corfo:           '4102-01' (gasto operacional - destino CORFO)
  - cuenta_aporte_ptec_cehta:      '4102-01' (mismo gasto - sub-codificado por fuente)
  - cuenta_aporte_empresa_directa: '4102-01' (mismo gasto - aporte directo)
  - cuenta_iva_corporativo:        '1170-01' (IVA credito fiscal — empresa)

Si tu plan tiene otras cuentas estandar para estos rubros, edita acá
o desde el UI admin/proyectos cuando esté disponible.

Run: python backend/scripts/seed_proyectos_subsidios_round81.py
"""
import os
import re
from datetime import date
from pathlib import Path

from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

url_raw = os.getenv("DATABASE_URL", "")
url = re.sub(r"\+asyncpg|\+psycopg(?!2)", "+psycopg2", url_raw)
engine = create_engine(url, connect_args={"sslmode": "require"})


SUBSIDIO = {
    "subsidio_codigo": "CORFO-IDEA-2026",
    "programa": "CORFO IDEA",
    "nombre": "Subsidio CORFO IDEA 2026 (demo seed)",
    "monto_total": 50_000_000,
    "entidad_otorgante": "CORFO",
    "estado": "ACTIVO",
    "fecha_inicio": date(2026, 1, 1),
    "fecha_termino": date(2026, 12, 31),
    "notas": "Seed Round 81 — proyecto demo para validar Bloque E",
}

# Codigo PRJ-EMP-TIPO-NNN — TIPO=IDE (idea), NNN=001
PROYECTOS = [
    {
        "codigo": "PRJ-TRONGKAI-IDE-001",
        "empresa_codigo": "TRONGKAI",
        "nombre": "Demo Bloque E Trongkai · I+D producto",
    },
    {
        "codigo": "PRJ-REVTECH-IDE-001",
        "empresa_codigo": "REVTECH",
        "nombre": "Demo Bloque E RevTech · I+D producto",
    },
    {
        "codigo": "PRJ-CENERGY-IDE-001",
        "empresa_codigo": "CENERGY",
        "nombre": "Demo Bloque E Cenergy · I+D producto",
    },
]

# Reparto default y cuentas (mismas para los 3 ejemplo)
REPARTO_DEFAULT = {
    "tipo_financiamiento": "CORFO",
    "programa": "CORFO IDEA",
    "fecha_inicio": date(2026, 1, 1),
    "fecha_termino": date(2026, 12, 31),
    "presupuesto_total": 12_000_000,
    "moneda": "CLP",
    "primer_desembolso_corfo": date(2026, 2, 15),
    "tipos_gasto_elegibles": ["RRHH", "OPERACION", "INVERSION"],
    "estado": "ACTIVE",
    "subsidio_codigo": SUBSIDIO["subsidio_codigo"],
    # 40 CORFO / 30 P-tec / 30 Empresa directa = 100
    "aporte_corfo_pct_default": 40,
    "aporte_ptec_pct_default": 30,
    "aporte_empresa_directa_pct_default": 30,
    "cuenta_aporte_corfo": "4102-01",
    "cuenta_aporte_ptec_cehta": "4102-01",
    "cuenta_aporte_empresa_directa": "4102-01",
    "cuenta_iva_corporativo": "1170-01",
    "bloquear_edicion_pct": False,
}


def main() -> None:
    with engine.begin() as c:
        # 1) Subsidio
        c.execute(
            text(
                """
                INSERT INTO core.subsidios
                  (subsidio_codigo, programa, nombre, monto_total,
                   entidad_otorgante, estado, fecha_inicio, fecha_termino, notas)
                VALUES (:subsidio_codigo, :programa, :nombre, :monto_total,
                        :entidad_otorgante, :estado, :fecha_inicio,
                        :fecha_termino, :notas)
                ON CONFLICT (subsidio_codigo) DO NOTHING
                """
            ),
            SUBSIDIO,
        )

        # 2) Proyectos
        for p in PROYECTOS:
            full = {**p, **REPARTO_DEFAULT}
            # tipos_gasto_elegibles must be TEXT[] in DB
            full["tipos_gasto_elegibles_array"] = full["tipos_gasto_elegibles"]
            c.execute(
                text(
                    """
                    INSERT INTO core.proyectos_contables
                      (codigo, empresa_codigo, nombre, tipo_financiamiento,
                       programa, fecha_inicio, fecha_termino, presupuesto_total,
                       moneda, primer_desembolso_corfo, tipos_gasto_elegibles,
                       estado, subsidio_codigo, aporte_corfo_pct_default,
                       aporte_ptec_pct_default,
                       aporte_empresa_directa_pct_default,
                       cuenta_aporte_corfo, cuenta_aporte_ptec_cehta,
                       cuenta_aporte_empresa_directa, cuenta_iva_corporativo,
                       bloquear_edicion_pct)
                    VALUES
                      (:codigo, :empresa_codigo, :nombre, :tipo_financiamiento,
                       :programa, :fecha_inicio, :fecha_termino,
                       :presupuesto_total, :moneda, :primer_desembolso_corfo,
                       CAST(:tipos_gasto_elegibles_array AS TEXT[]),
                       :estado, :subsidio_codigo, :aporte_corfo_pct_default,
                       :aporte_ptec_pct_default,
                       :aporte_empresa_directa_pct_default,
                       :cuenta_aporte_corfo, :cuenta_aporte_ptec_cehta,
                       :cuenta_aporte_empresa_directa, :cuenta_iva_corporativo,
                       :bloquear_edicion_pct)
                    ON CONFLICT (codigo) DO NOTHING
                    """
                ),
                full,
            )

    with engine.connect() as c:
        s = c.execute(
            text("SELECT COUNT(*) FROM core.subsidios")
        ).scalar()
        p = c.execute(
            text("SELECT COUNT(*) FROM core.proyectos_contables")
        ).scalar()
        print(f"Subsidios en DB: {s}")
        print(f"Proyectos contables en DB: {p}")
        print()
        print("Listo. Probar:")
        print("  GET /api/v1/proyectos-contables/PRJ-TRONGKAI-IDE-001/reparto-default")


if __name__ == "__main__":
    main()
