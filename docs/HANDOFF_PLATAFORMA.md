# HANDOFF · Plataforma Ram-Cehta completa

> **Para qué sirve este archivo:** abrir una sesión de Claude en CUALQUIER
> computador y que sepa todo lo que sabe la sesión original — arquitectura,
> empresas, módulos, trampas de ingeniería, procedimientos y pendientes.
> Actualizado: **2026-08-26** · último commit: `7499616`.
>
> **Cómo usarlo en otro computador:**
> 1. Cloná el repo: `git clone https://github.com/Nikolaaa11/Ram-Cehta.git`
> 2. Abrí Claude Code en la carpeta y pegá este briefing:
>
> *"Soy Nicolás Rietta, opero Ram-Cehta (FIP CEHTA ESG). Leé
> `docs/HANDOFF_PLATAFORMA.md` completo, después
> `docs/SUPER_PROMPT_MAESTRO.md` (los 22 invariantes) y `docs/BACKLOG.md`.
> Después ayudame con: ___"*
>
> Sin nada de esto adentro hay secretos: las claves viven en Fly secrets,
> Supabase y `backend/.env` (gitignored). Este archivo es seguro de subir.

---

## 1 · Qué es la plataforma

Plataforma operativa del **FIP CEHTA ESG** y sus empresas: órdenes de
compra, vouchers contables con doble firma, pagos, remuneraciones, RRHH,
F29/F22, integraciones SII/Nubox/Dropbox/Email.

| Cosa | Valor |
|---|---|
| Frontend | Next.js 15 en Vercel — **URL canónica `cehta-capital.vercel.app`** (`ram-cehta.vercel.app` es alias) |
| Backend | FastAPI en Fly.io, app `cehta-backend`, región `gru`, **16 máquinas** (app×3 + crons) |
| BD | Supabase Postgres, esquema `core` (~130 tablas) + `audit` + `app` |
| Contabilidad oficial | La lleva **MCG Consultores** (externa, Nubox). La plataforma calcula y CONCILIA, no reemplaza al contador |
| Operador | Nicolás Rietta — no ingeniero: darle comandos exactos y pasos concretos |
| IA de la plataforma | Anthropic, modelo **Sonnet** (nunca Haiku) |

## 2 · Las 13 empresas

`AFIS · CEHTA · CENERGY · CICLO · CSL · DTE · EVOQUE · FIP_CEHTA ·
PANIMAVIDA · REVTECH · RHO · TECMAVIDA · TRONGKAI` — todas bajo la única
organización `CEHTA`; el acceso real se controla empresa por empresa vía
`core.user_company_roles`.

Datos que cuestan caro si se olvidan:

- **CICLO = Inversiones Ciclo Capital SpA** (RUT 78.447.248-5), la sociedad
  operativa — **NO** el Fondo de Inversión Privado Ciclo Capital (mismo
  nombre de fantasía, misma dirección, RUT del fondo aún FALTA). Giro en
  NULL a propósito (su e-RUT no trae glosa). Ficha: `docs/DATOS_CICLO_CAPITAL.md`.
- **TECMAVIDA = Tecnología y Ecomateriales SpA** (78.343.203-K), giro
  valorización de residuos, en el MISMO predio que Panimávida Energy
  (Panimávida PC 3 Lote 3, Colbún) — no es duplicado, son dos sociedades.
- **Restricción legal de Ciclo/AFIS**: nunca "garantizado" (art. 61 Ley
  18.045), nunca "administradora general de fondos" (art. 90 Ley 20.712).
  Hay un validador angosto en `backend/app/domain/value_objects/lenguaje_legal.py`.
- Una empresa "completa" necesita: fila en `empresas` + ~212
  `plan_cuenta_empresa` + 1 `approval_rules` (GG+DIRECTOR, 2 firmas) +
  áreas + branding OC. PANIMAVIDA se creó a medias una vez y no podía
  aprobar nada — verificar completitud contra RHO.
