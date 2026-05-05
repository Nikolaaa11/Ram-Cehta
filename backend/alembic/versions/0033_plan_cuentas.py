"""V5 — Plan de cuentas maestro + habilitación por empresa.

Importa el plan de cuentas chileno con jerarquía de 4 niveles
(X-XX-XX-XX) compartido entre las 9 entidades operativas (CSL, RHO,
DTE, RVT, EVQ, TRK, CENERGY, AFIS, FIP).

Decisiones:
- **Plan único, habilitación por empresa**: la tabla `core.plan_cuentas`
  guarda el plan canónico (469 cuentas). La tabla `core.plan_cuenta_empresa`
  marca qué cuentas están habilitadas para qué empresa. Permite agregar
  empresas sin tocar schema y soporta CENERGY (no está en el Excel
  inicial).
- **Solo nivel 4 acepta movimientos** (`imputable = true`). Niveles 1-3
  son agrupadores de jerarquía (Activos / Activos Circulantes / Disponible).
- **Metadata legacy preservada**: 10 flags contables + código F22 +
  ajuste 14D vienen del Excel histórico. Sin estos, el contador externo
  no puede cuadrar declaraciones SII y rendiciones CORFO.
- **CORFO**: `corfo_elegible` + `tipo_gasto_corfo` permiten generar
  rendiciones CORFO por proyecto sin lógica adicional en runtime.
- **Nubox mapping**: `nubox_code` separado del código interno por si
  el plan en Nubox no es idéntico (default = mismo código).

Numeración correlativa de vouchers (Postgres function):
- `core.next_voucher_code(empresa, año, tipo)` devuelve el siguiente
  correlativo atómico por (empresa × año × tipo). Ej:
  CSL-2026-EGR-00001, CSL-2026-EGR-00002, ...
- Se crea aquí porque el plan de cuentas + vouchers son las fundaciones
  contables; vouchers reales se crean en migración 0037.

Importación de los 469 ítems: ver `backend/scripts/import_plan_cuentas.py`.
Esta migración solo crea estructura. Correr el script DESPUÉS de aplicar
la migración y antes del seed de empresas.
"""
from __future__ import annotations

from alembic import op

