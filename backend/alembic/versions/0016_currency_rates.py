"""currency rates cache (V4 fase 1 — Currency conversion UF/CLP/USD)

Revision ID: 0016
Revises: 0015
Create Date: 2026-04-29

Tabla `core.currency_rates`: cache local de los valores de UF y USD
expresados en CLP para una fecha. Cada vez que la app necesita convertir
entre monedas, busca aquí primero; si la fecha no está, sale a la API
externa (CMF/BCN o mindicador.cl) y cachea la respuesta.

- UNIQUE (currency_code, date) → idempotencia: una fecha = una tasa por
  moneda. Si dos refresh corren en paralelo, ON CONFLICT DO NOTHING
  evita duplicates.
- Indice descendente (currency_code, date DESC) → "latest rate" rápido.
- Idempotente: usa CREATE TABLE/INDEX IF NOT EXISTS.
- Sin RLS — son datos públicos del Banco Central, todos los users
  autenticados pueden leerlos.
"""
from __future__ import annotations

from alembic import op

revision: str = "0016"
down_revision: str | None = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE SCHEMA IF NOT EXISTS core;

        CREATE TABLE IF NOT EXISTS core.currency_rates (
            id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            currency_code VARCHAR(8) NOT NULL,
            date          DATE NOT NULL,
            rate_clp      NUMERIC(18, 4) NOT NULL,
            source        VARCHAR(16) NOT NULL DEFAULT 'bcn',
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_currency_rates_code_date
                UNIQUE (currency_code, date)
        );

        CREATE INDEX IF NOT EXISTS idx_currency_rates_code_date_desc
            ON core.currency_rates(currency_code, date DESC);
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS core.currency_rates CASCADE;
        """
    )
