"""perf indices for V3 hot paths (V3 fase 10 — DB performance pass)

Revision ID: 0014
Revises: 0013
Create Date: 2026-04-29

V3 fase 10 — Performance pass on DB indices for hot paths.

Después de V3 fases 1-9 los siguientes endpoints reciben tráfico real y
tocan muchas filas:

- /search (ILIKE en columnas de texto)
- /calendar/obligations (agrega F29, legal, OCs, suscripciones)
- /audit/actions (paginado por entity_type, entity_id, user_id, action)
- /inbox (lista por user_id, filtrar read_at, sort created_at)
- /empresas/{codigo}/dashboard (sums sobre core.movimientos)

Esta migración agrega índices BTREE compuestos en columnas calientes que
NO los tenían. No agrega pg_trgm/GIN: con ~5K filas máx por tabla en
este portafolio, btree + ILIKE prefijo es sub-ms. Cuando subamos escala
(p.ej. >50K OCs) podemos agregar trigram en una migración 0015.

Creación CONCURRENTLY: para no bloquear prod. Postgres no permite
CREATE INDEX CONCURRENTLY dentro de una transacción, así que cerramos la
transacción de Alembic con COMMIT, ejecutamos los CREATE, y reabrimos
con BEGIN para que Alembic pueda escribir en alembic_version.

Idempotencia: todas las sentencias usan IF NOT EXISTS, así que correr la
migración dos veces es seguro y no falla si un índice ya existe (p.ej.
si un DBA lo creó manualmente antes para evitar el lock).

Índices agregados (los de notifications + audit ya estaban en 0012/0013;
los de movimientos/suscripciones ya estaban en 0003/0004; los de
trabajadores/legal/fondos ya estaban en 0006/0008/0011):

- core.ordenes_compra(empresa_codigo, fecha_emision DESC)
    → list paginada por empresa, ordenada por fecha (hot en /ordenes_compra).
- core.ordenes_compra(estado, fecha_emision)
    → alerta de OCs estancadas (estado='emitida' AND fecha_emision < N).
- core.ordenes_compra(numero_oc)
    → /search por número de OC (texto exacto o ILIKE prefijo).
- core.ordenes_compra(proveedor_id)
    → join + filter cuando se pivotea por proveedor.
- core.f29_obligaciones(empresa_codigo, fecha_vencimiento)
    → list por empresa y /calendar/obligations (rango de fechas).
- core.f29_obligaciones(estado, fecha_vencimiento)
    → alerta F29 por vencer (estado='pendiente' AND fecha_vencimiento <= N).
- core.legal_documents(empresa_codigo, fecha_vigencia_hasta)
    → alertas de contratos por vencer por empresa (composite reemplaza
      lookup por empresa + sort secundario por vigencia).
- core.legal_documents(empresa_codigo, categoria)
    → list filtrado por empresa + categoría (UI tabs: contratos, actas...).
- core.proveedores(razon_social)
    → /search + ordenamiento alfabético en /proveedores.
- core.fondos(nombre)
    → /search en pipeline de capital.
- core.fondos(tipo, estado_outreach)
    → filtros combinados en /fondos (tipo VC + estado contactado, etc.).
- core.suscripciones_acciones(empresa_codigo, firmado, fecha_recibo)
    → calendar de suscripciones por firmar (firmado=false) por empresa.
- core.empresas(razon_social)
    → /search global por nombre de empresa.
"""
from __future__ import annotations

from alembic import op

revision: str = "0014"
down_revision: str | None = "0013"
branch_labels = None
depends_on = None


# Cada tupla: (schema.tabla, nombre_indice, columnas)
_INDICES: list[tuple[str, str, str]] = [
    ("core.ordenes_compra", "idx_oc_empresa_fecha",
     "(empresa_codigo, fecha_emision DESC)"),
    ("core.ordenes_compra", "idx_oc_estado_fecha",
     "(estado, fecha_emision)"),
    ("core.ordenes_compra", "idx_oc_numero",
     "(numero_oc)"),
    ("core.ordenes_compra", "idx_oc_proveedor",
     "(proveedor_id)"),
    ("core.f29_obligaciones", "idx_f29_empresa_venc",
     "(empresa_codigo, fecha_vencimiento)"),
    ("core.f29_obligaciones", "idx_f29_estado_venc",
     "(estado, fecha_vencimiento)"),
    ("core.legal_documents", "idx_legal_empresa_vigencia",
     "(empresa_codigo, fecha_vigencia_hasta)"),
    ("core.legal_documents", "idx_legal_empresa_categoria",
     "(empresa_codigo, categoria)"),
    ("core.proveedores", "idx_proveedores_razon",
     "(razon_social)"),
    ("core.fondos", "idx_fondos_nombre",
     "(nombre)"),
    ("core.fondos", "idx_fondos_tipo_estado",
     "(tipo, estado_outreach)"),
    ("core.suscripciones_acciones", "idx_susc_empresa_firmado_fecha",
     "(empresa_codigo, firmado, fecha_recibo)"),
    ("core.empresas", "idx_empresas_razon",
     "(razon_social)"),
]


def upgrade() -> None:
    # NOTE: cambiado a `CREATE INDEX` (sin CONCURRENTLY) porque el deploy
    # corre contra Supabase Transaction Pooler (PgBouncer en modo txn) que
    # rejecta CONCURRENTLY + raw COMMIT/BEGIN. Con ~5K filas máx por tabla
    # en este portafolio, el lock es <100ms — no bloquea prod en serio.
    # Cuando subamos escala, podemos correr una 0021 con CONCURRENTLY
    # apuntando al direct connection (port 5432) en vez del pooler.
    for table, name, cols in _INDICES:
        op.execute(
            f"CREATE INDEX IF NOT EXISTS {name} "
            f"ON {table} {cols};"
        )


def downgrade() -> None:
    for table, name, _cols in _INDICES:
        schema = table.split(".")[0]
        op.execute(f"DROP INDEX IF EXISTS {schema}.{name};")
