-- ALTA DE EMPRESA · Fondo de Inversión Privado Ciclo Capital (CICLO)
-- =====================================================================
-- Contrato: docs/MEGAPROMPT_CICLO_CAPITAL.md (§3.1).
-- Ficha de datos: docs/DATOS_CICLO_CAPITAL.md (§1, §3 — es la ÚNICA fuente
-- de los datos identificatorios que hay acá; lo que ahí dice FALTA, acá
-- queda en NULL).
--
-- Qué hace:
--   1. Crea la fila de core.empresas con código CICLO: 12ª empresa, bajo
--      la única organización existente (org_id = 'CEHTA'), con su branding
--      de OC propio (logo negro, template panimavida).
--   2. Le copia de AFIS las cuatro cosas que una fila en core.empresas NO
--      alcanza a darle y sin las cuales la empresa nace inutilizable:
--      el plan de cuentas habilitado, la matriz de áreas, la regla de
--      aprobación de 2 firmas. AFIS es la administradora del fondo, así
--      que su plan es el más cercano a un FIP.
--   3. VERIFICA los correlativos en vez de sembrarlos (paso 7 — hay una
--      razón y está escrita ahí).
--   4. Cierra comparando CICLO contra AFIS campo por campo y listando toda
--      diferencia, separando las esperadas de las que hay que mirar.
--
-- ⚠️ POR QUÉ ESTO NO ES SÓLO UN INSERT. El alta de la 11ª empresa
--   (megaprompt_oc_panimavida_porcentajes.sql) creó la fila de
--   core.empresas y nada más: PANIMAVIDA quedó sin plan de cuentas, sin
--   áreas y sin regla de aprobación. Con eso, todo POST /vouchers muere en
--   400 ("cuenta no está habilitada para empresa"), y si alguno llegara a
--   entrar, quedaría atrapado en PENDING para siempre porque
--   GET /vouchers/mis-pendientes descarta en SILENCIO los vouchers sin
--   regla — el firmante nunca se entera de que tiene algo que firmar.
--   Ese agujero es el que este script viene a no repetir.
--
-- ⚠️ RUT DEL FONDO EN NULL, A PROPÓSITO. Está marcado FALTA en la ficha y
--   no se inventa. core.empresas.rut es UNIQUE pero NULLABLE, y Postgres
--   admite N NULLs en un índice único, así que CICLO convive sin problema
--   con CEHTA, que también nació sin RUT. Cuando aparezca, se carga con un
--   UPDATE de una línea — y por eso `rut` NO está en el ON CONFLICT DO
--   UPDATE del paso 3: una re-corrida de este script no puede borrar un
--   dato que alguien cargó después.
--
-- ⚠️ El deploy NO corre migraciones (release_command desactivado). Esto se
--   aplica A MANO y probablemente más de una vez: todo el script es
--   idempotente y reporta OK / SKIP / FAIL por paso. Un FAIL no aborta el
--   resto (cada paso corre en su propia subtransacción), así se ve el
--   cuadro completo en una sola pasada en vez de descubrir los problemas
--   de a uno.
--
-- ⚠️ Este script NO crea usuarios ni les da acceso. Mientras
--   core.user_company_roles no tenga filas para CICLO, sólo los admin ven
--   el fondo (assert_empresa_access → 403, y la tentativa queda registrada
--   en audit.scope_violations). Es deliberado: a quién se le da acceso lo
--   decide Nicolás, no un script. Ver el paso 14.
--
-- Cómo correrlo:
--   Supabase Studio → SQL editor → pegar el archivo entero → Run.
--   El resultado es la tabla de reporte del final.

BEGIN;

-- ---------------------------------------------------------------------
-- Reporte OK/SKIP/FAIL
-- ---------------------------------------------------------------------
-- Tabla temporal en vez de sólo RAISE NOTICE porque el SQL editor de
-- Supabase no muestra los NOTICE: el reporte tiene que llegar como result
-- set o el operador no se entera de un SKIP. ON COMMIT DROP para no dejar
-- basura en la sesión del pooler — y por eso tampoco hace falta borrarla
-- antes: si una corrida anterior abortó, su CREATE se fue con el rollback.
CREATE TEMP TABLE _rep_ciclo (
    n       SERIAL PRIMARY KEY,
    paso    TEXT NOT NULL,
    estado  TEXT NOT NULL,
    detalle TEXT
) ON COMMIT DROP;

