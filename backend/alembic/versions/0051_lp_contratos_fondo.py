"""V5++ ola AL — Tabla LP contratos del FIP CEHTA ESG.

Modela los contratos de suscripción de cuotas del Fondo. Cada fila es
un contrato (promesa o definitivo) con un suscriptor:

    fondo_codigo    — siempre 'FONDO' (FIP Cehta Capital ESG)
    suscriptor_*    — nombre, RUT, representante, domicilio
    tipo_contrato   — PROMESA | DEFINITIVO
    serie           — A | B  (B = AFIS auto-suscripción, tratamiento distinto)
    fecha_contrato
    notaria + codigo_verificacion (solo definitivos)
    cantidad_cuotas + valor_por_cuota_uf (default 350)
    uf_comprometidas
    monto_clp + uf_value_at_signing (snapshot del valor UF en fecha contrato)
    multa_mora_pct + indemnizacion_pct
    estado: PROMETIDO | SUSCRITO | PAGADO | INCUMPLIDO | RESUELTO
    fecha_suscripcion / fecha_pago (solo cuando pasa a esos estados)
    voucher_id: link al voucher INGRESO que registra el cobro
    dropbox_path: contrato escaneado

Diseño:
    - Una nueva tabla independiente (no extender suscripciones_acciones
      que es legacy). Migration mantiene la vieja por compatibilidad.
    - Estado machine: PROMETIDO → SUSCRITO → PAGADO. Cualquier estado
      puede ir a RESUELTO o INCUMPLIDO.
    - Cuando pasa a PAGADO, el endpoint /lp-contratos/{id}/pagar genera
      un voucher INGRESO automático y guarda voucher_id en esta tabla.

Seed: las 6 suscripciones del Excel "Consolidado_CEHTA_ESG" corregidas.
"""
from __future__ import annotations

from alembic import op