- Regla de aprobación en TODAS: **2 firmas de personas DISTINTAS**
  (GG + DIRECTOR, anti-doble-firma por `approver_user_id`).
  ⚠️ TECMAVIDA y CICLO tienen UN solo firmante → no pueden aprobar
  vouchers hasta sumar un DIRECTOR (candidato natural: Guido, que ya es
  DIRECTOR en las otras 11).

## 3 · Mapa de módulos (estado 2026-08-26)

### Órdenes de compra (el módulo más trabajado)
- **4 tipos tributarios**: FACTURA / FACTURA_EXENTA / BOLETA / HONORARIOS
  (retención 2ª categoría por año desde `core.tax_config`: 2026 = 15,25%).
  `total` = valor contrato; `total_a_pagar` = líquido. IVA% editable por OC;
  la **UF SÍ lleva IVA** (es unidad de cuenta chilena), USD no.
- **PDF** formato "Panimávida" (WeasyPrint, carta formal
  PROVEEDOR/MANDANTE + hoja de firmas) para las 13 empresas, cada una con
  logo y color. Banco de preview local: `backend/scripts/preview_oc.py`
  (Chromium; WeasyPrint no corre en Windows).
- **Condiciones generales opcionales** por OC (`incluye_condiciones`,
  default TRUE — sacarlas es deliberado).
- **Correlativo automático Y editable**: `GET /ordenes-compra/siguiente-numero`
  APRENDE el formato de cada empresa comparando sus dos últimos números
  (PANIMAVIDA cuenta adelante, TECMAVIDA al final, en DTE el 2026 es el
  año). Las eliminadas también ocupan número.
- **Carga rápida**: pegado desde Excel (¡punto = miles en Chile!),
  descripciones que crecen (`TextareaAutosize`), sin decimales de relleno.
  Componentes compartidos: `ItemizadoEditor`, `TotalesPreview`.
- **OC con IA** (`/importar` y `/desde-mensaje`): extrae unidades, detecta
  tipo tributario (honorarios/exenta) explicando POR QUÉ, y **concilia** el
  neto del documento contra la suma de líneas — avisa, no elige.
- **Editar ítems después**: `PUT /ordenes-compra/{id}/items` recalcula todo
  server-side. OC firmada o con plata girada NO cambia de monto (409).
- **Papelera**: se puede borrar SIEMPRE (incluso firmada) pero queda
  constancia INMUTABLE en `core.oc_eliminadas` (misma transacción que el
  DELETE, trigger bloquea UPDATE/DELETE, motivo obligatorio ≥10 chars).
  Pantalla: `/ordenes-compra/eliminadas`. Garantía: "no hay borrado sin
  constancia", no "siempre se borra".
- **Paridad de totales frontend↔backend**: snapshot compartido
  `backend/tests/fixtures/oc_totales_esperado.json` verificado por las DOS
  suites (44 tests Python + 72 TS con BigInt). Si tocás una regla de un
  lado, la otra suite falla. Regenerar: `python scripts/gen_snapshot_totales_oc.py`.

### Vouchers
- Partida doble con triggers REALES en BD (instalados 2026-08-10 — antes
  las funciones existían sin triggers). 2 firmas, correlativo por
  empresa/año/tipo (la fila se crea sola con ON CONFLICT).
- Conexión OC→voucher (`vouchers.oc_id`), vouchers desde hitos de pago
  (sobre el LÍQUIDO, no el bruto). PDF con desglose tributario.
- Pre-vouchers / gastos rápidos: `/gastos` → `/prevouchers` → firmas.

### Remuneraciones (nuevo, 2026-08-26)
- `/remuneraciones`, 4 subpestañas (Nómina / Calcular / Parámetros / Guía
  con ejemplos calculados EN VIVO). Gate de acceso = el de RRHH
  (`core.rrhh_allowlist` + admins).
- Motor puro `backend/app/domain/value_objects/remuneracion.py`,
  **calibrado contra el libro real de MCG** (AFIS abril 2026): la línea de
  Claudia Gotschlich cierra EXACTA (líquido 1.747.615, impuesto 33.504,74).
  Del libro se descifró: IMM $539.000, UTM abril $69.889, SIS 1,62%,
  reforma ley 21.735 = 0,1%+0,9%, mutual AFIS 2,63%, comisión AFP 1,44%.
