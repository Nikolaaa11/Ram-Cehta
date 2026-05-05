"""Asegura que las 9 empresas del portafolio estén activo=TRUE.

Contexto: el usuario reportó que en /vouchers (y otros selectores)
"no me salen todas las empresas". El frontend pega a GET /empresa que
ahora devuelve todas las empresas, pero algunos endpoints derivados
(reportes, conciliación, KPIs) filtran `WHERE activo = TRUE`. Si por
algún motivo histórico una empresa quedó con activo=FALSE, desaparece
del portafolio operativo.

Esta migración:
  1. Activa las 9 empresas conocidas del portafolio (idempotente).
  2. Inserta las que falten (defensivo — en producción ya están todas
     pero en entornos nuevos esto las crea).

Las empresas son las del portafolio Cehta Capital + el FIP. Ver
project_entities.md (memoria del usuario).
"""
from __future__ import annotations

from alembic import op

revision: str = "0038"
down_revision: str | None = "0037"
branch_labels = None
depends_on = None


# Tuplas (codigo, razon_social_default, oc_prefix). Si la fila ya existe,
# solo actualizamos `activo = TRUE` y preservamos la razón social /
# datos fiscales que el contador haya cargado por catálogo.
_EMPRESAS_PORTAFOLIO: list[tuple[str, str, str]] = [
    ("TRONGKAI", "Trongkai SpA", "TRO"),
    ("CSL", "CSL SpA", "CSL"),
    ("EVOQUE", "Evoque SpA", "EVO"),
    ("DTE", "DTE SpA", "DTE"),
    ("REVTECH", "Revtech SpA", "REV"),
    ("CENERGY", "Cenergy SpA", "CEN"),
    ("RHO", "Rho SpA", "RHO"),
    ("AFIS", "AFIS SpA", "AFI"),
    ("FIP_CEHTA", "Fondo de Inversión Privado Cehta", "FIP"),
]


def upgrade() -> None:
    # 1. INSERT defensivo: si alguna falta (e.g. entorno staging), crearla
    for codigo, razon_social, oc_prefix in _EMPRESAS_PORTAFOLIO:
        op.execute(
            f"""
            INSERT INTO core.empresas (codigo, razon_social, oc_prefix, activo)
            VALUES ('{codigo}', '{razon_social}', '{oc_prefix}', TRUE)
            ON CONFLICT (codigo) DO NOTHING
            """
        )

    # 2. Forzar activo = TRUE para las 9 conocidas (idempotente)
    codigos_sql = ", ".join(f"'{c[0]}'" for c in _EMPRESAS_PORTAFOLIO)
    op.execute(
        f"""
        UPDATE core.empresas
        SET activo = TRUE
        WHERE codigo IN ({codigos_sql})
          AND activo = FALSE
        """
    )


def downgrade() -> None:
    # No-op: no queremos desactivar empresas legítimas en un downgrade.
    pass