revision: str = "0051"
down_revision: str | None = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS core.lp_contratos (
            contrato_id          BIGSERIAL PRIMARY KEY,
            fondo_codigo         TEXT NOT NULL REFERENCES core.empresas(codigo),

            -- Suscriptor
            suscriptor_nombre    TEXT NOT NULL,
            suscriptor_rut       TEXT NOT NULL,
            representante_nombre TEXT,
            representante_rut    TEXT,
            domicilio            TEXT,
            email                TEXT,

            -- Contrato
            tipo_contrato        TEXT NOT NULL CHECK (tipo_contrato IN (
                'PROMESA', 'DEFINITIVO'
            )),
            serie                TEXT NOT NULL CHECK (serie IN ('A', 'B')),
            fecha_contrato       DATE NOT NULL,
            notaria              TEXT,
            codigo_verificacion  TEXT,

            -- Montos
            cantidad_cuotas      NUMERIC(18, 4) NOT NULL,
            valor_por_cuota_uf   NUMERIC(18, 4) NOT NULL DEFAULT 350,
            uf_comprometidas     NUMERIC(18, 4) NOT NULL,
            monto_clp            NUMERIC(18, 2),  -- snapshot al firmar/pagar
            uf_value_at_signing  NUMERIC(18, 4),  -- valor 1 UF en CLP a fecha contrato

            -- Cláusulas
            multa_mora_pct       NUMERIC(5, 2) DEFAULT 5.00,
            indemnizacion_pct    NUMERIC(5, 2) DEFAULT 50.00,
            forma_pago           TEXT,

            -- Estado
            estado               TEXT NOT NULL DEFAULT 'PROMETIDO' CHECK (estado IN (
                'PROMETIDO', 'SUSCRITO', 'PAGADO', 'INCUMPLIDO', 'RESUELTO'
            )),
            fecha_suscripcion    DATE,
            fecha_pago           DATE,
            voucher_id           BIGINT REFERENCES core.vouchers(voucher_id),

            -- Docs
            dropbox_path         TEXT,
            observaciones        TEXT,

            -- Audit
            created_by           UUID,
            created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

            -- Invariantes
            CHECK (cantidad_cuotas > 0),
            CHECK (uf_comprometidas > 0),
            CHECK (
                (estado = 'PAGADO') = (fecha_pago IS NOT NULL)
            )
        );
        """
    )

    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_lp_contratos_fondo "
        "ON core.lp_contratos(fondo_codigo, estado, fecha_contrato DESC);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_lp_contratos_suscriptor_rut "
        "ON core.lp_contratos(suscriptor_rut);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_lp_contratos_serie "
        "ON core.lp_contratos(fondo_codigo, serie, estado);"
    )

    op.execute(
        """
        CREATE TRIGGER trg_touch
        BEFORE UPDATE ON core.lp_contratos
        FOR EACH ROW
        EXECUTE FUNCTION touch_updated_at();
        """
    )

    # =================================================================
    # SEED: 6 contratos del Excel Consolidado_CEHTA_ESG (corregidos)
    # =================================================================
    # Solo se inserta si la empresa FONDO existe y no hay contratos ya.
    op.execute(
        """
        DO $$
        DECLARE
            fondo_existe BOOLEAN;
            already_seeded INT;
        BEGIN
            SELECT EXISTS(SELECT 1 FROM core.empresas WHERE codigo = 'FONDO')
            INTO fondo_existe;

            IF NOT fondo_existe THEN
                RAISE NOTICE 'Empresa FONDO no existe — skip seed LP contratos';
                RETURN;
            END IF;

            SELECT COUNT(*) FROM core.lp_contratos INTO already_seeded;
            IF already_seeded > 0 THEN
                RAISE NOTICE 'Ya hay % contratos — skip seed', already_seeded;
                RETURN;
            END IF;

            -- 1. La Araucaria Renta Car (35.000 UF)
            INSERT INTO core.lp_contratos (
                fondo_codigo, suscriptor_nombre, suscriptor_rut,
                representante_nombre, representante_rut, domicilio,
                tipo_contrato, serie, fecha_contrato,
                cantidad_cuotas, valor_por_cuota_uf, uf_comprometidas,
                multa_mora_pct, indemnizacion_pct, estado,
                observaciones
            ) VALUES (
                'FONDO', 'La Araucaria Renta Car Ltda.', '76.766.432-K',
                'Manuel Bravo Bravo', '8.195.628-6', 'Catedral N°1233, Santiago',
                'PROMESA', 'A', '2023-06-05',
                100, 350, 35000,
                5.00, 50.00, 'PROMETIDO',
                'Origen: Excel Consolidado CEHTA ESG. Pendiente confirmar pago.'
            );

            -- 2. Inversiones Eco-Innova SpA (17.487 UF)
            INSERT INTO core.lp_contratos (
                fondo_codigo, suscriptor_nombre, suscriptor_rut,
                representante_nombre, representante_rut, domicilio,
                tipo_contrato, serie, fecha_contrato,
                cantidad_cuotas, valor_por_cuota_uf, uf_comprometidas,
                multa_mora_pct, indemnizacion_pct, estado,
                observaciones
            ) VALUES (
                'FONDO', 'Inversiones Eco-Innova SpA', '77.371.663-3',
                'Matías Grez Urzúa', '9.806.633-0', 'Las Hualtatas N°4726, Vitacura',
                'PROMESA', 'A', '2023-06-05',
                49.96, 350, 17487,
                5.00, 50.00, 'PROMETIDO',
                'Origen: Excel Consolidado CEHTA ESG.'
            );

            -- 3. AFIS auto-suscripción Serie B (30.082 UF)
            INSERT INTO core.lp_contratos (
                fondo_codigo, suscriptor_nombre, suscriptor_rut,
                representante_nombre, representante_rut, domicilio,
                tipo_contrato, serie, fecha_contrato,
                cantidad_cuotas, valor_por_cuota_uf, uf_comprometidas,
                multa_mora_pct, indemnizacion_pct, estado,
                observaciones
            ) VALUES (
                'FONDO', 'AFIS — Administradora de Fondos de la Industria Sostenible S.A.',
                '77.423.556-6',
                'Guido Anatole Rietta González / Andrés Ramiro Fernández Méndez',
                NULL, 'Av. del Parque 4680-A of. 302, Huechuraba',
                'PROMESA', 'B', '2023-06-05',
                85.95, 350, 30082,
                5.00, 50.00, 'PROMETIDO',
                'AFIS comparece como Promitente Suscriptora del Fondo que administra. Serie B (auto-suscripción).'
            );

            -- 4. Sartor AGF (74.944 UF)
            INSERT INTO core.lp_contratos (
                fondo_codigo, suscriptor_nombre, suscriptor_rut,
                representante_nombre, representante_rut, domicilio,
                tipo_contrato, serie, fecha_contrato,
                cantidad_cuotas, valor_por_cuota_uf, uf_comprometidas,
                multa_mora_pct, indemnizacion_pct, estado,
                observaciones
            ) VALUES (
                'FONDO', 'Sartor Administradora General de Fondos S.A.', '76.576.607-9',
                'Pedro Pablo Larraín Mery / Alfredo Ignacio Harz Castro',
                '15.644.502-9 / 14.131.865-9', 'Cerro El Plomo 5420, of. 1301, Las Condes',
                'PROMESA', 'A', '2023-09-25',
                214.13, 350, 74944,
                5.00, 50.00, 'PROMETIDO',
                'Mayor promitente suscriptor del Fondo.'
            );

            -- 5. Energía y Ecología SpA (17.487 UF)
            INSERT INTO core.lp_contratos (
                fondo_codigo, suscriptor_nombre, suscriptor_rut,
                representante_nombre, representante_rut, domicilio,
                tipo_contrato, serie, fecha_contrato,
                cantidad_cuotas, valor_por_cuota_uf, uf_comprometidas,
                multa_mora_pct, indemnizacion_pct, estado,
                observaciones
            ) VALUES (
                'FONDO', 'Energía y Ecología SpA', '76.469.671-9',
                'Pablo Garasa Sánchez', '24.129.218-5',
                'Carretera General San Martín N°6000, Colina',
                'PROMESA', 'A', '2023-06-05',
                49.96, 350, 17487,
                5.00, 50.00, 'PROMETIDO',
                'Origen: Excel Consolidado CEHTA ESG.'
            );

            -- 6. Orbicorp DEFINITIVO al contado (17.500 UF / $672.118.825)
            INSERT INTO core.lp_contratos (
                fondo_codigo, suscriptor_nombre, suscriptor_rut,
                representante_nombre, representante_rut, domicilio,
                tipo_contrato, serie, fecha_contrato,
                notaria, codigo_verificacion,
                cantidad_cuotas, valor_por_cuota_uf, uf_comprometidas,
                monto_clp, forma_pago,
                multa_mora_pct, indemnizacion_pct,
                estado, fecha_suscripcion, fecha_pago,
                observaciones
            ) VALUES (
                'FONDO', 'Ingeniería Orbicorp Limitada', '76.283.720-K',
                'Juan Pablo Chinchón Salgado', '10.485.442-7',
                'Antonia López de Bello N°133, Recoleta',
                'DEFINITIVO', 'A', '2024-12-27',
                '43ª Notaría de Santiago — Juan Ricardo San Martín Urrejola',
                '20241227083726JRZ',
                50, 350, 17500,
                672118825, 'Al contado, ingresado al Fondo',
                5.00, 50.00,
                'PAGADO', '2024-12-27', '2024-12-27',
                'Contrato definitivo (no promesa). Cuotas libres de gravamen.'
            );
        END $$;
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_touch ON core.lp_contratos;")
    op.execute("DROP TABLE IF EXISTS core.lp_contratos CASCADE;")