- **El motor se niega sin UF/UTM del período** (nullables a propósito).
  Jornada 42h desde abril 2026 (ley 21.561). Rebaja del impuesto único
  DERIVADA por continuidad de tramos.
- Tablas: `remun_parametros`, `remun_afp_comisiones`,
  `remun_asignacion_familiar`, `remun_liquidaciones` (CHECK de identidad
  líquido = haberes − descuentos en BD).
- **Conciliación** contra `core.libro_remuneraciones_lineas` campo por
  campo — la definición operativa de "sin errores".

### RRHH
`/rrhh`: empleados (`core.empleados` — afp/salud/sueldo), libros de
remuneraciones subidos por Excel, costo empresa. Restringido por allowlist.

### Otros
F29/F22, SII (tablas y Fernet listos, faltan credenciales por empresa),
Nubox API (UAT activa, PROD pendiente de credenciales propias), Dropbox
(carpetas canónicas por empresa), inbox de email con clasificación IA,
transferencias (Excel para el banco), Cartas Gantt, CORFO (Claudia).

## 4 · Invariantes y trampas de ingeniería (leídas con sangre)

1. **Verificar el esquema REAL en la BD antes de escribir SQL.** Tres bugs
   en una semana por columnas inventadas (`proveedores.nombre` →
   `razon_social`; `vouchers.total` → `total_debit/credit`;
   `plan_cuenta_empresa.activa` → `habilitada`). Alembic NO refleja la BD.
2. **La trampa del cero falso**: nunca `or` / `||` / `> 0` donde 0 es
   legítimo (IVA 0, retención 0, cantidad 0). `is not None` siempre.
3. **Pydantic v2**: `str | None` SIN `= None` es campo REQUERIDO (causó
   500 en producción).
4. **El peso no tiene centavos; la UF y el USD sí** (2 decimales). El
   redondeo es por moneda (`paso_de_moneda`), HALF_UP.
5. **Después de tocar la API**: regenerar `backend/openapi.json` (script
   inline con `app.openapi()`) y `npm run gen:types` en frontend.
6. **Verificar la UI, no sólo la API** — dos bugs críticos se escaparon
   con e2e que sólo llamaba endpoints.
7. `ON CONFLICT DO NOTHING` NO protege tablas con PK serial
   (approval_rules): usar `NOT EXISTS`.
8. GZip SIEMPRE el último `add_middleware`. Nada de estado entre requests
   en dicts de módulo (Fly corre varias máquinas — rompió el OAuth de
   Dropbox 2 meses).
9. Los 22 invariantes completos: `docs/SUPER_PROMPT_MAESTRO.md`.

## 5 · Procedimientos operativos

### Deploy
```bash
cd backend && fly deploy --app cehta-backend --strategy rolling
# ESPERAR la rotación antes de verificar:
#   fly status --app cehta-backend   (nada en replacing/starting)
cd frontend && vercel deploy --prod --yes
```
`release_command` está DESACTIVADO: **el deploy NO corre migraciones** —
todo SQL se aplica a mano (siguiente sección).

### Aplicar SQL a producción
No hay `psql` en las máquinas de Fly y `fly ssh console -C` **trunca
argumentos >32KB en silencio**. El patrón que funciona: empaquetar el .sql
como runner psycopg2 en gzip+base64 (script `empaquetar.py`: quita
meta-comandos `\...` y BEGIN/COMMIT, psycopg2 maneja la transacción,
imprime NOTICEs y `>>> APLICADO`/`ROLLBACK`). En Git Bash usar
`MSYS_NO_PATHCONV=1` para rutas `/tmp/...`.
Los scripts van en `backend/scripts/sql/` — idempotentes, con verificación
OK/FAIL adentro, y verificación con piso `> 0` (un EXCEPT entre dos
conjuntos vacíos da 0 y miente).

