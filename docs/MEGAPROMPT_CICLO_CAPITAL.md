# PROMPT MAESTRO · Incorporar Ciclo Capital a la plataforma

> Pedido de Nicolás: *"incorpora a ciclo capital que tenga opción a todo"*.
> Ficha de datos: `C:\Users\DELL\Downloads\DATOS_CICLO_CAPITAL.md` (LEERLA ENTERA).

## 0. Qué es Ciclo Capital y por qué NO es una empresa más

**Fondo de Inversión Privado Ciclo Capital** — Capítulo V de la Ley 20.712, no
fiscalizado por la CMF, máximo 49 partícipes. Administrado por **AFIS**, que ya
está en la plataforma (RUT 77.423.556-6) y comparte domicilio con Ciclo
(Américo Vespucio 80 of. 31, Las Condes).

Su negocio es **financiamiento inmobiliario por compraventa con pacto de
retroventa**: el fondo compra un inmueble, lo arrienda al vendedor y pacta la
retroventa. Opera en **UF**. Retorno al inversionista 12% anual en CLP,
trimestral, sobre capital efectivamente enterado.

**Eso no es una empresa operativa.** Las otras 11 de la plataforma compran a
proveedores, pagan sueldos y declaran IVA. Un FIP recibe aportes, emite cuotas
y distribuye. Al habilitar "todo" hay que decir con honestidad qué módulos le
sirven y cuáles van a quedar vacíos para siempre — un tablero lleno de ceros
es lo que hizo que Claudia dejara de entrar a su workspace.

## 1. Terreno verificado contra producción (2026-08-14)

| Hecho | Cómo se verificó |
|---|---|
| Hay **11 empresas**, todas bajo la **única** organización `CEHTA` | `SELECT codigo, org_id FROM core.empresas` |
| **AFIS ya existe** y es la administradora de Ciclo | fila `AFIS`, RUT 77.423.556-6 |
| `core.empresas.rut` es **nullable** — CEHTA se creó sin RUT | `information_schema` + precedente documentado |
| Una empresa "completa" necesita, además de su fila: **212** filas en `plan_cuenta_empresa`, **1** en `approval_rules`, **10** en `area_empresa`, **1** en `voucher_correlativos`, y branding de OC | conteos sobre AFIS |
| Los logos se sirven de `frontend/public/logos/*.png|jpg` y se referencian por URL en `empresas.logo_dropbox_path` | fila AFIS + `ls public/logos` |
| El logo de Ciclo **ya está en el repo**, con fondo transparente y recortado | procesado desde el JPEG que mandó Nicolás |
| `jpvelasco@cehtacapital.com` ya es usuario (nunca entró). La ficha dice `jpvelasco@ciclocapital.cl` | tabla de usuarios |
| `core.fondos` tiene 0 filas; `core.funds` tiene 1 | conteos |

## 2. Las cuatro decisiones que hay que tomar con criterio

### 2.1. Organización: **CEHTA** — DECIDIDO POR NICOLÁS

Hoy hay **una sola** organización y las 11 empresas cuelgan de ella. Ciclo es un
fondo **de otros dueños** (Juan Pablo Velasco), aunque comparta administradora.

- Ponerlo en `org_id = 'CEHTA'` es lo simple y lo que funciona hoy: el acceso
  real se controla por `user_company_roles`, empresa por empresa.
- Crear `org_id = 'CICLO'` es lo correcto si algún día se quiere separación
  dura entre fondos, o vender/ceder Ciclo.

**Nicolás eligió `CEHTA`.** El acceso real igual se controla empresa por
empresa vía `user_company_roles`, así que nadie ve Ciclo salvo que se le
asigne explícitamente.

### 2.2. Tipo de documento: **igual que las otras** — DECIDIDO POR NICOLÁS

La venta de un inmueble usado por un vendedor no habitual **no está afecta a
IVA**, y el arriendo de inmueble sin muebles tampoco. O sea que el documento
típico de Ciclo es **FACTURA_EXENTA**, no factura afecta.

⚠️ Esto se cruza con el cambio de la ronda anterior: la UF acaba de pasar a
calcular IVA (correctamente, porque la UF no es moneda extranjera). Si las OC
de Ciclo se crean con el default de 19%, **cada documento sale inflado un
19%**. Hay que hacer que el default de Ciclo sea coherente con su negocio.

**Nicolás decidió dejarlo igual que RHO y el resto**: factura afecta al 19%
como default. Se implementa así y NO se inventa ningún criterio distinto.

Queda anotada la observación para que él la lleve a su contador: si las
operaciones del fondo resultan ser exentas, el operador tiene que elegir
FACTURA_EXENTA al crear cada OC — la opción ya existe desde la ronda de
honorarios/exenta, así que es un clic, no un desarrollo.

### 2.3. "Opción a todo" ≠ prender todo y mirar para otro lado

Se habilita todo lo que el usuario pidió. Pero el entregable tiene que decir,
módulo por módulo, cuál le sirve a un FIP y cuál no:

| Módulo | ¿Le sirve a Ciclo? |
|---|---|
| Órdenes de compra + firmas | Sí — gastos del fondo |
| Vouchers / contabilidad | Sí — es el libro del fondo |
| Plan de cuentas | Sí, pero un FIP usa un subconjunto distinto al de una operativa |
| Proveedores | Sí |
| Flujo de caja | Sí, y es probablemente lo más útil |
| RRHH / remuneraciones | **No** — el fondo no tiene empleados |
| CORFO / rendiciones | **No** — es un subsidio de REVTECH+TRONGKAI |
| SII / Nubox | A confirmar: depende de si el fondo declara |

