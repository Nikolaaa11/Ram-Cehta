"""V5 — Vouchers core: vouchers + lines + attachments + approvals.

Crea las 4 tablas centrales del módulo de comprobantes contables, con
los invariantes contables a nivel DB:

  1. **Partida doble** (`core.enforce_partida_doble`): trigger BEFORE
     UPDATE en `core.vouchers` que valida `Σ debit == Σ credit` cuando
     el status sale de `DRAFT`. En `DRAFT` permite descuadre temporal
     mientras el operador edita líneas.

  2. **Línea es debit XOR credit** (CHECK constraint): cada línea
     tiene ventas en `debit` o `credit`, nunca ambos ni ninguno.

  3. **Cuenta imputable** (`core.enforce_cuenta_imputable`): trigger
     BEFORE INSERT/UPDATE en `core.voucher_lines` que rechaza líneas
     con cuenta de nivel 1-3 (no imputables).

  4. **Inmutabilidad post-cierre** (`core.prevent_voucher_in_closed_period`):
     trigger BEFORE UPDATE/DELETE que rechaza modificaciones a vouchers
     con `fecha_contable <= empresa.locked_period_end_date`. Excepción:
     marcar `reversed_by` cuando se crea el voucher de reverso (registro
     de la corrección, no edición del original).

  5. **Reverso es voucher nuevo**: campo `reversal_of` en core.vouchers
     apunta al original. El original NO se modifica — se crea un voucher
     tipo `REVERSO` que neutraliza con asientos invertidos.

Lo que NO está en esta migración (queda para 0036):
  - core.approval_rules (umbrales por empresa para flujo reforzado)
  - core.user_company_roles (roles GG/COO/CONTADOR/etc. por empresa)
  - lógica de notificaciones post-aprobación
"""
from __future__ import annotations

from alembic import op

