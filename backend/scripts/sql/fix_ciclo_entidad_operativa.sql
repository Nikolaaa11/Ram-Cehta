-- ============================================================================
-- CICLO · la entidad que opera es la SpA, no el fondo
-- ============================================================================
-- La empresa se dio de alta el 2026-08-17 como "Fondo de Inversión Privado
-- Ciclo Capital", con `rut` en NULL porque el RUT del fondo estaba marcado
-- FALTA en la ficha.
--
-- El e-RUT que aportó Nicolás (serie 202608549755, emitido 18/06/2026) es de
-- **INVERSIONES CICLO CAPITAL SPA · 78.447.248-5**, otra persona jurídica.
-- Confirmó que ésa es la que opera bajo el fondo y la que va a emitir las OC
-- y usar el resto de la plataforma. O sea que la fila `CICLO` tiene que
-- describir a la SpA.
--
-- Qué NO se toca y por qué:
--   · `giro` queda en NULL. El e-RUT trae la "GLOSA DE ACTIVIDAD ECONÓMICA"
--     EN BLANCO, así que no hay de dónde sacarlo. El giro que había descrivía
--     al fondo (Cap. V Ley 20.712) y para la SpA es falso: dejar un giro
--     equivocado en un documento tributario es peor que dejarlo vacío. RHO,
--     la empresa más usada, también lo tiene en NULL — no rompe nada.
--   · El plan de cuentas, las áreas, la regla de aprobación y el correlativo
--     se crearon contra el código `CICLO` y siguen valiendo: cambia la
--     identidad tributaria de la empresa, no la empresa.
--
-- Idempotente. Reporta OK/SKIP/FAIL.
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    v_antes  RECORD;
    v_n      INT;
BEGIN
    SELECT razon_social, rut INTO v_antes
      FROM core.empresas WHERE codigo = 'CICLO';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL · no existe la empresa CICLO';
    END IF;

    RAISE NOTICE 'ANTES · % / RUT %', v_antes.razon_social,
                 COALESCE(v_antes.rut, '(vacío)');

    -- El RUT es único a nivel de plataforma: si ya está en otra empresa, es
    -- que la SpA se dio de alta dos veces y hay que resolverlo a mano.
    SELECT count(*) INTO v_n
      FROM core.empresas
     WHERE replace(replace(rut, '.', ''), '-', '') = '784472485'
       AND codigo <> 'CICLO';

    IF v_n > 0 THEN
        RAISE EXCEPTION 'FAIL · el RUT 78.447.248-5 ya está en otra empresa (%)', v_n;
    END IF;

    UPDATE core.empresas
       SET razon_social           = 'Inversiones Ciclo Capital SpA',
           rut                    = '78.447.248-5',
           giro                   = NULL,   -- e-RUT sin glosa: no se inventa
           direccion              = 'Av. Américo Vespucio Sur 80 Of 31, Las Condes',
           direccion_sii          = 'A VESPUCIO SUR 80 OF 31 LAS CONDES',
           representante_legal    = 'Juan Pablo Velasco García',
           gerente_general_nombre = 'Juan Pablo Velasco García',
           gerente_general_cargo  = 'Gerente General',
           gerente_general_email  = 'jpvelasco@ciclocapital.cl',
           email_firmante         = 'jpvelasco@ciclocapital.cl',
           updated_at             = now()
     WHERE codigo = 'CICLO';

    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n <> 1 THEN
        RAISE EXCEPTION 'FAIL · el UPDATE tocó % filas, esperaba 1', v_n;
    END IF;

    RAISE NOTICE 'OK · CICLO = Inversiones Ciclo Capital SpA · 78.447.248-5';
END $$;

-- ---------------------------------------------------------------------------
-- Verificación: la fila tiene que quedar completa para emitir una OC.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    e RECORD;
BEGIN
    SELECT * INTO e FROM core.empresas WHERE codigo = 'CICLO';

    IF e.rut IS NULL OR e.rut = '' THEN
        RAISE EXCEPTION 'FAIL · CICLO quedó sin RUT';
    END IF;
    IF e.razon_social NOT ILIKE '%SpA%' THEN
        RAISE EXCEPTION 'FAIL · la razón social no quedó como la SpA: %', e.razon_social;
    END IF;
    IF e.gerente_general_nombre IS NULL THEN
        RAISE EXCEPTION 'FAIL · CICLO sin firmante: la OC saldría sin quién la firma';
    END IF;

    RAISE NOTICE 'VERIFICADO · % · RUT % · firma %',
                 e.razon_social, e.rut, e.gerente_general_nombre;
END $$;

COMMIT;
