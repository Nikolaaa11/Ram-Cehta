-- ============================================================================
-- Alta de TECMAVIDA — Tecnología y Ecomateriales SpA
-- ============================================================================
-- "tecmávida" es el nombre de fantasía; la razón social —la que se imprime en
-- el bloque Mandante de una OC que firma un tercero— es TECNOLOGÍA Y
-- ECOMATERIALES SpA.
--
-- Todos los datos salen de documentos, ninguno se deduce:
--
--   · e-RUT del SII, serie 202608636254, emitido 23-07-2026
--       RUT 78.343.203-K · casa matriz PANIMAVIDA PC 3 LOTE 3, COLBUN
--       glosa de actividad "VALORIZACIÓN DE RESIDUOS INDUSTRIALES SÓLIDOS NO
--       PELIGROSOS" (a diferencia del e-RUT de Ciclo, éste SÍ trae glosa)
--   · Declaración jurada de inicio de actividades, folio 16657040, 20-07-2026
--       primera categoría · AFECTO A IVA · micro empresa
--       7 actividades económicas (351012, 351019, 382100, 383001/2/3/9)
--       contacto josematuranacoronado@gmail.com · +56 9 8266 8731
--   · Diario Oficial N°44.342 del 07-01-2026, CVE 2751219
--       escritura pública 22-12-2025, repertorio 4345-2025, ante Pablo Andrés
--       Almendras Burgos, Notario Público Interino de la Séptima Notaría de
--       Talca. Domicilio societario: Talca, Región del Maule.
--       Capital $1.000.000 en 1.000 acciones nominativas sin valor nominal.
--       Constituyente y administrador: JOSÉ ANTONIO MATURANA CORONADO,
--       cédula 17.535.949-4.
--
-- DOS DOMICILIOS, A PROPÓSITO:
--   `direccion`     = Panimávida PC 3 Lote 3, Colbún — la casa matriz ante el
--                     SII, que es la que va en el documento tributario.
--   El domicilio societario (Talca) queda anotado acá y en la ficha del repo,
--   pero NO en la columna: el que importa para una OC es dónde opera.
--
-- Es el MISMO predio que Panimávida Energy SpA (rol 209-96, arrendado). No es
-- un error de carga: son dos sociedades en el mismo sitio.
--
-- AFECTO A IVA según el propio SII, así que el default de factura afecta al
-- 19% del sistema es el correcto y no hay nada que ajustar.
--
-- Idempotente. Reporta OK/SKIP/FAIL y verifica contra RHO, que es la empresa
-- operativa de referencia (212 cuentas).
-- ============================================================================