revision: str = "0035"
down_revision: str | None = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # =================================================================
    # ALTER core.empresas: locked_period_end_date para inmutabilidad
    # =================================================================
    op.execute(
        """
        ALTER TABLE core.empresas
        ADD COLUMN IF NOT EXISTS locked_period_end_date DATE,
        ADD COLUMN IF NOT EXISTS locked_at                TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS locked_by                UUID;
        """
    )
    op.execute(
        "COMMENT ON COLUMN core.empresas.locked_period_end_date IS "
        "'Vouchers con fecha_contable <= esta fecha son inmutables. "
        "Para corregir, crear voucher de REVERSO. Lo setea el CONTADOR + COO al cerrar el período.';"
    )

    # =================================================================
    # core.vouchers — encabezado
    # =================================================================
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.vouchers (
            voucher_id           BIGSERIAL PRIMARY KEY,
            codigo               TEXT UNIQUE NOT NULL,
            empresa_codigo       TEXT NOT NULL REFERENCES core.empresas(codigo),

            tipo                 TEXT NOT NULL CHECK (tipo IN (
                'INGRESO', 'EGRESO', 'TRASPASO', 'COMPRA', 'VENTA',
                'APERTURA', 'CIERRE', 'REVERSO'
            )),
            status               TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN (
                'DRAFT', 'PENDING', 'APPROVED', 'EXECUTED',
                'SYNCED', 'RECONCILED', 'CLOSED',
                'REJECTED', 'VOID'
            )),

            -- Fechas
            fecha_documento      DATE NOT NULL,
            fecha_contable       DATE NOT NULL,
            fecha_ejecucion      DATE,

            -- Glosa (descripción del asiento — equivalente al "concepto")
            glosa                TEXT NOT NULL CHECK (length(trim(glosa)) >= 5),

            -- Totales (calculados via trigger desde voucher_lines)
            total_debit          NUMERIC(18, 2) NOT NULL DEFAULT 0,
            total_credit         NUMERIC(18, 2) NOT NULL DEFAULT 0,
            moneda               TEXT NOT NULL DEFAULT 'CLP'
                                 CHECK (moneda IN ('CLP', 'UF', 'USD', 'EUR')),
            exchange_rate        NUMERIC(18, 6),

            -- Contraparte (cuando aplica — TRASPASO/AJUSTE pueden no tener)
            contraparte_rut      TEXT,
            contraparte_nombre   TEXT,
            contraparte_tipo     TEXT CHECK (contraparte_tipo IN (
                'PROVEEDOR', 'CLIENTE', 'EMPLEADO', 'BANCO', 'INTERNO', 'OTRO'
            )),

            -- Documento tributario asociado (cuando aplica COMPRA/VENTA)
            doc_tributario_tipo  TEXT CHECK (doc_tributario_tipo IN (
                'FACTURA', 'BOLETA', 'NOTA_CREDITO', 'NOTA_DEBITO',
                'HONORARIOS', 'NA'
            )),
            doc_tributario_folio TEXT,
            doc_tributario_sii_track_id TEXT,

            -- Caja (cuando aplica INGRESO/EGRESO)
            banco                TEXT,
            banco_cuenta_alias   TEXT,
            -- Conciliación bancaria: link al movimiento bancario que ejecutó
            -- este voucher (Fase 5). Nullable hasta concilar.
            movimiento_id        BIGINT REFERENCES core.movimientos(movimiento_id),

            -- Threshold reforzado (Fase 2 — flag pre-calculado al crear)
            threshold_aplicado   BOOLEAN NOT NULL DEFAULT FALSE,

            -- Reverso
            reversal_of          BIGINT REFERENCES core.vouchers(voucher_id),
            reversed_by          BIGINT REFERENCES core.vouchers(voucher_id),

            -- Audit
            created_by           UUID,
            requested_by         UUID,
            rejection_reason     TEXT,
            void_reason          TEXT,

            -- Sync Nubox (Fase 3)
            nubox_folio          TEXT,
            nubox_synced_at      TIMESTAMPTZ,
            nubox_status         TEXT,
            nubox_error          TEXT,

            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

            -- Invariante: si reversal_of NOT NULL, tipo debe ser REVERSO
            CHECK (
                (reversal_of IS NULL) OR (tipo = 'REVERSO')
            )
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vouchers_empresa ON core.vouchers(empresa_codigo);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vouchers_tipo ON core.vouchers(tipo);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vouchers_status ON core.vouchers(status);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vouchers_fecha_contable "
        "ON core.vouchers(fecha_contable DESC);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vouchers_contraparte_rut "
        "ON core.vouchers(contraparte_rut) WHERE contraparte_rut IS NOT NULL;"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vouchers_pending "
        "ON core.vouchers(status, fecha_contable) "
        "WHERE status IN ('PENDING', 'APPROVED');"
    )
    op.execute(
        """
        CREATE TRIGGER trg_touch
        BEFORE UPDATE ON core.vouchers
        FOR EACH ROW
        EXECUTE FUNCTION touch_updated_at();
        """
    )

    # =================================================================
    # core.voucher_lines — N líneas debe/haber con imputación triple
    # =================================================================
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.voucher_lines (
            line_id            BIGSERIAL PRIMARY KEY,
            voucher_id         BIGINT NOT NULL REFERENCES core.vouchers(voucher_id) ON DELETE CASCADE,
            line_number        INT NOT NULL,

            -- Imputación analítica TRIPLE
            cuenta_codigo      TEXT NOT NULL REFERENCES core.plan_cuentas(codigo),
            proyecto_codigo    TEXT REFERENCES core.proyectos_contables(codigo),
            area_codigo        TEXT REFERENCES core.areas(codigo),

            -- Movimiento debe/haber (uno de los dos > 0, el otro = 0)
            debit              NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
            credit             NUMERIC(18, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),

            descripcion        TEXT,

            -- IVA tracking (cuando la cuenta es de gasto/ingreso afecto)
            iva_tratamiento    TEXT CHECK (iva_tratamiento IN (
                'AFECTO', 'EXENTO', 'NO_GRAVADO', 'NA'
            )),
            iva_amount         NUMERIC(18, 2),
            neto_amount        NUMERIC(18, 2),

            -- Decisión gasto vs activación (relevante para activos sobre umbral)
            balance_treatment  TEXT NOT NULL DEFAULT 'NA' CHECK (balance_treatment IN (
                'GASTO', 'ACTIVACION', 'NA'
            )),

            created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

            -- Invariante 1: una línea es debit XOR credit, no ambos ni ninguno
            CHECK (
                (debit > 0 AND credit = 0) OR (debit = 0 AND credit > 0)
            ),
            -- Invariante 2: line_number único por voucher
            UNIQUE (voucher_id, line_number)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_voucher_lines_voucher "
        "ON core.voucher_lines(voucher_id);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_voucher_lines_cuenta "
        "ON core.voucher_lines(cuenta_codigo);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_voucher_lines_proyecto "
        "ON core.voucher_lines(proyecto_codigo) WHERE proyecto_codigo IS NOT NULL;"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_voucher_lines_area "
        "ON core.voucher_lines(area_codigo) WHERE area_codigo IS NOT NULL;"
    )

    # =================================================================
    # core.voucher_attachments — adjuntos en Dropbox
    # =================================================================
    # decisión COO: storage en Dropbox para consistencia con resto de
    # docs (legales, F29, contratos). file_url es path Dropbox.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.voucher_attachments (
            attachment_id    BIGSERIAL PRIMARY KEY,
            voucher_id       BIGINT NOT NULL REFERENCES core.vouchers(voucher_id) ON DELETE CASCADE,
            tipo             TEXT NOT NULL CHECK (tipo IN (
                'FACTURA', 'BOLETA', 'CONTRATO', 'COTIZACION',
                'TRANSFERENCIA', 'LIQUIDACION_SUELDO', 'ACTA',
                'RESPALDO_TECNICO', 'OTRO'
            )),
            file_name        TEXT NOT NULL,
            dropbox_path     TEXT NOT NULL,
            file_hash        TEXT,
            mime_type        TEXT,
            size_bytes       BIGINT,
            uploaded_by      UUID,
            uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_voucher_attachments_voucher "
        "ON core.voucher_attachments(voucher_id);"
    )

    # =================================================================
    # core.voucher_approvals — firmas digitales (Fase 2)
    # =================================================================
    # Tabla creada acá pero sin lógica todavía. La Fase 2 implementa
    # ApprovalRule + workflow de firmas. Dejarla creada permite que las
    # FK estén listas y voucher.status pueda transicionar a APPROVED.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.voucher_approvals (
            approval_id      BIGSERIAL PRIMARY KEY,
            voucher_id       BIGINT NOT NULL REFERENCES core.vouchers(voucher_id) ON DELETE CASCADE,
            approver_user_id UUID NOT NULL,
            role             TEXT NOT NULL CHECK (role IN (
                'GG', 'COO', 'CONTADOR', 'OPERADOR', 'DIRECTOR', 'TESORERIA'
            )),
            order_num        INT NOT NULL,
            decision         TEXT NOT NULL CHECK (decision IN ('APPROVED', 'REJECTED')),
            signed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
            signature_hash   TEXT NOT NULL,
            ip_address       TEXT,
            user_agent       TEXT,
            comments         TEXT,

            UNIQUE (voucher_id, order_num)
        );
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_voucher_approvals_voucher "
        "ON core.voucher_approvals(voucher_id);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_voucher_approvals_user "
        "ON core.voucher_approvals(approver_user_id);"
    )

    # =================================================================
    # TRIGGER 1 — Cuenta imputable
    # =================================================================
    op.execute(
        """
        CREATE OR REPLACE FUNCTION core.enforce_cuenta_imputable()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_imputable BOOLEAN;
            v_nivel     INT;
        BEGIN
            SELECT imputable, nivel INTO v_imputable, v_nivel
            FROM core.plan_cuentas
            WHERE codigo = NEW.cuenta_codigo;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Cuenta % no existe en el plan', NEW.cuenta_codigo;
            END IF;

            IF NOT v_imputable THEN
                RAISE EXCEPTION
                    'Cuenta % es de nivel % (no imputable). Solo nivel 4 acepta líneas.',
                    NEW.cuenta_codigo, v_nivel;
            END IF;

            RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_voucher_lines_cuenta_imputable
        BEFORE INSERT OR UPDATE ON core.voucher_lines
        FOR EACH ROW
        EXECUTE FUNCTION core.enforce_cuenta_imputable();
        """
    )

    # =================================================================
    # TRIGGER 2 — Partida doble
    # =================================================================
    # Se dispara antes del UPDATE de status: si pasa de DRAFT a otro
    # estado, valida Σ debit == Σ credit. También se dispara cuando
    # cambia total_debit / total_credit para mantenerlos sincronizados.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION core.enforce_partida_doble()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_debit  NUMERIC(18, 2);
            v_credit NUMERIC(18, 2);
        BEGIN
            -- En DRAFT permite descuadre temporal (mientras se editan líneas)
            IF NEW.status = 'DRAFT' THEN
                RETURN NEW;
            END IF;

            SELECT
                COALESCE(SUM(debit),  0),
                COALESCE(SUM(credit), 0)
            INTO v_debit, v_credit
            FROM core.voucher_lines
            WHERE voucher_id = NEW.voucher_id;

            IF v_debit <> v_credit THEN
                RAISE EXCEPTION
                    'Voucher % descuadrado: debe=% haber=% diferencia=% — '
                    'no puede salir de DRAFT con descuadre',
                    NEW.codigo, v_debit, v_credit, (v_debit - v_credit);
            END IF;

            -- Sync de totales en el header
            NEW.total_debit  := v_debit;
            NEW.total_credit := v_credit;

            RETURN NEW;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_voucher_partida_doble
        BEFORE UPDATE ON core.vouchers
        FOR EACH ROW
        WHEN (
            OLD.status IS DISTINCT FROM NEW.status
            OR OLD.total_debit IS DISTINCT FROM NEW.total_debit
            OR OLD.total_credit IS DISTINCT FROM NEW.total_credit
        )
        EXECUTE FUNCTION core.enforce_partida_doble();
        """
    )

    # =================================================================
    # TRIGGER 3 — Inmutabilidad post-cierre
    # =================================================================
    # Bloquea UPDATE/DELETE sobre vouchers en períodos cerrados.
    # Excepción: marcar reversed_by cuando se crea voucher de REVERSO
    # (registro de la corrección, no edición del original).
    op.execute(
        """
        CREATE OR REPLACE FUNCTION core.prevent_voucher_in_closed_period()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_locked DATE;
        BEGIN
            SELECT locked_period_end_date INTO v_locked
            FROM core.empresas
            WHERE codigo = OLD.empresa_codigo;

            IF v_locked IS NULL THEN
                RETURN COALESCE(NEW, OLD);  -- período no cerrado, todo OK
            END IF;

            IF OLD.fecha_contable > v_locked THEN
                RETURN COALESCE(NEW, OLD);  -- voucher posterior al cierre, OK
            END IF;

            -- Excepción: permitir solo el cambio de reversed_by (registro
            -- de que un voucher posterior reversó este original).
            IF TG_OP = 'UPDATE'
               AND OLD.reversed_by IS NULL
               AND NEW.reversed_by IS NOT NULL
               AND OLD.codigo = NEW.codigo
               AND OLD.fecha_contable = NEW.fecha_contable
               AND OLD.tipo = NEW.tipo
               AND OLD.status = NEW.status
            THEN
                RETURN NEW;
            END IF;

            RAISE EXCEPTION
                'Voucher % en período cerrado (hasta %). Para corregir, crear voucher de REVERSO.',
                OLD.codigo, v_locked;
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_voucher_period_lock
        BEFORE UPDATE OR DELETE ON core.vouchers
        FOR EACH ROW
        EXECUTE FUNCTION core.prevent_voucher_in_closed_period();
        """
    )

    # =================================================================
    # TRIGGER 4 — Lines también respetan period lock
    # =================================================================
    # Si el voucher está en período cerrado, no se pueden agregar/modificar/
    # borrar sus líneas (sino se podría editar el contenido sin alterar
    # el header).
    op.execute(
        """
        CREATE OR REPLACE FUNCTION core.prevent_voucher_lines_in_closed_period()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        AS $$
        DECLARE
            v_voucher_id    BIGINT;
            v_fecha_contable DATE;
            v_empresa       TEXT;
            v_locked        DATE;
            v_codigo        TEXT;
        BEGIN
            v_voucher_id := COALESCE(NEW.voucher_id, OLD.voucher_id);

            SELECT fecha_contable, empresa_codigo, codigo
            INTO v_fecha_contable, v_empresa, v_codigo
            FROM core.vouchers
            WHERE voucher_id = v_voucher_id;

            SELECT locked_period_end_date INTO v_locked
            FROM core.empresas
            WHERE codigo = v_empresa;

            IF v_locked IS NOT NULL AND v_fecha_contable <= v_locked THEN
                RAISE EXCEPTION
                    'Voucher % en período cerrado (hasta %). No se pueden modificar sus líneas.',
                    v_codigo, v_locked;
            END IF;

            RETURN COALESCE(NEW, OLD);
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_voucher_lines_period_lock
        BEFORE INSERT OR UPDATE OR DELETE ON core.voucher_lines
        FOR EACH ROW
        EXECUTE FUNCTION core.prevent_voucher_lines_in_closed_period();
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_voucher_lines_period_lock ON core.voucher_lines;")
    op.execute("DROP FUNCTION IF EXISTS core.prevent_voucher_lines_in_closed_period();")
    op.execute("DROP TRIGGER IF EXISTS trg_voucher_period_lock ON core.vouchers;")
    op.execute("DROP FUNCTION IF EXISTS core.prevent_voucher_in_closed_period();")
    op.execute("DROP TRIGGER IF EXISTS trg_voucher_partida_doble ON core.vouchers;")
    op.execute("DROP FUNCTION IF EXISTS core.enforce_partida_doble();")
    op.execute("DROP TRIGGER IF EXISTS trg_voucher_lines_cuenta_imputable ON core.voucher_lines;")
    op.execute("DROP FUNCTION IF EXISTS core.enforce_cuenta_imputable();")
    op.execute("DROP TRIGGER IF EXISTS trg_touch ON core.vouchers;")
    op.execute("DROP TABLE IF EXISTS core.voucher_approvals CASCADE;")
    op.execute("DROP TABLE IF EXISTS core.voucher_attachments CASCADE;")
    op.execute("DROP TABLE IF EXISTS core.voucher_lines CASCADE;")
    op.execute("DROP TABLE IF EXISTS core.vouchers CASCADE;")
    op.execute(
        "ALTER TABLE core.empresas "
        "DROP COLUMN IF EXISTS locked_by, "
        "DROP COLUMN IF EXISTS locked_at, "
        "DROP COLUMN IF EXISTS locked_period_end_date;"
    )