### Probar contra producción sin ensuciar
Neutralizar `db.commit = db.flush` + rollback al final (las sentencias se
emiten y validan, nada persiste), o crear datos reales y borrarlos con la
papelera dejando constancia. SIEMPRE contar filas residuales al final.

### Usuarios
Crear vía Supabase Admin API con `app_metadata.app_role` (sin eso el login
no funciona; `core.user_roles` solo no basta) + `core.user_roles` +
`core.user_company_roles`. Claves temporales dictables patrón
`Empresa-Palabra-NNN`. **Las claves NO se pueden listar** (bcrypt) — sólo
resetear. Si la persona YA tiene cuenta, se le agrega la empresa, no se
crea otra.

### Seguridad (persistente, verbatim)
- `nrietta@cehtacapital.com` NUNCA reset password.
- `DATABASE_URL` sólo en scripts temporales fuera del repo, borrar tras uso.
- Credenciales SII/Nubox cifradas Fernet, nunca en logs. RUT chileno = PII
  (Ley 19.628).
- Cuenta Fly/Supabase: smartcitysmog@gmail.com.

## 6 · Pendientes (prioridad al 2026-08-26)

1. **UF y UTM de agosto 2026** en Remuneraciones → Parámetros (sii.cl) —
   sin eso el mes corriente no calcula.
2. **AFP de los empleados de AFIS** (3 de 4 sin AFP en ficha RRHH; la de
   Claudia se conoce por el libro: comisión 1,44 = Capital o Cuprum;
   Benjamín parece Isapre ~2,75 UF). Después: generar-mes de abril +
   conciliación para validar los 4 contra el libro.
3. **Segundo firmante (DIRECTOR) para TECMAVIDA y CICLO** — hoy no pueden
   aprobar ningún voucher.
4. **Backups de Fly NO corren**: dar schedule a las máquinas
   `328747400a53e8` (daily), `9080e9539a3018` y `287e355a317368` (weekly).
   Único respaldo: JSON manual de junio en Documents.
5. Verificar en Previred comisiones AFP y tramos de asignación familiar
   (sembrados con últimos valores conocidos, marcados).
6. Giro de Inversiones Ciclo Capital SpA (Mi SII → Actividades económicas).
7. 2FA de Nicolás (`/me/2fa`). Usuario duplicado
   `jpvelasco@cehtacapital.com` (nunca entró) — ¿dar de baja?
8. Vouchers: `void` sobre EXECUTED sin reverso, `unlink` puede resucitar
   VOID, estado CLOSED nunca se escribe (auditado, no corregido).

## 7 · Dónde está todo

| Qué | Dónde |
|---|---|
| Invariantes (22) | `docs/SUPER_PROMPT_MAESTRO.md` |
| Backlog priorizado | `docs/BACKLOG.md` |
| Diagnósticos de esta era | `docs/MEGAPROMPT_*.md` (OC honorarios, voucher desde OC, OC con IA, remuneraciones, Ciclo) |
| Ficha Ciclo Capital | `docs/DATOS_CICLO_CAPITAL.md` |
| Skills del repo | `.claude/skills/` (auditor-plataforma, qa-produccion, cierre-mensual, etc.) |
| Preview local del PDF OC | `backend/scripts/preview_oc.py` |
| Snapshot paridad totales | `backend/tests/fixtures/oc_totales_esperado.json` |
| Suites | backend: `python -m pytest tests/unit -q` (~1624) · frontend: `npx vitest run` (156) + `npx tsc --noEmit` |
| Memoria de Claude (sólo en el computador original) | `C:\Users\DELL\.claude\projects\C--Users-DELL-Documents-000-1\memory\` |
| Handoff de sesión (sólo original) | `C:\Users\DELL\.gstack\projects\Nikolaaa11-Ram-Cehta\checkpoints\` |

> En un computador nuevo, la memoria local no existe: **este archivo la
> reemplaza**. Si Claude en la máquina nueva aprende algo importante,
> pedile que actualice ESTE archivo y lo commitee — así el conocimiento
> viaja con el repo y no queda atrapado en una máquina.
