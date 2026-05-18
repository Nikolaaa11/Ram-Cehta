"""Round 83 — reemplaza seed demo Round 81 con datos reales REVTECH/TRONGKAI.

Contexto: pizarras + transcripcion Claudia. CORFO asigno $3.000.000.000 a
un proyecto compartido entre REVTECH y TRONGKAI como coejecutores. Cada
empresa tiene su propio proyecto contable pero ambos apuntan al mismo
subsidio para que las rendiciones bajen del mismo pozo.

Solo REVTECH y TRONGKAI participan en esta fase. Cenergy queda fuera del
rollout inicial (otras 8 empresas tambien quedan sin proyecto CORFO aun).

Reparto default sugerido en la transcripcion:
  - Normal: Empresa 30%
  - CORFO: 50%
  - P-tec (CEHTA Capital): 20% (para sumar 100)

El operador puede editar en /admin/proyectos cuando llegue esa UI.

Cuentas contables: usamos las mismas que existian en el seed demo.

Idempotente: si los registros existen actualiza, no rompe.

Run: python backend/scripts/seed_corfo_3mil_round83.py
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
    "subsidio_codigo": "CORFO-2026-REVTECH-TRONGKAI",
    "programa": "CORFO",
    "nombre": (
        "CORFO 2026 — REVTECH + TRONGKAI coejecutores · $3.000MM"
    ),
    "monto_total": 3_000_000_000,
    "entidad_otorgante": "CORFO",
    "estado": "ACTIVO",
    "fecha_inicio": date(2026, 1, 1),
    "fecha_termino": date(2027, 12, 31),
    "notas": (
        "Subsidio CORFO compartido entre REVTECH y TRONGKAI como "
        "coejecutores. Cada empresa tiene su proyecto contable propio "
        "pero ambos descuentan del mismo pozo. Round 83."
    ),
}

PROYECTOS = [
    {
        "codigo": "PRJ-REVTECH-COR-001",
        "empresa_codigo": "REVTECH",
        "nombre": "REVTECH — coejecutor CORFO 2026",
    },
    {
        "codigo": "PRJ-TRONGKAI-COR-001",
        "empresa_codigo": "TRONGKAI",
        "nombre": "TRONGKAI — coejecutor CORFO 2026",
    },
]

REPARTO = {
    "tipo_financiamiento": "CORFO",
    "programa": "CORFO 2026",
    "fecha_inicio": date(2026, 1, 1),
    "fecha_termino": date(2027, 12, 31),
    # Presupuesto por empresa — split aprox del subsidio total
    # (el reparto exacto entre coejecutores se ajusta con Claudia)
    "presupuesto_total": 1_500_000_000,
    "moneda": "CLP",
    "primer_desembolso_corfo": date(2026, 2, 15),
    "tipos_gasto_elegibles": ["RRHH", "OPERACION", "INVERSION"],
    "estado": "ACTIVE",
    "subsidio_codigo": SUBSIDIO["subsidio_codigo"],
    # Reparto Claudia: CORFO 50 / P-tec 20 / Empresa 30
    "aporte_corfo_pct_default": 50,
    "aporte_ptec_pct_default": 20,
    "aporte_empresa_directa_pct_default": 30,
    "cuenta_aporte_corfo": "4102-01",
    "cuenta_aporte_ptec_cehta": "4102-01",
    "cuenta_aporte_empresa_directa": "4102-01",
    "cuenta_iva_corporativo": "1170-01",
    "bloquear_edicion_pct": False,
}

# Proyectos demo Round 81 a borrar (si no tienen voucher_lines apuntando)
PROYECTOS_DEMO_A_BORRAR = [
    "PRJ-TRONGKAI-IDE-001",
    "PRJ-REVTECH-IDE-001",
    "PRJ-CENERGY-IDE-001",
]
SUBSIDIO_DEMO_A_BORRAR = "CORFO-IDEA-2026"


def main() -> None:
    with engine.begin() as c:
        # 1) Limpiar seed demo Round 81 (solo si no rompe FKs)
        for codigo in PROYECTOS_DEMO_A_BORRAR:
            ref = c.execute(
                text(
                    "SELECT COUNT(*) FROM core.voucher_lines "
                    "WHERE proyecto_codigo = :c"
                ),
                {"c": codigo},
            ).scalar()
            if ref == 0:
                c.execute(
                    text(
                        "DELETE FROM core.proyectos_contables WHERE codigo = :c"
                    ),
                    {"c": codigo},
                )
                print(f"  borrado proyecto demo: {codigo}")
            else:
                print(f"  saltado {codigo}: tiene {ref} voucher_lines")
        # Subsidio demo solo si ningun proyecto lo referencia ya
        ref = c.execute(
            text(
                "SELECT COUNT(*) FROM core.proyectos_contables "
                "WHERE subsidio_codigo = :s"
            ),
            {"s": SUBSIDIO_DEMO_A_BORRAR},
        ).scalar()
        if ref == 0:
            c.execute(
                text(
                    "DELETE FROM core.subsidios WHERE subsidio_codigo = :s"
                ),
                {"s": SUBSIDIO_DEMO_A_BORRAR},
            )
            print(f"  borrado subsidio demo: {SUBSIDIO_DEMO_A_BORRAR}")

        # 2) Crear/actualizar subsidio real
        c.execute(
            text(
                """
                INSERT INTO core.subsidios
                  (subsidio_codigo, programa, nombre, monto_total,
                   entidad_otorgante, estado, fecha_inicio, fecha_termino, notas)
                VALUES (:subsidio_codigo, :programa, :nombre, :monto_total,
                        :entidad_otorgante, :estado, :fecha_inicio,
                        :fecha_termino, :notas)
                ON CONFLICT (subsidio_codigo) DO UPDATE
                  SET nombre = EXCLUDED.nombre,
                      monto_total = EXCLUDED.monto_total,
                      estado = EXCLUDED.estado,
                      fecha_termino = EXCLUDED.fecha_termino,
                      notas = EXCLUDED.notas,
                      updated_at = now()
                """
            ),
            SUBSIDIO,
        )
        print(f"  subsidio: {SUBSIDIO['subsidio_codigo']}")

        # 3) Proyectos REVTECH + TRONGKAI
        for p in PROYECTOS:
            full = {**p, **REPARTO}
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
                    ON CONFLICT (codigo) DO UPDATE
                      SET nombre = EXCLUDED.nombre,
                          subsidio_codigo = EXCLUDED.subsidio_codigo,
                          aporte_corfo_pct_default = EXCLUDED.aporte_corfo_pct_default,
                          aporte_ptec_pct_default = EXCLUDED.aporte_ptec_pct_default,
                          aporte_empresa_directa_pct_default = EXCLUDED.aporte_empresa_directa_pct_default,
                          cuenta_aporte_corfo = EXCLUDED.cuenta_aporte_corfo,
                          cuenta_aporte_ptec_cehta = EXCLUDED.cuenta_aporte_ptec_cehta,
                          cuenta_aporte_empresa_directa = EXCLUDED.cuenta_aporte_empresa_directa,
                          cuenta_iva_corporativo = EXCLUDED.cuenta_iva_corporativo,
                          updated_at = now()
                    """
                ),
                full,
            )
            print(f"  proyecto: {p['codigo']} ({p['empresa_codigo']})")

    with engine.connect() as c:
        print()
        print("=== Estado final ===")
        for r in c.execute(text(
            "SELECT subsidio_codigo, nombre, monto_total FROM core.subsidios "
            "WHERE estado='ACTIVO'"
        )):
            print(f"  Subsidio: {r[0]} | ${r[2]:,.0f}")
        for r in c.execute(text(
            "SELECT codigo, empresa_codigo, subsidio_codigo, presupuesto_total "
            "FROM core.proyectos_contables "
            "WHERE subsidio_codigo IS NOT NULL ORDER BY codigo"
        )):
            print(f"  {r[0]} ({r[1]}) sub={r[2]} pres=${r[3]:,.0f}")


if __name__ == "__main__":
    main()
