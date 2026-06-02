"""R152vvv · Seed inicial — Libro de Remuneraciones AFIS Abril 2026.

Carga el Excel "Reporte Remuneraciones Abril.xlsx" directamente en la
DB de Supabase, sin pasar por el endpoint /rrhh/libros/upload.

Pre-requisitos:
  - Aplicar primero la migración round152vvv_rrhh_migration.sql en Supabase Studio.
  - Tener DATABASE_URL apuntando a Supabase (o pasar como arg).

Uso:
  python backend/scripts/seed_libro_rrhh_abril_2026.py "C:\\Users\\DELL\\Downloads\\Reporte Remuneraciones Abril.xlsx"
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Path bootstrap para correr standalone
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import psycopg2
from psycopg2.extras import RealDictCursor

from app.services.libro_remuneraciones_parser import parse_libro_remuneraciones


DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres.mowkckwvezudbdcyhwyj:87ZXHn01Z2xs5900"
    "@aws-1-sa-east-1.pooler.supabase.com:5432/postgres",
)

EMPRESA_CODIGO = "AFIS"  # AGROTECNOLOGÍAS E INGENIERÍA SPA → AFIS en nuestro sistema


def main(xlsx_path: str) -> None:
    print(f"\n=== R152vvv Seed: cargando libro {xlsx_path} ===\n")

    parsed = parse_libro_remuneraciones(xlsx_path)
    print(f"Empresa parseada:  {parsed.empresa_razon_social} ({parsed.empresa_rut})")
    print(f"Periodo:           {parsed.periodo} ({parsed.mes_label})")
    print(f"Empleados:         {len(parsed.lineas)}")
    print(f"Total haberes:     ${parsed.total_haberes:,.0f}")
    print(f"Total líquido:     ${parsed.total_liquido:,.0f}")
    print(f"Aportes patron.:   ${parsed.total_aportes_patronales:,.0f}")
    print(f"Costo total emp.:  ${parsed.total_costo_empresa:,.0f}")
    print()

    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = False
    cur = conn.cursor(cursor_factory=RealDictCursor)

    try:
        # Verificar empresa
        cur.execute(
            "SELECT codigo FROM core.empresas WHERE codigo = %s",
            (EMPRESA_CODIGO,),
        )
        if not cur.fetchone():
            raise RuntimeError(
                f"Empresa {EMPRESA_CODIGO} no existe en core.empresas. "
                "Aplicá primero los seeds básicos."
            )

        # Reemplazar si existe libro previo
        cur.execute(
            """SELECT id FROM core.libros_remuneraciones
               WHERE empresa_codigo = %s AND periodo = %s""",
            (EMPRESA_CODIGO, parsed.periodo),
        )
        existing = cur.fetchone()
        if existing:
            print(f"⚠ Libro previo encontrado (id {existing['id']}), reemplazando...")
            cur.execute(
                "DELETE FROM core.libros_remuneraciones WHERE id = %s",
                (existing["id"],),
            )

        # Insertar cabecera
        cur.execute(
            """
            INSERT INTO core.libros_remuneraciones
                (empresa_codigo, periodo,
                 total_haberes, total_liquido, total_descuentos_legales,
                 total_aportes_patronales, total_costo_empresa,
                 archivo_origen, archivo_hash, cantidad_empleados,
                 notas)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                EMPRESA_CODIGO,
                parsed.periodo,
                parsed.total_haberes,
                parsed.total_liquido,
                parsed.total_descuentos_legales,
                parsed.total_aportes_patronales,
                parsed.total_costo_empresa,
                parsed.archivo_origen,
                parsed.archivo_hash,
                len(parsed.lineas),
                "Seed R152vvv — primer libro cargado al sistema.",
            ),
        )
        libro_id = cur.fetchone()["id"]
        print(f"✓ Libro cabecera insertado (id {libro_id})")

        # Insertar líneas + upsert empleados
        for l in parsed.lineas:
            cur.execute(
                """
                INSERT INTO core.empleados
                    (rut, nombre, empresa_codigo, area, sueldo_base_actual, activo)
                VALUES (%s, %s, %s, %s, %s, TRUE)
                ON CONFLICT (rut) DO UPDATE SET
                    nombre = EXCLUDED.nombre,
                    empresa_codigo = EXCLUDED.empresa_codigo,
                    area = COALESCE(EXCLUDED.area, core.empleados.area),
                    sueldo_base_actual = EXCLUDED.sueldo_base_actual,
                    updated_at = NOW()
                """,
                (l.rut, l.nombre, EMPRESA_CODIGO, l.area, l.sueldo_base),
            )

            cur.execute(
                """
                INSERT INTO core.libro_remuneraciones_lineas (
                    libro_id, empleado_rut, nombre, area, dias_trabajados,
                    sueldo_base, horas_extras, gratificacion_legal,
                    otros_imponibles, total_imponibles,
                    asignacion_familiar, otros_no_imponibles,
                    total_no_imponibles, total_haberes,
                    prevision, salud, seguro_cesantia_trab,
                    otros_descuentos_legales, total_descuentos_legales,
                    descuentos_varios, total_descuentos, liquido_pagado,
                    aporte_afp_empleador, sis, seguro_cesantia_empleador,
                    seguro_social, mutual, total_aportes_patronales,
                    base_tributable, impuesto_unico,
                    costo_total_empresa
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s, %s, %s, %s, %s,
                    %s, %s, %s
                )
                """,
                (
                    libro_id, l.rut, l.nombre, l.area, l.dias_trabajados,
                    l.sueldo_base, l.horas_extras, l.gratificacion_legal,
                    l.otros_imponibles, l.total_imponibles,
                    l.asignacion_familiar, l.otros_no_imponibles,
                    l.total_no_imponibles, l.total_haberes,
                    l.prevision, l.salud, l.seguro_cesantia_trab,
                    l.otros_descuentos_legales, l.total_descuentos_legales,
                    l.descuentos_varios, l.total_descuentos, l.liquido_pagado,
                    l.aporte_afp_empleador, l.sis, l.seguro_cesantia_empleador,
                    l.seguro_social, l.mutual, l.total_aportes_patronales,
                    l.base_tributable, l.impuesto_unico,
                    l.costo_total_empresa,
                ),
            )
            print(
                f"  ✓ {l.nombre:40s} ({l.rut:12s}) "
                f"haberes ${l.total_haberes:>11,.0f} "
                f"costo total ${l.costo_total_empresa:>11,.0f}"
            )

        conn.commit()
        print(f"\n✓ Seed completado. Libro {parsed.periodo} cargado con {len(parsed.lineas)} empleados.\n")

    except Exception as exc:
        conn.rollback()
        print(f"\n✗ Error: {exc}")
        raise
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Uso: python seed_libro_rrhh_abril_2026.py <ruta_excel>")
        sys.exit(1)
    main(sys.argv[1])