revision: str = "0033"
down_revision: str | None = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # =================================================================
    # Tabla principal — plan canónico
    # =================================================================
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.plan_cuentas (
            codigo              TEXT PRIMARY KEY,
            nivel               INT  NOT NULL CHECK (nivel BETWEEN 1 AND 4),
            tipo                TEXT NOT NULL CHECK (tipo IN (
                'ACTIVO', 'PASIVO', 'PATRIMONIO',
                'INGRESO', 'GASTO', 'RESULTADO', 'ORDEN'
            )),
            nombre              TEXT NOT NULL,
            descripcion         TEXT,
            codigo_padre        TEXT REFERENCES core.plan_cuentas(codigo),
            imputable           BOOLEAN NOT NULL DEFAULT FALSE,

            -- Tratamiento IVA
            iva_tratamiento     TEXT NOT NULL DEFAULT 'NA' CHECK (iva_tratamiento IN (
                'AFECTO', 'EXENTO', 'NO_GRAVADO', 'NA'
            )),

            -- CORFO (rendiciones automáticas)
            corfo_elegible      BOOLEAN NOT NULL DEFAULT FALSE,
            tipo_gasto_corfo    TEXT CHECK (tipo_gasto_corfo IN (
                'RRHH', 'OPERACION', 'INVERSION', 'GASTOS_GENERALES', 'NO_ELEGIBLE'
            )),

            -- Mapeo Nubox (puede no ser idéntico al código interno)
            nubox_code          TEXT,

            -- Metadata legacy del plan histórico (necesaria para SII / contador)
            codigo_f22          INT,
            ajuste_14d          TEXT,

            flag_partida          BOOLEAN NOT NULL DEFAULT FALSE,
            flag_concepto         BOOLEAN NOT NULL DEFAULT FALSE,
            flag_capital          BOOLEAN NOT NULL DEFAULT FALSE,
            flag_activo_fijo      BOOLEAN NOT NULL DEFAULT FALSE,
            flag_documento        BOOLEAN NOT NULL DEFAULT FALSE,
            flag_control_gestion  BOOLEAN NOT NULL DEFAULT FALSE,
            flag_activo_neto      BOOLEAN NOT NULL DEFAULT FALSE,
            flag_caja             BOOLEAN NOT NULL DEFAULT FALSE,
            flag_marca_14d        BOOLEAN NOT NULL DEFAULT FALSE,
            flag_percepcion       BOOLEAN NOT NULL DEFAULT FALSE,

            activa              BOOLEAN NOT NULL DEFAULT TRUE,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

            -- Invariante: solo nivel 4 es imputable
            CHECK (NOT imputable OR nivel = 4)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_cuentas_nivel ON core.plan_cuentas(nivel);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_cuentas_tipo ON core.plan_cuentas(tipo);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_cuentas_padre ON core.plan_cuentas(codigo_padre);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_cuentas_imputable "
        "ON core.plan_cuentas(imputable) WHERE imputable = TRUE;"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_cuentas_corfo "
        "ON core.plan_cuentas(corfo_elegible, tipo_gasto_corfo) "
        "WHERE corfo_elegible = TRUE;"
    )
    op.execute(
        """
        CREATE TRIGGER trg_touch
        BEFORE UPDATE ON core.plan_cuentas
        FOR EACH ROW
        EXECUTE FUNCTION touch_updated_at();
        """
    )

    # =================================================================
    # Tabla de habilitación por empresa
    # =================================================================
    # Cada cuenta del plan canónico puede estar habilitada o no para
    # cada empresa. Si no hay row, se considera DESHABILITADA (default
    # estricto). Esto previene que un usuario impute por error a una
    # cuenta que su empresa no usa.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.plan_cuenta_empresa (
            cuenta_codigo   TEXT NOT NULL REFERENCES core.plan_cuentas(codigo) ON DELETE CASCADE,
            empresa_codigo  TEXT NOT NULL REFERENCES core.empresas(codigo) ON DELETE CASCADE,
            habilitada      BOOLEAN NOT NULL DEFAULT TRUE,
            habilitada_en   TIMESTAMPTZ NOT NULL DEFAULT now(),
            habilitada_por  UUID,
            notas           TEXT,
            PRIMARY KEY (cuenta_codigo, empresa_codigo)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_plan_cuenta_empresa_empresa "
        "ON core.plan_cuenta_empresa(empresa_codigo) WHERE habilitada = TRUE;"
    )

    # =================================================================
    # Función Postgres: correlativo atómico de vouchers
    # =================================================================
    # Devuelve el siguiente correlativo de voucher por (empresa, año, tipo).
    # Atómico vía LOCK ROW (SELECT FOR UPDATE) — sin race conditions con
    # múltiples requests concurrentes.
    #
    # Mantenemos los contadores en `core.voucher_correlativos` (creada
    # acá; voucher real lo crea migración 0037).
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.voucher_correlativos (
            empresa_codigo  TEXT NOT NULL REFERENCES core.empresas(codigo),
            anio            INT  NOT NULL,
            tipo            TEXT NOT NULL CHECK (tipo IN (
                'INGRESO', 'EGRESO', 'TRASPASO', 'COMPRA', 'VENTA',
                'APERTURA', 'CIERRE', 'REVERSO'
            )),
            ultimo          INT  NOT NULL DEFAULT 0,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (empresa_codigo, anio, tipo)
        );
        """
    )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION core.next_voucher_code(
            p_empresa TEXT,
            p_anio    INT,
            p_tipo    TEXT
        )
        RETURNS TEXT
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_next INT;
            v_prefix TEXT;
        BEGIN
            -- Mapeo tipo → prefijo corto
            v_prefix := CASE p_tipo
                WHEN 'INGRESO'  THEN 'ING'
                WHEN 'EGRESO'   THEN 'EGR'
                WHEN 'TRASPASO' THEN 'TRA'
                WHEN 'COMPRA'   THEN 'COM'
                WHEN 'VENTA'    THEN 'VEN'
                WHEN 'APERTURA' THEN 'APE'
                WHEN 'CIERRE'   THEN 'CIE'
                WHEN 'REVERSO'  THEN 'REV'
                ELSE NULL
            END;
            IF v_prefix IS NULL THEN
                RAISE EXCEPTION 'Tipo de voucher inválido: %', p_tipo;
            END IF;

            -- UPSERT atómico con incremento
            INSERT INTO core.voucher_correlativos (empresa_codigo, anio, tipo, ultimo)
            VALUES (p_empresa, p_anio, p_tipo, 1)
            ON CONFLICT (empresa_codigo, anio, tipo)
            DO UPDATE SET ultimo = core.voucher_correlativos.ultimo + 1,
                          updated_at = now()
            RETURNING ultimo INTO v_next;

            RETURN format('%s-%s-%s-%s',
                          p_empresa,
                          p_anio,
                          v_prefix,
                          lpad(v_next::TEXT, 5, '0'));
        END;
        $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS core.next_voucher_code(TEXT, INT, TEXT);")
    op.execute("DROP TABLE IF EXISTS core.voucher_correlativos;")
    op.execute("DROP TABLE IF EXISTS core.plan_cuenta_empresa;")
    op.execute("DROP TRIGGER IF EXISTS trg_touch ON core.plan_cuentas;")
    op.execute("DROP TABLE IF EXISTS core.plan_cuentas CASCADE;")
