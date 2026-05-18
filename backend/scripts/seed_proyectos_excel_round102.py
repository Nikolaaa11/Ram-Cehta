"""Round 102 — seed de proyectos contables desde Excel centros_costo_consolidado.

Carga los proyectos provistos por el operador en el Excel para que aparezcan
como opcion en el dropdown del form de voucher de cada empresa.

Mapeo de empresa Excel → empresa_codigo del sistema:
  CENERGY            → CENERGY
  AFIS SA            → AFIS
  CLIMATE SMART      → CSL
  DTE CONSULTING     → DTE
  EVOQUE ENERGY      → EVOQUE
  REVTECH            → REVTECH (no pisa PRJ-REVTECH-COR-001 ya seedeado Round 83)
  RHO GENERACION SPA → RHO
  TRONGKAI           → TRONGKAI (no pisa PRJ-TRONGKAI-COR-001)

Pattern del sistema: PRJ-{EMPRESA}-{TIPO}-{NNN}. TIPO=OPS para los del Excel.
TIPO=COR ya esta en uso para los 2 proyectos CORFO.

Para empresas SIN entrada en Excel (CEHTA, FIP_CEHTA), agrega solo el
proyecto "Otros" como fallback.

Idempotente: ON CONFLICT DO NOTHING. Volver a correr no genera duplicados.

Run: python backend/scripts/seed_proyectos_excel_round102.py
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

# Datos del Excel — (empresa_codigo, codigo_excel, descripcion)
PROYECTOS_EXCEL = [
    # CENERGY
    ("CENERGY", "CEN001", "Alta Tecnologia - AT CORFO"),
    ("CENERGY", "CEN002", "Copec - Copec UC"),
    ("CENERGY", "CEN003", "Casa Blanca - DTE"),
    ("CENERGY", "CEN004", "Santos Dumont"),
    ("CENERGY", "CEN005", "Ramon Cortez - Casa Ramon Cortez"),
    ("CENERGY", "CEN006", "La Gloria - Planta de Biomasa"),
    # AFIS
    ("AFIS", "AFI001", "Cehta Capital - Cehta_Capital"),
    ("AFIS", "AFI002", "Cenergy"),
    ("AFIS", "AFI003", "Ciclo Capital - Ciclo_Capital"),
    # CSL (Climate Smart)
    ("CSL", "CSL001", "Cehta Capital - Cehta_Capital"),
    ("CSL", "CSL002", "Axolot"),
    ("CSL", "CSL003", "Barranco Amarillo - Barranco_Amarillo"),
    ("CSL", "CSL004", "Calderas"),
    ("CSL", "CSL005", "Flota"),
    ("CSL", "CSL006", "Micronizador"),
    ("CSL", "CSL007", "Opticept"),
    ("CSL", "CSL008", "Reciclador Inteligente"),
    ("CSL", "CSL009", "Sensores"),
    # DTE
    ("DTE", "DTE001", "Cehta Capital - Cehta_Capital"),
    ("DTE", "DTE002", "La Serena DS49 - Viviendas subsidio DS49"),
    ("DTE", "DTE003", "La Serena SHAB"),
    ("DTE", "DTE004", "ESCALABILIDAD Y NUEVOS PROYECTOS"),
    # EVOQUE
    ("EVOQUE", "EVO001", "Chonchi"),
    ("EVOQUE", "EVO002", "Cehta Capital - Cehta_Capital"),
    ("EVOQUE", "EVO003", "Panimavida"),
    # REVTECH (no pisar PRJ-REVTECH-COR-001 ya existente)
    ("REVTECH", "REV001", "Estudios Internos - Revtech"),
    ("REVTECH", "REV002", "Minera Tronasol - Escalamiento Planta procesadora oxidos cobre"),
    ("REVTECH", "REV003", "Asociacion Mineros Alhue - Liberacion y Concentracion de Oro"),
    ("REVTECH", "REV004", "Tratamiento Escorias - Revalorizacion de escoriales"),
    ("REVTECH", "REV005", "Ptec - Desarrollo Programa tecnologico"),
    ("REVTECH", "REV006", "Manifestacion Minera - Prospeccion de distritos mineros"),
    ("REVTECH", "REV007", "Micronizacion de minerales de Baritina"),
    # RHO
    ("RHO", "RHO001", "BESS RHO_Panimavida"),
    ("RHO", "RHO002", "San Expedito_La Ligua"),
    ("RHO", "RHO003", "Codegua_Explicito"),
    ("RHO", "RHO004", "Santa Victoria 15 MW"),
    ("RHO", "RHO005", "RUIL"),
    ("RHO", "RHO006", "Chimbarongo"),
    ("RHO", "RHO007", "Molina"),
    ("RHO", "RHO008", "Agua Santa _San Expedito II"),
    ("RHO", "RHO009", "PMGD Quebrada Escobar"),
    ("RHO", "RHO010", "PMGD Ranguil III"),
    ("RHO", "RHO011", "PMGD Maipu"),
    ("RHO", "RHO012", "Los Maquis_Santa Teresa"),
    # TRONGKAI (no pisar PRJ-TRONGKAI-COR-001 ya existente)
    ("TRONGKAI", "TRO001", "Cehta Capital - Cehta_Capital"),
    ("TRONGKAI", "TRO002", "Ptec - PTEC Agrosphere Biorrefineria Subproductos Agroalimentarios"),
    ("TRONGKAI", "TRO003", "Trewaox - cofinanciado por Innova Region Maule"),
    ("TRONGKAI", "TRO004", "Cenizas Silice - valorizar cenizas de La Gloria"),
]

# Empresas para el "Otros" (incluye las del Excel + CEHTA/FIP_CEHTA)
TODAS_EMPRESAS = [
    "AFIS", "CEHTA", "CENERGY", "CSL", "DTE",
    "EVOQUE", "FIP_CEHTA", "REVTECH", "RHO", "TRONGKAI",
]


def excel_a_pattern_sistema(codigo_excel: str, empresa_codigo: str) -> str:
    """CEN001 → PRJ-CENERGY-OPS-001. AFI001 → PRJ-AFIS-OPS-001. Etc.

    El pattern del sistema regex es PRJ-{EMPRESA}-{TIPO}-{NNN}.
    Usamos TIPO=OPS (operacional) para todos los del Excel.
    El codigo numerico se preserva (001, 002, ...)
    """
    # extraer el numero (ultimas 3 digitos)
    m = re.match(r"^[A-Z]+(\d{3})$", codigo_excel)
    if not m:
        return f"PRJ-{empresa_codigo}-OPS-001"
    return f"PRJ-{empresa_codigo}-OPS-{m.group(1)}"


def main() -> None:
    insertados = 0
    saltados = 0
    with engine.begin() as c:
        # 1. Insertar proyectos del Excel
        for empresa, codigo_excel, descripcion in PROYECTOS_EXCEL:
            codigo_sistema = excel_a_pattern_sistema(codigo_excel, empresa)
            nombre = f"{codigo_excel} · {descripcion}"

            # Skip si ya existe (idempotente)
            existe = c.execute(
                text(
                    "SELECT 1 FROM core.proyectos_contables WHERE codigo = :c"
                ),
                {"c": codigo_sistema},
            ).first()
            if existe:
                saltados += 1
                continue

            c.execute(
                text(
                    """
                    INSERT INTO core.proyectos_contables
                      (codigo, empresa_codigo, nombre, tipo_financiamiento,
                       fecha_inicio, moneda, estado,
                       aporte_corfo_pct_default, aporte_ptec_pct_default,
                       aporte_empresa_directa_pct_default,
                       tipos_gasto_elegibles)
                    VALUES
                      (:codigo, :empresa, :nombre, 'INTERNO',
                       '2026-01-01', 'CLP', 'ACTIVE',
                       0, 0, 100,
                       CAST(:tipos AS TEXT[]))
                    """
                ),
                {
                    "codigo": codigo_sistema,
                    "empresa": empresa,
                    "nombre": nombre[:200],  # max 200 chars
                    "tipos": ["OPERACION"],
                },
            )
            insertados += 1

        # 2. "Otros" por empresa — fallback para vouchers sin proyecto especifico
        for empresa in TODAS_EMPRESAS:
            codigo_otros = f"PRJ-{empresa}-OTR-001"
            existe = c.execute(
                text("SELECT 1 FROM core.proyectos_contables WHERE codigo = :c"),
                {"c": codigo_otros},
            ).first()
            if existe:
                saltados += 1
                continue
            c.execute(
                text(
                    """
                    INSERT INTO core.proyectos_contables
                      (codigo, empresa_codigo, nombre, tipo_financiamiento,
                       fecha_inicio, moneda, estado,
                       aporte_corfo_pct_default, aporte_ptec_pct_default,
                       aporte_empresa_directa_pct_default,
                       tipos_gasto_elegibles)
                    VALUES
                      (:codigo, :empresa, 'Otros · sin proyecto especifico',
                       'INTERNO', '2026-01-01', 'CLP', 'ACTIVE',
                       0, 0, 100,
                       CAST(:tipos AS TEXT[]))
                    """
                ),
                {
                    "codigo": codigo_otros,
                    "empresa": empresa,
                    "tipos": ["OPERACION"],
                },
            )
            insertados += 1

    print(f"\nResultado:")
    print(f"  Insertados: {insertados}")
    print(f"  Saltados (ya existian): {saltados}")
    print()
    with engine.connect() as c:
        for empresa in TODAS_EMPRESAS:
            cnt = c.execute(
                text(
                    "SELECT COUNT(*) FROM core.proyectos_contables "
                    "WHERE empresa_codigo = :e AND estado = 'ACTIVE'"
                ),
                {"e": empresa},
            ).scalar()
            print(f"  {empresa:14s} = {cnt} proyectos ACTIVOS")


if __name__ == "__main__":
    main()