-- CREATE OR REPLACE y no CREATE: el nombre es el mismo que usan los otros
-- megaprompts de esta carpeta a propósito (la forma se reconoce de un
-- vistazo), y el REPLACE reapunta el cuerpo a _rep_ciclo invalidando el
-- plan cacheado de la definición anterior.
CREATE OR REPLACE FUNCTION pg_temp._rep(
    p_paso TEXT, p_estado TEXT, p_detalle TEXT DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
    INSERT INTO pg_temp._rep_ciclo (paso, estado, detalle)
    VALUES (p_paso, p_estado, p_detalle);
    RAISE NOTICE '[%] % — %', p_estado, p_paso, COALESCE(p_detalle, '');
END;
$fn$;

-- ---------------------------------------------------------------------
-- Paso 0 · Foto del estado previo (para poder comparar después)
-- ---------------------------------------------------------------------
DO $do$
DECLARE
    v_total  BIGINT;
    v_activas BIGINT;
    v_existe BOOLEAN;
    v_err    TEXT;
BEGIN
    SELECT count(*), count(*) FILTER (WHERE activo)
      INTO v_total, v_activas
      FROM core.empresas;

    SELECT EXISTS (SELECT 1 FROM core.empresas WHERE codigo = 'CICLO')
      INTO v_existe;

    PERFORM pg_temp._rep('0 · estado previo', 'OK',
        format('%s empresas (%s activas); CICLO %s',
               v_total, v_activas,
               CASE WHEN v_existe THEN 'YA EXISTE — esto es una re-corrida'
                    ELSE 'no existe todavía' END));
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('0 · estado previo', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 1 · Precondición: la organización CEHTA existe
-- ---------------------------------------------------------------------
-- core.empresas.org_id es FK a core.organizations. Si la org no está, el
-- INSERT del paso 3 muere con ForeignKeyViolation y conviene saberlo acá,
-- con un mensaje que se entienda, y no adentro de un error de Postgres.
DO $do$
DECLARE
    v_err TEXT;
BEGIN
    IF EXISTS (SELECT 1 FROM core.organizations WHERE org_id = 'CEHTA') THEN
        PERFORM pg_temp._rep('1 · organización CEHTA', 'SKIP',
                             'ya existe — es la única organización de la plataforma');
    ELSE
        PERFORM pg_temp._rep('1 · organización CEHTA', 'FAIL',
            'no existe core.organizations.org_id = ''CEHTA''. La migración '
            '0043_multitenant_foundation NO está aplicada o alguien la borró: '
            'el paso 3 va a fallar por FK. Aplicar 0043 antes de reintentar.');
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('1 · organización CEHTA', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 2 · Precondiciones: AFIS + los catálogos globales
-- ---------------------------------------------------------------------
-- AFIS es la FUENTE de las tres copias (pasos 4, 5 y —conceptualmente— 6).
-- Si AFIS no está, o está pero con el plan de cuentas vacío, esos pasos
-- "funcionan" copiando cero filas y CICLO nace tan rota como PANIMAVIDA.
-- Un INSERT ... SELECT que copia 0 filas no falla: por eso hay que
-- chequearlo acá y no confiar en que el paso reviente solo.
DO $do$
DECLARE
    v_afis      BIGINT;
    v_afis_plan BIGINT;
    v_afis_area BIGINT;
    v_areas     BIGINT;
    v_cuentas   BIGINT;
    v_err       TEXT;
BEGIN
    SELECT count(*) INTO v_afis   FROM core.empresas WHERE codigo = 'AFIS';
    SELECT count(*) INTO v_areas  FROM core.areas;
    SELECT count(*) INTO v_cuentas FROM core.plan_cuentas;
    SELECT count(*) INTO v_afis_plan
      FROM core.plan_cuenta_empresa WHERE empresa_codigo = 'AFIS' AND habilitada;
    SELECT count(*) INTO v_afis_area
      FROM core.area_empresa WHERE empresa_codigo = 'AFIS' AND aplica;

    IF v_afis = 0 THEN
        PERFORM pg_temp._rep('2 · fuente AFIS + catálogos', 'FAIL',
            'AFIS no existe en core.empresas. Es la fuente de las copias de '
            'los pasos 4 y 5: sin ella CICLO nace sin plan de cuentas y sin '
            'áreas. Abortar y revisar la BD.');
    ELSIF v_afis_plan = 0 OR v_afis_area = 0 THEN
        PERFORM pg_temp._rep('2 · fuente AFIS + catálogos', 'FAIL',
            format('AFIS existe pero su matriz está vacía: plan=%s áreas=%s. '
                   'Copiar de acá dejaría a CICLO sin nada. Revisar AFIS antes '
                   'de reintentar.', v_afis_plan, v_afis_area));
    ELSIF v_areas < 10 OR v_cuentas < 100 THEN
        PERFORM pg_temp._rep('2 · fuente AFIS + catálogos', 'FAIL',
            format('catálogos globales incompletos: core.areas=%s (esperadas 10, '
                   'seed 0034) core.plan_cuentas=%s (esperadas 212, seed 0033). '
                   'Las copias de los pasos 4 y 5 saldrían truncadas.',
                   v_areas, v_cuentas));
    ELSE
        PERFORM pg_temp._rep('2 · fuente AFIS + catálogos', 'OK',
            format('AFIS: %s cuentas habilitadas, %s áreas. Globales: %s áreas, '
                   '%s cuentas en el plan.',
                   v_afis_plan, v_afis_area, v_areas, v_cuentas));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('2 · fuente AFIS + catálogos', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 3 · core.empresas — la fila madre
-- ---------------------------------------------------------------------
-- Cada columna nombrada explícitamente, incluidas las que "ya tienen el
-- default que queremos". Dos razones concretas, las dos verificadas contra
-- las migraciones y no supuestas:
--
--   · oc_color_primario tiene DEFAULT '#236C4F' (verde Cehta, puesto por
--     round152www_oc_firmantes_migration.sql). Si el INSERT no la nombra,
--     CICLO nace verde y su logo es negro sobre blanco. El color va
--     EXPLÍCITO en '#111111'.
--   · org_id tiene DEFAULT 'CEHTA' (0043). Confiar en un default para un
--     campo que decide el scope multi-tenant es exactamente la clase de
--     cosa que después nadie puede explicar. Va explícito.
--
-- Lo que queda en NULL y por qué (ficha §1 y §4, todos marcados FALTA):
--   rut · telefono · representante_legal · gerente_general_nombre /
--   _cargo / _email. NO se inventan. La consecuencia operativa de que el
--   firmante esté vacío está en el comentario de auto_send_oc_emails y en
--   el paso 8.
--
-- ciudad queda en NULL a propósito, aunque parezca un dato que tenemos: el
-- template de la OC imprime `direccion, ciudad` concatenados
-- (orden_compra_panimavida.html:886), y `direccion` ya termina en
-- "Las Condes". Cargar ciudad haría que el PDF diga "…, Las Condes,
-- Las Condes". AFIS está exactamente igual, por lo mismo.
--
-- Sobre el ON CONFLICT DO UPDATE: sólo reafirma lo que fija la ficha/el
-- contrato (identidad y branding). NO toca rut, email_firmante,
-- emails_oc_cc, auto_send_oc_emails, activo, ciudad, telefono, ni ninguno
-- de los campos de firmantes, porque ésos son del OPERADOR: se editan
-- desde /admin/oc-branding y una re-corrida del script no puede pisarlos.
-- El caso que esto evita es concreto: Nicolás carga el RUT del fondo en
-- septiembre, alguien re-corre el script en octubre para verificar, y el
-- RUT desaparece.
DO $do$
DECLARE
    v_existia BOOLEAN;
    v_err     TEXT;
BEGIN
    SELECT EXISTS (SELECT 1 FROM core.empresas WHERE codigo = 'CICLO')
      INTO v_existia;

    INSERT INTO core.empresas (
        codigo, razon_social, rut, giro, direccion, ciudad, telefono,
        representante_legal, email_firmante, oc_prefix, activo, org_id,
        logo_dropbox_path, pagina_web,
        oc_template, oc_color_primario, oc_firma_colectiva,
        emails_oc_cc, auto_send_oc_emails
    ) VALUES (
        'CICLO',
        'Fondo de Inversión Privado Ciclo Capital',
        -- RUT: FALTA en la ficha (§1). NULL explícito, no cadena vacía —
        -- '' pasaría el UNIQUE una sola vez y rompería la segunda empresa
        -- sin RUT que alguien cargue.
        NULL,
        'Fondo de inversión privado (Cap. V Ley N°20.712) — financiamiento '
        'inmobiliario por compraventa con pacto de retroventa sobre inmuebles '
        'urbanos en Chile',
        'Américo Vespucio 80 Of 31, Las Condes',
        NULL,   -- ciudad: ver comentario de arriba
        NULL,   -- telefono: FALTA
        NULL,   -- representante_legal: FALTA (ficha §7, "quién firma")
        'jpvelasco@ciclocapital.cl',
        'OC',
        TRUE,
        'CEHTA',
        'https://cehta-capital.vercel.app/logos/ciclo.png',
        'https://fondo-ciclo.vercel.app',
        -- 'panimavida' es hoy el formato de TODAS las empresas (el renderer
        -- v2 lo usa salvo oc_template='legacy'), pero además es el token que
        -- fuerza el v2 aunque el flag global settings.oc_pdf_renderer esté
        -- en v1. Explícito, entonces, y no NULL.
        'panimavida',
        '#111111',
        FALSE,
        ARRAY['contacto@ciclocapital.cl']::TEXT[],
        -- FALSE, y es una decisión, no un descuido. El auto-envío manda la
        -- OC al gerente_general_email; con ese campo en NULL (FALTA en la
        -- ficha) el servicio no encuentra destinatario, escribe
        -- "Sin destinatarios válidos" en ordenes_compra.oc_send_error y
        -- limpia el oc_sent_at que había reservado — o sea que deja un
        -- error registrado en CADA alta de OC del fondo, sin que eso
        -- signifique nada. Prender el switch es un clic en
        -- /admin/oc-branding el día que se cargue el firmante; dejar
        -- errores falsos sembrados en la tabla no se deshace tan barato.
        FALSE
    )
    ON CONFLICT (codigo) DO UPDATE SET
        razon_social      = EXCLUDED.razon_social,
        giro              = EXCLUDED.giro,
        direccion         = EXCLUDED.direccion,
        org_id            = EXCLUDED.org_id,
        logo_dropbox_path = EXCLUDED.logo_dropbox_path,
        pagina_web        = EXCLUDED.pagina_web,
        oc_template       = EXCLUDED.oc_template,
        oc_color_primario = EXCLUDED.oc_color_primario,
        oc_prefix         = EXCLUDED.oc_prefix,
        updated_at        = now();

    IF v_existia THEN
        PERFORM pg_temp._rep('3 · core.empresas CICLO', 'SKIP',
            'ya existía: reafirmados razón social, giro, dirección, org_id, '
            'logo, web y branding de OC. NO se tocaron los campos del operador '
            '(rut, email_firmante, emails_oc_cc, auto_send_oc_emails, activo, '
            'ciudad, teléfono, firmantes).');
    ELSE
        PERFORM pg_temp._rep('3 · core.empresas CICLO', 'OK',
            'creada · org_id=CEHTA · oc_template=panimavida · color #111111 · '
            'RUT NULL (FALTA en la ficha) · auto_send_oc_emails=FALSE');
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('3 · core.empresas CICLO', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 4 · core.plan_cuenta_empresa ← AFIS
-- ---------------------------------------------------------------------
-- core.plan_cuentas es GLOBAL (212 cuentas); lo que es por empresa es la
-- HABILITACIÓN. Y el default de esa tabla es estricto al revés de lo que
-- uno esperaría: si no hay fila, la cuenta está DESHABILITADA (migración
-- 0033). O sea que una empresa sin filas acá no está "a medio configurar":
-- no puede imputar a ninguna cuenta, y todo POST /vouchers le responde
-- 400 "cuenta no está habilitada para empresa 'CICLO'".
--
-- Se copia el conjunto de AFIS y no un subconjunto "de fondo": elegir a mano
-- qué cuentas le sirven a un FIP es una decisión contable que no le toca a
-- este script. Sobra plan antes que faltar — deshabilitar una cuenta después
-- es un UPDATE, descubrir que falta es un voucher que no se puede guardar.
DO $do$
DECLARE
    v_nuevas  BIGINT;
    v_origen  BIGINT;
    v_destino BIGINT;
    v_err     TEXT;
BEGIN
    SELECT count(*) INTO v_origen
      FROM core.plan_cuenta_empresa WHERE empresa_codigo = 'AFIS';

    INSERT INTO core.plan_cuenta_empresa
        (cuenta_codigo, empresa_codigo, habilitada, notas)
    SELECT s.cuenta_codigo, 'CICLO', s.habilitada,
           'Copiado de AFIS · alta CICLO (administradora del fondo)'
      FROM core.plan_cuenta_empresa s
     WHERE s.empresa_codigo = 'AFIS'
    ON CONFLICT (cuenta_codigo, empresa_codigo) DO NOTHING;
    GET DIAGNOSTICS v_nuevas = ROW_COUNT;

    SELECT count(*) INTO v_destino
      FROM core.plan_cuenta_empresa WHERE empresa_codigo = 'CICLO';

    IF v_nuevas = 0 THEN
        PERFORM pg_temp._rep('4 · plan_cuenta_empresa ← AFIS', 'SKIP',
            format('nada que copiar; CICLO ya tenía %s filas (AFIS: %s)',
                   v_destino, v_origen));
    ELSE
        PERFORM pg_temp._rep('4 · plan_cuenta_empresa ← AFIS', 'OK',
            format('%s filas nuevas; CICLO queda con %s (AFIS: %s)',
                   v_nuevas, v_destino, v_origen));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('4 · plan_cuenta_empresa ← AFIS', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 5 · core.area_empresa ← AFIS (las 10)
-- ---------------------------------------------------------------------
-- Mismo default estricto que el plan de cuentas: sin fila, el área NO
-- aplica, y POST /vouchers responde 400 "área no aplica a empresa". Este
-- es además el que ya rompió una vez en producción: area_empresa estaba
-- vacía y el flujo /gastos (que imputa Marketing→COM y Desarrollo→TIC) no
-- podía guardar nada.
--
-- Se copian las 10 aunque tres no le vayan a servir nunca a un FIP: ING
-- (ingeniería), IDI (I+D+i) y RRH (personas) — el fondo no tiene empleados
-- ni desarrolla nada. Quedan habilitadas igual porque una lista corta de
-- áreas no protege de nada y una faltante bloquea un voucher; pero que
-- estén no las convierte en útiles, y en los reportes por área van a salir
-- en cero para siempre. Anotado para el entregable, no para el código.
DO $do$
DECLARE
    v_nuevas  BIGINT;
    v_destino BIGINT;
    v_err     TEXT;
BEGIN
    INSERT INTO core.area_empresa (area_codigo, empresa_codigo, aplica)
    SELECT s.area_codigo, 'CICLO', s.aplica
      FROM core.area_empresa s
     WHERE s.empresa_codigo = 'AFIS'
    ON CONFLICT (area_codigo, empresa_codigo) DO NOTHING;
    GET DIAGNOSTICS v_nuevas = ROW_COUNT;

    SELECT count(*) INTO v_destino
      FROM core.area_empresa WHERE empresa_codigo = 'CICLO';

    IF v_nuevas = 0 THEN
        PERFORM pg_temp._rep('5 · area_empresa ← AFIS', 'SKIP',
            format('nada que copiar; CICLO ya tenía %s áreas', v_destino));
    ELSE
        PERFORM pg_temp._rep('5 · area_empresa ← AFIS', 'OK',
            format('%s áreas nuevas; CICLO queda con %s', v_nuevas, v_destino));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('5 · area_empresa ← AFIS', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 6 · core.approval_rules — la regla universal de 2 firmas
-- ---------------------------------------------------------------------
-- Misma regla que las otras 11: ['GG','DIRECTOR'], sin tipo de voucher,
-- sin tope, sin balance_treatment, min_amount 0, priority 100. Es el
-- invariante de las 2 firmas expresado en datos.
--
-- Sin esta fila, el voucher se crea, pasa a PENDING y ahí se queda: el
-- approve responde 400 "No hay regla de aprobación configurada" y —lo
-- peor— GET /vouchers/mis-pendientes lo descarta en SILENCIO, así que no
-- aparece en la bandeja de NADIE. Un voucher invisible es peor que un
-- error visible.
--
-- 🔴 GUARDA CON `WHERE NOT EXISTS`, NO CON `ON CONFLICT DO NOTHING`.
--   core.approval_rules no tiene NINGÚN índice único: sólo la PK serial
--   rule_id y tres índices NO únicos (idx_approval_rules_empresa,
--   idx_approval_rules_priority, ix_approval_rules_empresa_active). Un
--   ON CONFLICT DO NOTHING sin conflict target no tiene con qué chocar y
--   nunca dispara — la migración 0048 lo usa y por eso es un no-op ahí.
--   Copiar ese patrón acá significaría que CADA re-corrida agrega una
--   regla duplicada, y dos reglas activas con la misma priority hacen que
--   cuál gana dependa del orden físico de las filas. El paso 12 verifica
--   que quede exactamente UNA.
DO $do$
DECLARE
    v_nuevas BIGINT;
    v_total  BIGINT;
    v_err    TEXT;
BEGIN
    INSERT INTO core.approval_rules (
        empresa_codigo, voucher_tipo, min_amount, max_amount,
        balance_treatment, required_roles, reinforced, priority, descripcion
    )
    -- Los NULL van casteados: en un INSERT … SELECT sin FROM, un NULL
    -- pelado se resuelve como `unknown` y la coerción al tipo destino
    -- depende del contexto. Explícito, no hay contexto que adivinar.
    -- Los tres significan "comodín", no "sin dato": voucher_tipo NULL =
    -- todos los tipos, max_amount NULL = sin tope, balance_treatment NULL
    -- = GASTO y ACTIVACION.
    SELECT 'CICLO', NULL::TEXT, 0, NULL::NUMERIC(18, 2), NULL::TEXT,
           ARRAY['GG', 'DIRECTOR']::TEXT[], FALSE, 100,
           'V5++ ola AC: workflow Cehta — 2 firmas siempre (Líder empresa → CFO Cehta)'
     WHERE NOT EXISTS (
        SELECT 1 FROM core.approval_rules
         WHERE empresa_codigo = 'CICLO'
           AND active
           AND required_roles = ARRAY['GG', 'DIRECTOR']::TEXT[]
     );
    GET DIAGNOSTICS v_nuevas = ROW_COUNT;

    SELECT count(*) INTO v_total
      FROM core.approval_rules WHERE empresa_codigo = 'CICLO' AND active;

    IF v_nuevas = 0 THEN
        PERFORM pg_temp._rep('6 · approval_rules 2 firmas', 'SKIP',
            format('CICLO ya tenía la regla ["GG","DIRECTOR"]; %s reglas '
                   'activas en total', v_total));
    ELSE
        PERFORM pg_temp._rep('6 · approval_rules 2 firmas', 'OK',
            format('regla creada ["GG","DIRECTOR"] min_amount=0 priority=100; '
                   '%s reglas activas en total', v_total));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('6 · approval_rules 2 firmas', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 7 · Correlativos — SE VERIFICAN, NO SE SIEMBRAN
-- ---------------------------------------------------------------------
-- Las dos tablas de correlativos se autocrean su fila en el primer uso, y
-- sembrarlas a mano va de inútil a peligroso:
--
--   · core.voucher_correlativos la llena la función Postgres
--     core.next_voucher_code(empresa, anio, tipo), que hace
--     INSERT … VALUES (…, 1) ON CONFLICT DO UPDATE SET ultimo = ultimo + 1
--     RETURNING. Sembrar con ultimo = 1 haría que el primer voucher real
--     de CICLO fuera el 00002: un salto de correlativo, o sea la violación
--     directa del invariante "correlativo sin saltos". Sembrar con
--     ultimo = 0 es exactamente lo que la función va a encontrar y sumar,
--     o sea una escritura que no cambia nada.
--   · core.correlativos (tipos OC/COM/VEN/EGR/ING) la upsertean sus dos
--     únicos consumidores: auto_create_oc_from_inbox (tipo 'OC') y
--     oc_cuotas (tipo 'COM'). La creación manual de OC ni siquiera la
--     toca: POST /ordenes-compra exige numero_oc en el body.
--
-- Lo que SÍ hay que verificar es que el mecanismo del que depende ese "se
-- crea solo" esté realmente en la BD, porque el deploy no corre
-- migraciones y core.correlativos vive en un .sql suelto que se aplica a
-- mano (round152DDDDD). "El código dice que la BD lo hace" no es
-- evidencia; esto lo mira.
DO $do$
DECLARE
    v_func BOOLEAN;
    v_tabla BOOLEAN;
    v_err  TEXT;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_proc p
          JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'core' AND p.proname = 'next_voucher_code'
    ) INTO v_func;

    SELECT to_regclass('core.correlativos') IS NOT NULL INTO v_tabla;

    IF v_func AND v_tabla THEN
        PERFORM pg_temp._rep('7 · correlativos', 'SKIP',
            'no se siembra nada: core.next_voucher_code existe y hace el UPSERT '
            'de core.voucher_correlativos en el primer voucher; core.correlativos '
            'existe y la upsertean sus consumidores. Sembrar con ultimo=1 sería '
            'un salto de correlativo y con 0 sería un no-op.');
    ELSIF NOT v_func THEN
        PERFORM pg_temp._rep('7 · correlativos', 'FAIL',
            'NO existe la función core.next_voucher_code (migración 0033). Sin '
            'ella no hay quien genere el código de voucher para NINGUNA empresa, '
            'no sólo para CICLO. Aplicar 0033 antes de emitir vouchers.');
    ELSE
        PERFORM pg_temp._rep('7 · correlativos', 'FAIL',
            'NO existe la tabla core.correlativos (round152DDDDD_correlativos_'
            'table.sql, que se aplica a mano). Sin ella fallan la OC creada '
            'desde el inbox y la reserva de correlativos de oc_cuotas — para '
            'todas las empresas, no sólo CICLO.');
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('7 · correlativos', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 8 · COMMENT ON
-- ---------------------------------------------------------------------
-- El comentario va sobre la TABLA y no sobre la fila (Postgres no comenta
-- filas), así que dice lo que hay que saber de CICLO dentro del comentario
-- general de core.empresas. Es el único lugar donde alguien que abra la BD
-- sin este script al lado se puede enterar de por qué el fondo no tiene
-- RUT.
DO $do$
DECLARE
    v_err TEXT;
BEGIN
    COMMENT ON TABLE core.empresas IS
        'Empresas y fondos de la plataforma. Todas cuelgan de la única '
        'organización core.organizations.org_id = ''CEHTA''; el acceso real NO '
        'lo da org_id sino core.user_company_roles, empresa por empresa, así '
        'que compartir organización no significa que nadie vea nada de nadie. '
        'CICLO (Fondo de Inversión Privado Ciclo Capital, Cap. V Ley 20.712, '
        'administrado por AFIS) está acá con rut = NULL A PROPÓSITO: el RUT '
        'del fondo todavía no se emitió/informó y está marcado FALTA en '
        'docs/DATOS_CICLO_CAPITAL.md §1 — NO inventarlo, cargarlo con un '
        'UPDATE cuando exista. Lo mismo vale para telefono, '
        'representante_legal y los tres gerente_general_*. La columna rut es '
        'UNIQUE pero NULLABLE y Postgres admite N NULLs en un único, así que '
        'CICLO convive con CEHTA, que también nació sin RUT.';

    COMMENT ON COLUMN core.empresas.rut IS
        'RUT en formato 12.345.678-9. NULLABLE y UNIQUE: hay empresas dadas de '
        'alta antes de tener el RUT confirmado (CEHTA, CICLO). NULL significa '
        '"todavía no lo sabemos", NUNCA "no tiene" — y jamás se rellena con '''' '
        'para "completar el dato": la cadena vacía pasa el UNIQUE una sola vez '
        'y rompe el alta de la siguiente empresa sin RUT.';

    COMMENT ON COLUMN core.empresas.auto_send_oc_emails IS
        'Master switch por empresa del auto-envío de la OC a los firmantes. '
        'Requiere gerente_general_email cargado (o oc_firma_colectiva con '
        'firmantes_extra): con el switch en TRUE y sin destinatario, cada alta '
        'de OC deja "Sin destinatarios válidos" en ordenes_compra.oc_send_error '
        'y limpia el oc_sent_at reservado. Por eso CICLO nace en FALSE — no '
        'porque el fondo no deba mandar OCs, sino porque todavía no hay a quién. '
        'Se prende desde /admin/oc-branding el día que se cargue el firmante.';

    PERFORM pg_temp._rep('8 · COMMENT ON', 'OK',
        'core.empresas (tabla) + rut + auto_send_oc_emails');
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('8 · COMMENT ON', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 9 · VERIFICACIÓN · plan de cuentas, EXCEPT en las dos direcciones
-- ---------------------------------------------------------------------
-- Es el criterio del DoD del contrato (§6): "CICLO es idéntica a AFIS en
-- plan de cuentas (faltan=0, sobran=0)". Las dos direcciones, no una: que
-- CICLO tenga todo lo de AFIS no descarta que tenga además cuentas que
-- AFIS no habilita, y eso también es una diferencia que hay que ver.
--
-- Se compara el conjunto HABILITADO (habilitada = TRUE) y no el de filas:
-- una fila con habilitada = FALSE es equivalente, para la API, a no tener
-- fila. Comparar filas daría "iguales" con dos empresas que en la práctica
-- imputan a cuentas distintas.
--
-- No se compara contra el número 212 hardcodeado: 212 es cuántas cuentas
-- tiene el plan hoy. El invariante es faltan=0 ∧ sobran=0, que sigue
-- valiendo el día que el plan crezca.
DO $do$
DECLARE
    v_faltan   BIGINT;
    v_sobran   BIGINT;
    v_n        BIGINT;
    v_muestra  TEXT;
    v_err      TEXT;
BEGIN
    SELECT count(*) INTO v_faltan FROM (
        SELECT cuenta_codigo FROM core.plan_cuenta_empresa
         WHERE empresa_codigo = 'AFIS' AND habilitada
        EXCEPT
        SELECT cuenta_codigo FROM core.plan_cuenta_empresa
         WHERE empresa_codigo = 'CICLO' AND habilitada
    ) x;

    SELECT count(*) INTO v_sobran FROM (
        SELECT cuenta_codigo FROM core.plan_cuenta_empresa
         WHERE empresa_codigo = 'CICLO' AND habilitada
        EXCEPT
        SELECT cuenta_codigo FROM core.plan_cuenta_empresa
         WHERE empresa_codigo = 'AFIS' AND habilitada
    ) x;

    SELECT count(*) INTO v_n
      FROM core.plan_cuenta_empresa
     WHERE empresa_codigo = 'CICLO' AND habilitada;

    -- `v_n > 0` NO es decorativo: EXCEPT entre dos conjuntos VACIOS da 0 y 0,
    -- asi que sin el piso esta verificacion declaraba "OK, faltan=0 sobran=0"
    -- sobre una empresa SIN NINGUNA CUENTA — que es exactamente el estado que
    -- este script existe para evitar. Es lo que le pasa hoy a PANIMAVIDA.
    IF v_faltan = 0 AND v_sobran = 0 AND v_n > 0 THEN
        PERFORM pg_temp._rep('9 · plan de cuentas CICLO = AFIS', 'OK',
            format('faltan=0 sobran=0 · %s cuentas habilitadas', v_n));
    ELSIF v_n = 0 THEN
        PERFORM pg_temp._rep('9 · plan de cuentas CICLO = AFIS', 'FAIL',
            'CICLO quedo con CERO cuentas habilitadas. Coincide con AFIS solo '
            'porque AFIS tambien esta vacia: sin plan de cuentas no se puede '
            'imputar un solo voucher.');
    ELSE
        SELECT string_agg(c, ', ' ORDER BY c) INTO v_muestra FROM (
            SELECT cuenta_codigo AS c FROM (
                SELECT cuenta_codigo FROM core.plan_cuenta_empresa
                 WHERE empresa_codigo = 'AFIS' AND habilitada
                EXCEPT
                SELECT cuenta_codigo FROM core.plan_cuenta_empresa
                 WHERE empresa_codigo = 'CICLO' AND habilitada
            ) f ORDER BY cuenta_codigo LIMIT 25
        ) m;

        PERFORM pg_temp._rep('9 · plan de cuentas CICLO = AFIS', 'FAIL',
            format('faltan=%s sobran=%s (CICLO tiene %s habilitadas). '
                   'Primeras que faltan: %s',
                   v_faltan, v_sobran, v_n, COALESCE(v_muestra, '—')));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('9 · plan de cuentas CICLO = AFIS', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 10 · VERIFICACIÓN · las 5 cuentas del motor de asientos
-- ---------------------------------------------------------------------
-- Vienen dentro de la copia de AFIS, pero se chequean por nombre porque
-- son las que usa asiento_desde_oc.py para armar el asiento propuesto al
-- generar un voucher desde una OC. Si falta UNA, el voucher se crea y
-- revienta recién al guardarle las líneas — con un 400 que nombra la
-- cuenta pero no explica que el problema es de configuración de la
-- empresa. Nombrarla acá ahorra ese rato.
DO $do$
DECLARE
    v_faltan TEXT;
    v_err    TEXT;
BEGIN
    -- `AS req(cuenta)` nombra tabla Y columna por separado a propósito: con
    -- `unnest(...) c` a secas, `c` es a la vez alias de tabla y de columna y
    -- hay que confiar en el orden de resolución de nombres de Postgres.
    SELECT string_agg(req.cuenta, ', ' ORDER BY req.cuenta) INTO v_faltan
      FROM unnest(ARRAY['4201-02', '2105-04', '2102-11', '1113-02', '2102-01'])
           AS req(cuenta)
     WHERE NOT EXISTS (
        SELECT 1 FROM core.plan_cuenta_empresa pce
         WHERE pce.empresa_codigo = 'CICLO'
           AND pce.cuenta_codigo = req.cuenta
           AND pce.habilitada
     );

    IF v_faltan IS NULL THEN
        PERFORM pg_temp._rep('10 · cuentas del motor de asientos', 'OK',
            'las 5 habilitadas: 4201-02 honorarios · 2105-04 retención · '
            '2102-11 honorarios por pagar · 1113-02 IVA crédito · '
            '2102-01 facturas por pagar');
    ELSE
        PERFORM pg_temp._rep('10 · cuentas del motor de asientos', 'FAIL',
            format('no habilitadas para CICLO: %s — el voucher desde OC no va '
                   'a poder guardar sus líneas', v_faltan));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('10 · cuentas del motor de asientos', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 11 · VERIFICACIÓN · áreas
-- ---------------------------------------------------------------------
DO $do$
DECLARE
    v_ciclo  BIGINT;
    v_afis   BIGINT;
    v_faltan TEXT;
    v_err    TEXT;
BEGIN
    SELECT count(*) INTO v_ciclo
      FROM core.area_empresa WHERE empresa_codigo = 'CICLO' AND aplica;
    SELECT count(*) INTO v_afis
      FROM core.area_empresa WHERE empresa_codigo = 'AFIS' AND aplica;

    SELECT string_agg(c, ', ' ORDER BY c) INTO v_faltan FROM (
        SELECT area_codigo AS c FROM core.area_empresa
         WHERE empresa_codigo = 'AFIS' AND aplica
        EXCEPT
        SELECT area_codigo FROM core.area_empresa
         WHERE empresa_codigo = 'CICLO' AND aplica
    ) x;

    -- Mismo piso que el paso 9: `v_ciclo > 0`. Sin areas, la imputacion
    -- triple (cuenta x proyecto x area) no se puede completar.
    IF v_ciclo = 0 THEN
        PERFORM pg_temp._rep('11 · áreas CICLO = AFIS', 'FAIL',
            'CICLO quedo con CERO areas. Coincide con AFIS solo porque AFIS '
            'tambien esta vacia.');
    ELSIF v_faltan IS NULL AND v_ciclo = v_afis THEN
        PERFORM pg_temp._rep('11 · áreas CICLO = AFIS', 'OK',
            format('%s áreas aplican (igual que AFIS). Recordatorio para el '
                   'entregable: ING, IDI y RRH van a quedar en cero para '
                   'siempre — un FIP no tiene ingeniería, ni I+D, ni empleados.',
                   v_ciclo));
    ELSE
        PERFORM pg_temp._rep('11 · áreas CICLO = AFIS', 'FAIL',
            format('CICLO=%s AFIS=%s · faltan: %s',
                   v_ciclo, v_afis, COALESCE(v_faltan, '—')));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('11 · áreas CICLO = AFIS', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 12 · VERIFICACIÓN · exactamente UNA regla de aprobación activa
-- ---------------------------------------------------------------------
-- Si esto da 2 o más, alguien corrió un alta sin el guard `WHERE NOT
-- EXISTS` del paso 6 (o la migración 0048 con su ON CONFLICT que no
-- dispara). Dos reglas activas con la misma priority hacen que cuál gane
-- dependa del orden físico de las filas: hay que borrar la sobrante a
-- mano, no dejarlo pasar.
DO $do$
DECLARE
    v_n     BIGINT;
    v_roles TEXT;
    v_err   TEXT;
BEGIN
    SELECT count(*) INTO v_n
      FROM core.approval_rules WHERE empresa_codigo = 'CICLO' AND active;

    SELECT string_agg(array_to_string(required_roles, '+'), ' | ' ORDER BY rule_id)
      INTO v_roles
      FROM core.approval_rules WHERE empresa_codigo = 'CICLO' AND active;

    IF v_n = 1 THEN
        PERFORM pg_temp._rep('12 · una sola regla activa', 'OK',
            format('1 regla: %s — 2 firmas, el invariante en datos', v_roles));
    ELSIF v_n = 0 THEN
        PERFORM pg_temp._rep('12 · una sola regla activa', 'FAIL',
            'CICLO no tiene NINGUNA regla activa: sus vouchers van a quedar '
            'atrapados en PENDING y no van a aparecer en la bandeja de nadie.');
    ELSE
        PERFORM pg_temp._rep('12 · una sola regla activa', 'FAIL',
            format('%s reglas activas (%s) — hay duplicados. Borrar los '
                   'sobrantes a mano; con la misma priority, cuál gana depende '
                   'del orden físico de las filas.', v_n, v_roles));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('12 · una sola regla activa', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 13 · VERIFICACIÓN · diff CICLO vs AFIS en core.empresas
-- ---------------------------------------------------------------------
-- Se compara columna por columna sin enumerarlas: to_jsonb(fila) +
-- jsonb_each_text. Enumerar a mano garantiza que el día que alguien
-- agregue una columna a core.empresas por SQL suelto (ya pasó 15 veces:
-- el ORM mapea 12 columnas y la tabla tiene 27) esta verificación deje de
-- verla en silencio.
--
-- Se emiten DOS líneas de reporte, con propósitos distintos:
--   13  = la foto completa de qué difiere, siempre OK — es informativa.
--   13b = las columnas que DEBEN coincidir. Ahí sí, FAIL.
--
-- Por qué la lista de "deben coincidir" es tan corta: casi todo lo que
-- difiere entre CICLO y AFIS difiere PORQUE son entidades distintas
-- (identidad, branding, contactos, los campos FALTA). Lo que no puede
-- diferir es lo que las hace la misma clase de objeto dentro de la
-- plataforma: la organización, si está activa, y las dos convenciones que
-- afectan cómo se imprime y se firma.
DO $do$
DECLARE
    v_diff TEXT;
    v_err  TEXT;
BEGIN
    -- to_jsonb(e) y no to_jsonb(e.*): con `.*` Postgres puede expandir la
    -- fila en N argumentos sueltos, y to_jsonb recibe uno solo. El alias
    -- pelado es la referencia a la fila completa, sin ambigüedad.
    WITH a AS (SELECT to_jsonb(e) AS j FROM core.empresas e WHERE e.codigo = 'AFIS'),
         c AS (SELECT to_jsonb(e) AS j FROM core.empresas e WHERE e.codigo = 'CICLO')
    SELECT string_agg(k.key, ', ' ORDER BY k.key)
      INTO v_diff
      FROM a, c, LATERAL jsonb_each_text(a.j) k
     WHERE k.value IS DISTINCT FROM (c.j ->> k.key);

    IF v_diff IS NULL THEN
        PERFORM pg_temp._rep('13 · diff CICLO vs AFIS (informativo)', 'OK',
            'ninguna columna difiere — sospechoso: al menos codigo, '
            'razon_social y logo tendrían que diferir. ¿Existen las dos filas?');
    ELSE
        PERFORM pg_temp._rep('13 · diff CICLO vs AFIS (informativo)', 'OK',
            format('difieren: %s · ESPERADAS todas las de identidad '
                   '(empresa_id, codigo, razon_social, rut, giro, direccion, '
                   'telefono, representante_legal, email_firmante, pagina_web, '
                   'created_at/updated_at), de branding (logo_dropbox_path, '
                   'oc_color_primario, oc_template, oc_prefix — AFIS lo tiene '
                   'NULL y CICLO ''OC''), de firmantes (los FALTA de la ficha) '
                   'y de email (emails_oc_cc, auto_send_oc_emails=FALSE hasta '
                   'que haya firmante). locked_* difiere si AFIS cerró algún '
                   'período: CICLO es nueva y no cerró ninguno.', v_diff));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('13 · diff CICLO vs AFIS (informativo)', 'FAIL', v_err);
END;
$do$;

DO $do$
DECLARE
    v_mal TEXT;
    v_err TEXT;
BEGIN
    WITH a AS (SELECT to_jsonb(e) AS j FROM core.empresas e WHERE e.codigo = 'AFIS'),
         c AS (SELECT to_jsonb(e) AS j FROM core.empresas e WHERE e.codigo = 'CICLO')
    SELECT string_agg(
               format('%s (AFIS=%s / CICLO=%s)',
                      k.key,
                      COALESCE(k.value, 'NULL'),
                      COALESCE(c.j ->> k.key, 'NULL')),
               ' · ' ORDER BY k.key)
      INTO v_mal
      FROM a, c, LATERAL jsonb_each_text(a.j) k
     WHERE k.key IN ('org_id', 'activo', 'ciudad', 'oc_firma_colectiva')
       AND k.value IS DISTINCT FROM (c.j ->> k.key);

    IF v_mal IS NULL THEN
        PERFORM pg_temp._rep('13b · columnas que DEBEN coincidir', 'OK',
            'org_id, activo, ciudad y oc_firma_colectiva coinciden con AFIS');
    ELSE
        PERFORM pg_temp._rep('13b · columnas que DEBEN coincidir', 'FAIL',
            format('%s — org_id distinto rompe el scope; activo=FALSE deja el '
                   'fondo invisible; ciudad cargada duplica "Las Condes" en el '
                   'PDF (el template concatena direccion + ciudad); '
                   'oc_firma_colectiva=TRUE sin firmantes_extra deja la OC sin '
                   'destinatario.', v_mal));
    END IF;
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('13b · columnas que DEBEN coincidir', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- Paso 14 · INFORMATIVO · accesos y la discrepancia de email
-- ---------------------------------------------------------------------
-- Este paso NO escribe nada. Existe porque el alta deja el fondo invisible
-- y hay que decirlo, no porque haya algo que arreglar acá.
--
-- La discrepancia se REPORTA, no se resuelve: la ficha (§3 y §4) dice que
-- el email de Juan Pablo Velasco es jpvelasco@ciclocapital.cl, y en la
-- plataforma existe un usuario jpvelasco@cehtacapital.com que nunca entró.
-- Pueden ser la misma persona con dos casillas o dos altas distintas.
-- Elegir una por nuestra cuenta sería darle acceso al fondo a una
-- identidad que nadie confirmó. Lo decide Nicolás.
--
-- Lee auth.users (Supabase). Si el rol con el que se corre el script no
-- tiene permiso ahí, este paso reporta FAIL y no pasa nada más: es
-- informativo y no bloquea el alta.
DO $do$
DECLARE
    v_encontrados TEXT;
    v_roles       BIGINT;
    v_err         TEXT;
BEGIN
    SELECT count(*) INTO v_roles
      FROM core.user_company_roles WHERE empresa_codigo = 'CICLO' AND active;

    SELECT string_agg(email, ', ' ORDER BY email) INTO v_encontrados
      FROM auth.users
     WHERE lower(email) IN ('jpvelasco@ciclocapital.cl',
                            'jpvelasco@cehtacapital.com');

    PERFORM pg_temp._rep('14 · accesos (informativo, no escribe)', 'OK',
        format('CICLO tiene %s roles activos en user_company_roles. Con 0, '
               'sólo los admin ven el fondo (todo lo demás responde 403 y la '
               'tentativa queda en audit.scope_violations). '
               'DISCREPANCIA A RESOLVER POR NICOLÁS: la ficha dice '
               'jpvelasco@ciclocapital.cl; en auth.users hay [%s]. NO se '
               'asigna acceso desde acá.',
               v_roles, COALESCE(v_encontrados, 'ninguno de los dos')));
EXCEPTION WHEN others THEN
    GET STACKED DIAGNOSTICS v_err = MESSAGE_TEXT;
    PERFORM pg_temp._rep('14 · accesos (informativo, no escribe)', 'FAIL', v_err);
END;
$do$;

-- ---------------------------------------------------------------------
-- REPORTE (este es el result set que hay que mirar)
-- ---------------------------------------------------------------------
SELECT paso, estado, COALESCE(detalle, '') AS detalle
  FROM pg_temp._rep_ciclo
 ORDER BY n;

COMMIT;

-- ---------------------------------------------------------------------
-- Verificación manual (correr aparte, después del COMMIT)
-- ---------------------------------------------------------------------
-- -- La fila madre, con lo que importa a la vista:
-- SELECT codigo, razon_social, rut, org_id, activo, oc_template,
--        oc_color_primario, oc_prefix, logo_dropbox_path, pagina_web,
--        auto_send_oc_emails, gerente_general_nombre, gerente_general_email
--   FROM core.empresas WHERE codigo IN ('AFIS', 'CICLO') ORDER BY codigo;
--
-- -- Anatomía completa de las 12 empresas, para ver que CICLO no quedó
-- -- corta (y de paso, si PANIMAVIDA sigue vacía — su alta no sembró nada
-- -- de esto y es el mismo agujero, con una empresa ya en producción):
-- SELECT e.codigo,
--        (SELECT count(*) FROM core.plan_cuenta_empresa p
--          WHERE p.empresa_codigo = e.codigo AND p.habilitada)   AS cuentas,
--        (SELECT count(*) FROM core.area_empresa a
--          WHERE a.empresa_codigo = e.codigo AND a.aplica)       AS areas,
--        (SELECT count(*) FROM core.approval_rules r
--          WHERE r.empresa_codigo = e.codigo AND r.active)       AS reglas,
--        (SELECT count(*) FROM core.user_company_roles u
--          WHERE u.empresa_codigo = e.codigo AND u.active)       AS accesos
--   FROM core.empresas e ORDER BY e.codigo;
--
-- -- Las cuentas que AFIS habilita y CICLO no (debe dar 0 filas):
-- SELECT cuenta_codigo FROM core.plan_cuenta_empresa
--  WHERE empresa_codigo = 'AFIS' AND habilitada
-- EXCEPT
-- SELECT cuenta_codigo FROM core.plan_cuenta_empresa
--  WHERE empresa_codigo = 'CICLO' AND habilitada;
--
-- -- La regla de aprobación (debe dar exactamente 1 fila):
-- SELECT rule_id, required_roles, min_amount, max_amount, priority, active
--   FROM core.approval_rules WHERE empresa_codigo = 'CICLO';
--
-- -- Correlativos: ANTES del primer voucher debe dar 0 filas; DESPUÉS,
-- -- una fila con ultimo = 1. Si acá aparece ultimo = 1 sin que exista
-- -- ningún voucher, alguien sembró la fila y el primer voucher va a
-- -- saltar al 00002.
-- SELECT * FROM core.voucher_correlativos WHERE empresa_codigo = 'CICLO';
-- SELECT * FROM core.correlativos         WHERE empresa_codigo = 'CICLO';