\set ON_ERROR_STOP on

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. La fila de la empresa
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_n INT;
BEGIN
    -- El RUT es único a nivel de plataforma: si ya está, la empresa se cargó
    -- antes con otro código y hay que resolverlo a mano, no duplicarla.
    SELECT count(*) INTO v_n
      FROM core.empresas
     WHERE replace(replace(rut, '.', ''), '-', '') = '78343203K'
       AND codigo <> 'TECMAVIDA';
    IF v_n > 0 THEN
        RAISE EXCEPTION 'FAIL · el RUT 78.343.203-K ya está en otra empresa';
    END IF;

    INSERT INTO core.empresas (
        codigo, razon_social, rut, giro, direccion, ciudad, telefono,
        representante_legal, email_firmante, oc_prefix, activo, org_id,
        logo_dropbox_path, direccion_sii,
        gerente_general_nombre, gerente_general_cargo, gerente_general_email,
        firmantes_extra, oc_firma_colectiva, oc_color_primario,
        emails_oc_cc, auto_send_oc_emails, oc_template
    ) VALUES (
        'TECMAVIDA',
        'Tecnología y Ecomateriales SpA',
        '78.343.203-K',
        'Valorización de residuos industriales sólidos no peligrosos',
        'Panimávida PC 3 Lote 3',
        'Colbún',
        '+56 9 8266 8731',
        'José Antonio Maturana Coronado',
        'josematuranacoronado@gmail.com',
        'OC',
        TRUE,
        'CEHTA',
        'https://cehta-capital.vercel.app/logos/tecmavida.png',
        'PANIMAVIDA PC 3 LOTE 3, COLBUN',
        'José Antonio Maturana Coronado',
        'Representante Legal',
        'josematuranacoronado@gmail.com',
        '[]'::jsonb,
        FALSE,
        -- NO es el verde de marca (#91cc7a). Ese da 1,89:1 de contraste sobre
        -- blanco y el template lo usa para el TOTAL: el número más importante
        -- del documento saldría ilegible. Éste es el MISMO verde —tono 103°,
        -- saturación 45%— bajado a 32% de luminosidad: 5,44:1, casi idéntico
        -- al verde de RHO (5,47:1). El LOGOTIPO conserva los colores exactos
        -- de la marca; lo que se ajusta es la tinta del documento.
        '#42762d',
        ARRAY['contactocehta@gmail.com'],
        -- Arranca en FALSE, como CICLO: el envío automático de la OC al
        -- proveedor se prende cuando el equipo confirme que los correos son
        -- los definitivos. Mandar una OC a un mail equivocado no se deshace.
        FALSE,
        'panimavida'
    )
    ON CONFLICT (codigo) DO NOTHING;

    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 1 THEN
        RAISE NOTICE 'OK   · empresa TECMAVIDA creada';
    ELSE
        RAISE NOTICE 'SKIP · TECMAVIDA ya existía, no se toca';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Plan de cuentas — copia del de RHO
-- ---------------------------------------------------------------------------
-- RHO es la operativa de referencia (212 cuentas activas). Tecmávida es una
-- empresa operativa afecta a IVA, así que su plan arranca igual; el contador
-- después activa o desactiva lo que corresponda por empresa.
DO $$
DECLARE
    v_origen INT;
    v_destino INT;
BEGIN
    SELECT count(*) INTO v_origen
      FROM core.plan_cuenta_empresa WHERE empresa_codigo = 'RHO';
    IF v_origen = 0 THEN
        RAISE EXCEPTION 'FAIL · RHO no tiene plan de cuentas: no hay de dónde copiar';
    END IF;

    -- `habilitada`, no `activa`. Y NOT EXISTS en vez de ON CONFLICT: no
    -- depende de que exista una constraint con ese nombre exacto, así que
    -- reejecutar el script es seguro pase lo que pase con los índices.
    INSERT INTO core.plan_cuenta_empresa (empresa_codigo, cuenta_codigo, habilitada)
    SELECT 'TECMAVIDA', p.cuenta_codigo, p.habilitada
      FROM core.plan_cuenta_empresa p
     WHERE p.empresa_codigo = 'RHO'
       AND NOT EXISTS (
             SELECT 1 FROM core.plan_cuenta_empresa d
              WHERE d.empresa_codigo = 'TECMAVIDA'
                AND d.cuenta_codigo = p.cuenta_codigo);

    SELECT count(*) INTO v_destino
      FROM core.plan_cuenta_empresa WHERE empresa_codigo = 'TECMAVIDA';
    RAISE NOTICE 'OK   · plan de cuentas: % en RHO -> % en TECMAVIDA',
                 v_origen, v_destino;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Áreas
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_n INT;
BEGIN
    INSERT INTO core.area_empresa (area_codigo, empresa_codigo, aplica)
    SELECT a.area_codigo, 'TECMAVIDA', a.aplica
      FROM core.area_empresa a
     WHERE a.empresa_codigo = 'RHO'
       AND NOT EXISTS (
             SELECT 1 FROM core.area_empresa d
              WHERE d.empresa_codigo = 'TECMAVIDA'
                AND d.area_codigo = a.area_codigo);

    SELECT count(*) INTO v_n
      FROM core.area_empresa WHERE empresa_codigo = 'TECMAVIDA';
    RAISE NOTICE 'OK   · áreas: %', v_n;
END $$;

-- ---------------------------------------------------------------------------
-- 4. Regla de aprobación
-- ---------------------------------------------------------------------------
-- La MISMA que las otras 12: dos firmas, GG + DIRECTOR, desde el peso uno.
-- Sin esta fila la empresa puede crear vouchers pero no aprobar ninguno, que
-- es exactamente cómo quedó PANIMAVIDA cuando se creó a medias.
DO $$
DECLARE
    v_n INT;
BEGIN
    -- `rule_id` es serial: un ON CONFLICT DO NOTHING NUNCA dispararía y
    -- reejecutar el script dejaría DOS reglas para la misma empresa. Con dos
    -- reglas activas de igual prioridad, cuál gana depende del orden de
    -- lectura — o sea, del azar. Va con NOT EXISTS.
    INSERT INTO core.approval_rules (
        empresa_codigo, required_roles, min_amount, priority, active, descripcion
    )
    SELECT 'TECMAVIDA', ARRAY['GG', 'DIRECTOR'], 0, 100, TRUE,
           'Validacion: GG empresa (1ra firma) + DIRECTOR (2da firma) - 2 firmas siempre'
     WHERE NOT EXISTS (
             SELECT 1 FROM core.approval_rules r
              WHERE r.empresa_codigo = 'TECMAVIDA' AND r.active);

    SELECT count(*) INTO v_n
      FROM core.approval_rules WHERE empresa_codigo = 'TECMAVIDA';
    IF v_n = 0 THEN
        RAISE EXCEPTION 'FAIL · TECMAVIDA quedó sin regla de aprobación';
    END IF;
    RAISE NOTICE 'OK   · regla de aprobación: % (GG + DIRECTOR, 2 firmas)', v_n;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Verificación — contra RHO, en las dos direcciones
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    e         RECORD;
    v_faltan  INT;
    v_sobran  INT;
    v_rho     INT;
    v_tec     INT;
BEGIN
    SELECT * INTO e FROM core.empresas WHERE codigo = 'TECMAVIDA';
    IF NOT FOUND THEN
        RAISE EXCEPTION 'FAIL · TECMAVIDA no existe';
    END IF;
    IF e.rut IS NULL OR e.giro IS NULL OR e.gerente_general_nombre IS NULL THEN
        RAISE EXCEPTION 'FAIL · ficha incompleta (rut/giro/firmante)';
    END IF;

    -- Plan de cuentas: ni una de menos ni una de más. El EXCEPT entre dos
    -- conjuntos VACÍOS también da 0, así que se exige piso > 0 — si no, una
    -- copia que no copió nada pasaría como perfecta.
    SELECT count(*) INTO v_rho
      FROM core.plan_cuenta_empresa WHERE empresa_codigo = 'RHO';
    SELECT count(*) INTO v_tec
      FROM core.plan_cuenta_empresa WHERE empresa_codigo = 'TECMAVIDA';
    IF v_rho = 0 OR v_tec = 0 THEN
        RAISE EXCEPTION 'FAIL · plan de cuentas vacío (RHO=%, TECMAVIDA=%)',
                        v_rho, v_tec;
    END IF;

    SELECT count(*) INTO v_faltan FROM (
        SELECT cuenta_codigo FROM core.plan_cuenta_empresa WHERE empresa_codigo = 'RHO'
        EXCEPT
        SELECT cuenta_codigo FROM core.plan_cuenta_empresa WHERE empresa_codigo = 'TECMAVIDA'
    ) x;
    SELECT count(*) INTO v_sobran FROM (
        SELECT cuenta_codigo FROM core.plan_cuenta_empresa WHERE empresa_codigo = 'TECMAVIDA'
        EXCEPT
        SELECT cuenta_codigo FROM core.plan_cuenta_empresa WHERE empresa_codigo = 'RHO'
    ) x;
    IF v_faltan > 0 OR v_sobran > 0 THEN
        RAISE EXCEPTION 'FAIL · plan de cuentas difiere: faltan %, sobran %',
                        v_faltan, v_sobran;
    END IF;

    -- Y que estén habilitadas igual que en RHO: copiar los códigos pero
    -- dejarlas todas deshabilitadas daría 0 faltantes y 0 sobrantes, y la
    -- empresa no podría imputar nada.
    SELECT count(*) INTO v_faltan
      FROM core.plan_cuenta_empresa t
      JOIN core.plan_cuenta_empresa r
        ON r.cuenta_codigo = t.cuenta_codigo AND r.empresa_codigo = 'RHO'
     WHERE t.empresa_codigo = 'TECMAVIDA' AND t.habilitada <> r.habilitada;
    IF v_faltan > 0 THEN
        RAISE EXCEPTION 'FAIL · % cuentas con habilitada distinta a RHO', v_faltan;
    END IF;

    RAISE NOTICE '─────────────────────────────────────────────';
    RAISE NOTICE 'VERIFICADO · % · RUT %', e.razon_social, e.rut;
    RAISE NOTICE '   giro:      %', e.giro;
    RAISE NOTICE '   domicilio: %, %', e.direccion, e.ciudad;
    RAISE NOTICE '   firma:     % (%)', e.gerente_general_nombre, e.gerente_general_email;
    RAISE NOTICE '   color:     %  · logo: %', e.oc_color_primario, e.logo_dropbox_path;
    RAISE NOTICE '   cuentas:   % (idénticas a RHO)', v_tec;
    RAISE NOTICE '─────────────────────────────────────────────';
END $$;

COMMIT;