### 2.4. El lenguaje legal es una restricción de código, no una sugerencia

La ficha lo dice y es sancionable:

- **Nunca "garantizado"** → se dice *respaldado* / *pactado* / *acordado*
  (art. 61 Ley 18.045: información falsa o tendenciosa).
- **Nunca "administradora general de fondos"** (art. 90 Ley 20.712) — alcanza a
  contratos, fichas, carta oferta y sitio web.
- Oferta **privada**: nunca oferta pública ni medios masivos.
- Las cuotas se emiten contra capital **efectivamente enterado**, nunca contra
  el comprometido.

La plataforma **emite documentos** (PDF de OC, emails a proveedores y
firmantes). Si alguno de esos textos usa una expresión prohibida en un
documento de Ciclo o de AFIS, es un problema legal, no de estilo.

## 3. Trabajo a hacer

### 3.1. Alta de la empresa (SQL idempotente)

Script nuevo en `backend/scripts/sql/`, mismo estilo y reporte OK/SKIP/FAIL que
`megaprompt_oc_honorarios_exenta.sql`. Debe:

1. `core.empresas` con código **`CICLO`**: razón social *Fondo de Inversión
   Privado Ciclo Capital*, giro de fondo de inversión, dirección Américo
   Vespucio 80 of. 31 Las Condes, `pagina_web` de la ficha, `oc_template`
   `panimavida`, `oc_color_primario` **`#111111`** (el logo es negro sobre
   blanco), `activo = TRUE`.
   ⚠️ **RUT en NULL** — está marcado FALTA en la ficha y no se inventa.
2. Copiar el plan de cuentas de AFIS (es la administradora; su plan es el más
   cercano a un fondo) con `INSERT ... SELECT ... ON CONFLICT DO NOTHING`, y
   verificar con `EXCEPT` en las dos direcciones.
3. `approval_rules`: misma regla que las otras 10 — `['GG','DIRECTOR']`,
   2 firmas siempre, `priority` 100, `min_amount` 0.
4. `area_empresa`: copiar las 10 de AFIS.
5. `voucher_correlativos`: la fila que necesita el correlativo del año.
6. Verificación final: comparar Ciclo contra AFIS y listar toda diferencia.

### 3.2. Branding y PDF

- El logo **ya está procesado y en el repo** (lo hizo el orquestador antes de
  lanzar): `frontend/public/logos/ciclo.png` y
  `backend/app/templates/oc/logos/ciclo.png`. Se le quitó el fondo gris
  (#F7F7F7) del JPEG original —que en el papel se veía como una caja— y se
  recortó al contenido. Queda 1160×130, ratio 8,92:1, o sea que en el
  encabezado ata el ANCHO: 88 × 9,9 mm.
- Renderizar el PDF de OC de Ciclo con el banco local
  (`backend/scripts/preview_oc.py`), en **UF** y con **FACTURA_EXENTA**, y
  MIRAR el resultado. Verificar que los importes en UF salen con decimales.

### 3.3. Guarda de lenguaje legal (código)

Validador reutilizable que detecte las expresiones prohibidas de §2.4 en los
textos que la plataforma emite. Mínimo: glosa de OC, observaciones, cuerpo de
los emails. Que **avise**, no que bloquee — un falso positivo que impide
emitir una OC es peor que la advertencia.

Tests con casos reales: "rentabilidad garantizada" salta, "retorno pactado" no.

### 3.4. Usuarios

- Asignar a Ciclo los usuarios que correspondan. `jpvelasco@cehtacapital.com`
  existe y nunca entró; la ficha dice que su email es `@ciclocapital.cl`.
  **Reportar la discrepancia, no resolverla inventando.**
- No crear usuarios nuevos sin que Nicolás los pida por nombre y rol.

### 3.5. Ficha de datos en el repo

Copiar `DATOS_CICLO_CAPITAL.md` a `docs/` para que quede versionada junto al
código, con los 8 pendientes visibles.

## 4. Lo que NO se hace

- **No inventar** RUT, fecha de constitución, valor de cuota ni cuenta
  bancaria. Están marcados FALTA y así se quedan.
- **No** tocar las otras 11 empresas.
- **No** asumir el criterio tributario: se propone y se marca para el contador.

## 5. Invariantes

Los 22 de `docs/SUPER_PROMPT_MAESTRO.md`. Los que aplican de cerca:
partida doble · 2 firmas · correlativo sin saltos · scope multi-tenant ·
inmutabilidad post-aprobación.

Trampas del repo: `or`/`> 0` con ceros legítimos · Pydantic v2 sin `= None` ·
el peso sin centavos pero la UF **con** decimales · regenerar `openapi.json`
antes de `gen:types` · **nada garantiza que una migración de alembic esté
aplicada: verificar en la BD**.

## 6. Definición de terminado

- [ ] `CICLO` existe y es idéntica a AFIS en plan de cuentas (faltan=0, sobran=0).
- [ ] Tiene regla de aprobación de 2 firmas, áreas y correlativo.
- [ ] El PDF de una OC de Ciclo renderiza CON SU LOGO y se miró. Probar en UF
      (es la moneda del fondo) y en CLP.
- [ ] El validador de lenguaje anda, con tests.
- [ ] Los 8 datos FALTA siguen marcados como FALTA.
- [ ] Los 1423 tests siguen en verde.
