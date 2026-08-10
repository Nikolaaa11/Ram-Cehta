# MEGAPROMPT · OC con Boleta de Honorarios y Factura Exenta

> Estado: ejecutado 2026-08-10. Este documento es el contrato que siguieron los
> agentes; sirve de referencia para cualquier cambio futuro sobre el mismo
> terreno. Si algo acá contradice al código, gana el código — pero entonces hay
> que actualizar este archivo y explicar por qué.

## 0. Qué pidió Nicolás, textual

> "En la sección OC: se puedan crear Boletas de honorarios. Debería restar el
> 15.25 del monto total (impuesto retenido) y también se puedan crear factura
> exenta de impuestos. Arreglar el formato y diseño de la OC que saldrá para
> cada caso."

## 1. Terreno verificado (2026-08-10, contra producción — NO son supuestos)

| Hecho | Verificado con |
|---|---|
| `core.ordenes_compra.tipo_documento` tiene `CHECK ck_oc_tipo_documento IN ('FACTURA','BOLETA')` | `pg_get_constraintdef` en prod |
| Existen **3 OCs**, todas `FACTURA` | `SELECT tipo_documento, count(*)` |
| `core.ordenes_compra.iva_porcentaje NUMERIC(5,2) DEFAULT 19.00` ya existe y es editable | migración `megaprompt_oc_encargados_iva.sql` |
| **`core.tax_config` NO existe** pese a que el invariante 10 dice que la tasa vive ahí | `to_regclass` = NULL |
| Plan de cuentas YA tiene la contrapartida | `SELECT ... ILIKE '%retenc%'` |
| `core.vouchers.doc_tributario_tipo` ya acepta 18 tokens SII, entre ellos `FACTURA_EXENTA` y `HONORARIOS` | `alembic/versions/0062_expand_doc_tributario_tipos.py` |

Cuentas relevantes que **ya existen** (no crear nuevas):

| Código | Nombre | Tipo |
|---|---|---|
| `4201-02` | HONORARIOS PROFESIONALES | GASTO |
| `2105-04` | RETENCIÓN PROFESIONALES | PASIVO |
| `2102-11` | HONORARIOS POR PAGAR | PASIVO |
| `1104-03` | ANTICIPO DE HONORARIOS | ACTIVO |

### 1.1. Corrección tributaria que este megaprompt arrastra

`docs/SUPER_PROMPT_MAESTRO.md` invariante 10 dice **13,75%** y lo etiqueta
"tabla 2026". Es la tasa de **2024**. La escala del Art. 74 N°2 LIR según la
Ley 21.133 es:

| Año | Tasa |
|---|---|
| 2024 | 13,75 % |
| 2025 | 14,50 % |
| **2026** | **15,25 %** |
| 2027 | 16,00 % |
| 2028 | 17,00 % |

Nicolás pidió 15,25 % y **tiene razón**. El invariante queda corregido en el
mismo cambio, y la tasa deja de vivir en prosa para vivir en `core.tax_config`,
que es lo que el invariante decía desde el principio.

## 2. Los cuatro casos que la OC tiene que saber emitir

| Token (en BD) | Etiqueta al operador | IVA | Retención | Qué paga tesorería |
|---|---|---|---|---|
| `FACTURA` | Factura afecta | `iva_porcentaje` (19 por defecto) | — | neto + IVA |
| `FACTURA_EXENTA` | Factura exenta | forzado 0, tratamiento **EXENTO** | — | neto |
| `BOLETA` | Boleta de ventas y servicios | `iva_porcentaje` | — | neto + IVA |
| `HONORARIOS` | **Boleta de honorarios** | forzado 0, tratamiento **NO_GRAVADO** | `retencion_porcentaje` (15,25 por defecto) | bruto − retención |

**Los tokens son los del catálogo SII que ya usa `vouchers.doc_tributario_tipo`.**
No inventar `BOLETA_HONORARIOS` ni `FACTURA_EXENTA_ELECTRONICA`: el mapeo
OC → voucher tiene que ser la identidad, porque toda tabla de traducción entre
dos catálogos termina divergiendo. La etiqueta bonita ("Boleta de honorarios")
es presentación y vive en el frontend y en el PDF, nunca en la columna.

### 2.1. Diferencia que NO es cosmética: exento ≠ afecto al 0 %

Hoy se puede poner `iva_porcentaje = 0` y el total sale igual que una exenta.
**No es lo mismo tributariamente.** Una operación exenta no genera crédito
fiscal y se declara en una línea distinta del F29 y del RCV que una afecta.
Si el sistema las guarda idénticas, el día que se concilie contra el SII no
hay forma de separarlas. Por eso `FACTURA_EXENTA` es un tipo propio y no
"factura con 0 %".

## 3. La matemática, explícita

Sea `B` = suma de las líneas del itemizado.

```
FACTURA / BOLETA      total_neto = B
                      iva        = redondear(B × iva_porcentaje/100)
                      total      = total_neto + iva
                      retencion_monto = 0
                      total_a_pagar   = total

FACTURA_EXENTA        total_neto = B
                      iva        = 0            (iva_porcentaje forzado a 0)
                      total      = B
                      retencion_monto = 0
                      total_a_pagar   = total

HONORARIOS            total_neto = B           ← honorario BRUTO
                      iva        = 0
                      total      = B           ← se mantiene total = neto + iva
                      retencion_monto = redondear(B × retencion_porcentaje/100)
                      total_a_pagar   = total − retencion_monto   ← LÍQUIDO
```

### 3.1. Decisión de modelado (la que puede romper todo)

`total` **conserva** su semántica histórica `total = total_neto + iva`. Se
**agrega** `total_a_pagar`. No se redefine `total` como líquido.

Por qué: `oc.total` lo consumen los hitos de pago, los vouchers generados desde
cuotas, el flujo de caja por proyecto, la búsqueda global, los exports y la
franja de la hoja de firmas del PDF. Redefinirlo silenciosamente convierte un
cambio de formulario en un cambio de significado en diez lugares a la vez.
Agregar una columna nueva obliga a que cada consumidor **elija** explícitamente
cuál de los dos números quiere, y deja el cambio auditable.

**Contrapartida obligatoria de esta decisión**: hay que revisar consumidor por
consumidor cuál de los dos corresponde. La regla:

- **Todo lo que representa PLATA QUE SALE** → `total_a_pagar`.
  Hitos/cuotas de pago, voucher de pago, flujo de caja, "cuánto le debo".
- **Todo lo que representa VALOR DEL CONTRATO** → `total`.
  Umbral de aprobación, monto contratado, reportes de compromiso, la franja
  identificatoria del PDF.

Un consumidor mal clasificado acá es un error de plata, no de estilo.

### 3.2. El bruto-vs-líquido en el que se equivoca todo el mundo

Cuando se pacta con un profesional "te pago $1.000.000", casi siempre se está
hablando del **líquido**. El bruto que hay que poner en la OC es
`1.000.000 / (1 − 0,1525) = 1.179.941`, no `1.000.000`.

El formulario debe ofrecer los dos modos de carga explícitamente ("el monto que
ingreso es BRUTO" / "es LÍQUIDO y quiero que lo grossee") y mostrar siempre las
tres cifras. Si sólo acepta bruto, el operador va a cargar el líquido en el
campo de bruto y el profesional va a cobrar 15 % de menos. Eso ya pasa en
planillas de Excel en todo Chile.

### 3.3. Redondeo

Todo a peso chileno con `ROUND_HALF_UP`, igual que `calcular_iva`. La
identidad `total_a_pagar + retencion_monto == total` tiene que cerrar **exacto**
después de redondear: se redondea la retención y el líquido se obtiene por
resta, nunca redondeando las dos por separado.

### 3.4. Trampa del cero falso

`retencion_porcentaje` y `iva_porcentaje` pueden ser legítimamente `0`. Está
prohibido usar `or` para el fallback (`x or Decimal("19")`) porque Python trata
`0` como falso y una OC exenta volvería a imprimir 19 %. Siempre
`if x is not None`. Este bug ya se cometió en esta misma tabla en el round
anterior; no se repite.

## 4. Alcance del trabajo

### 4.1. Datos (`backend/scripts/sql/`)

- Ampliar `ck_oc_tipo_documento` a los 4 tokens. Las 3 OCs existentes son
  `FACTURA`: la migración no puede fallar por datos.
- `ALTER TABLE core.ordenes_compra ADD COLUMN retencion_porcentaje NUMERIC(5,2)
  NOT NULL DEFAULT 0 CHECK (retencion_porcentaje >= 0 AND <= 100)`,
  `retencion_monto NUMERIC(18,2) NOT NULL DEFAULT 0`,
  `total_a_pagar NUMERIC(18,2)`.
  `total_a_pagar` arranca NULL y se backfillea `= total` para las 3 OCs
  existentes, después se pone NOT NULL.
- `CREATE TABLE core.tax_config` (clave, vigencia_desde, vigencia_hasta, valor,
  descripción) y sembrar la escala completa 2024→2028 de
  `RETENCION_HONORARIOS` más `IVA_GENERAL = 19`. Con vigencia por fecha, no una
  fila por año que haya que tocar cada enero.
- CHECK de coherencia a nivel BD: `HONORARIOS` y `FACTURA_EXENTA` no pueden
  tener `iva_porcentaje > 0`; `FACTURA`/`BOLETA` no pueden tener
  `retencion_porcentaje > 0`. La regla de negocio también va en la API, pero
  el CHECK es la red que atrapa los INSERT que no pasan por la API.
- ⚠️ El deploy NO corre migraciones (`release_command` desactivado). El SQL se
  aplica a mano y el script tiene que ser **idempotente** (`IF NOT EXISTS`,
  `DROP CONSTRAINT IF EXISTS`) y reportar OK/SKIP/FAIL por sentencia.

### 4.2. Motor de cálculo (`backend/app/domain/value_objects/`)

Módulo nuevo `retencion.py`, hermano de `iva.py`, con la misma disciplina:
la tasa es un `Decimal`, el porcentaje editable se convierte con un helper,
y el redondeo es el mismo `_round_clp`. Funciones puras, sin BD, sin ORM.
Tests unitarios que cubran: bruto→líquido, líquido→bruto (gross-up), la
identidad de la §3.3, tasa 0, tasa 100, y los cinco años de la escala.

### 4.3. API (`backend/app/api/v1/ordenes_compra.py`)

- `create_oc` y `update_oc` derivan **en el servidor** `iva`,
  `retencion_monto`, `total` y `total_a_pagar` a partir del tipo de documento.
  El cliente propone, el servidor calcula. Nunca confiar en los totales que
  manda el frontend.
- Forzar la coherencia: si el tipo es `HONORARIOS` o `FACTURA_EXENTA`, el
  servidor **pisa** `iva_porcentaje` a 0 en vez de rechazar — el operador no
  tiene por qué saber que dejó un 19 viejo en el campo.
- Rechazar con 422 y mensaje en castellano claro si mandan
  `retencion_porcentaje > 0` en una factura afecta.
- Default de `retencion_porcentaje` al crear una OC `HONORARIOS`: se lee de
  `core.tax_config` por la fecha de emisión de la OC, **no** una constante.
  Una OC con fecha 2027 tiene que traer 16 %.

### 4.4. PDF (`orden_compra_panimavida.html` + `oc_pdf_v2_service.py`)

Esto es la mitad del pedido de Nicolás ("arreglar el formato y diseño para cada
caso") y no es sólo agregar una fila.

- **Bloque de totales por tipo**, no un bloque con filas escondidas:
  - `FACTURA`/`BOLETA`: Neto · IVA X% · **Total**
  - `FACTURA_EXENTA`: Neto exento · **Total** + nota "Operación exenta de IVA
    conforme al Art. 12 del D.L. 825."
  - `HONORARIOS`: Honorarios brutos · Retención X% · **Líquido a pagar**, y
    el Total bruto visible pero secundario.
- En `HONORARIOS` el número grande, tintado y con el filete de marca es el
  **Líquido a pagar**, no el bruto: es la cifra que el profesional va a
  cobrar y la que tesorería va a girar. El bruto va arriba, en gris.
- La franja identificatoria de la hoja de firmas dice hoy
  "TOTAL CLP (IVA INCL.)". Con honorarios eso es **falso**. El rótulo tiene
  que salir del tipo de documento.
- Nota legal obligatoria en `HONORARIOS`: que la retención la entera el
  mandante al SII por cuenta del prestador, y que el prestador debe emitir su
  boleta de honorarios electrónica por el **bruto**. Sin esta línea el
  documento induce a error sobre quién paga el impuesto.
- El chip `tipo_documento` del encabezado ("DOCUMENTO TRIBUTARIO: Factura")
  tiene que decir la etiqueta larga correcta en los 4 casos.
- **Restricciones del motor**: WeasyPrint 63.1. Nada de flex, grid, `gap`,
  `clamp()`, `aspect-ratio`, `position:sticky`, `#RRGGBBAA`, `color-mix()`.
  Tablas y bloques. El diseño "editorial sobrio" recién instalado
  (commit `6b6a10a`) **no se rediseña**: se extiende respetando su escala de
  grises, su tipografía y su uso del color como acento.
- El presupuesto vertical de la hoja de firmas es frágil (documentado en el
  template). Agregar filas al bloque de totales de la hoja 1 es seguro;
  tocar la hoja 2 exige volver a medir.

### 4.5. Frontend

`ordenes-compra/nueva`, `OcEditForm.tsx` y el detalle `[id]`:

- Selector de tipo de documento con las 4 etiquetas en castellano.
- Los campos se muestran u ocultan según el tipo: IVA% sólo en afectas,
  retención% sólo en honorarios. Nada de mostrar los dos siempre y confiar en
  que el operador entienda cuál aplica.
- En honorarios: el toggle BRUTO/LÍQUIDO de la §3.2 y un resumen en vivo con
  las tres cifras antes de guardar.
- El listado y el detalle muestran `total_a_pagar` donde hoy muestran `total`
  **si y sólo si** la columna representa plata a girar (regla §3.1).

### 4.6. Aguas abajo

Auditar y corregir cada consumidor de `oc.total` según la regla §3.1:
cuotas/hitos, generación de voucher desde cuota, flujo de caja por proyecto,
búsqueda global, exports, emails. **Este es el punto de mayor riesgo del
cambio** y va verificado adversarialmente, no por inspección optimista.

## 5. Invariantes que NO se pueden violar

De `docs/SUPER_PROMPT_MAESTRO.md`, los que este cambio toca:

1. **Partida doble** — si el cambio genera asiento, debe cuadrar.
2. **Inmutabilidad post-aprobación** — una OC `FIRMADA` no cambia de tipo de
   documento ni de tasa. Nunca. Es un documento probatorio.
3. **Invariante 10** — la tasa vive en `core.tax_config`, no hardcodeada.
   (Y queda corregida a la escala real.)
4. **Scope multi-tenant** — `assert_empresa_access` en todo endpoint nuevo.
5. **Snapshot, no re-derivación** — la tasa aplicada se guarda en la OC. Si el
   SII sube la tasa en 2027, las OCs de 2026 siguen mostrando 15,25 %.

## 6. Definición de terminado

- [ ] SQL idempotente aplicado, con reporte por sentencia.
- [ ] Las 3 OCs existentes intactas y con `total_a_pagar = total`.
- [ ] Tests unitarios del motor de cálculo en verde, incluida la identidad de
      redondeo y el gross-up.
- [ ] Los 1210 tests preexistentes siguen en verde.
- [ ] PDF renderizado y **mirado** en los 4 tipos × al menos 2 empresas, con el
      motor real (WeasyPrint), no sólo con el banco Chromium.
- [ ] Ningún consumidor de `oc.total` quedó sin clasificar.
- [ ] `docs/SUPER_PROMPT_MAESTRO.md` invariante 10 corregido.

## 7. Cómo se ejecutó

Workflow de 13 agentes en tres fases:

1. **Reconocimiento** (3, sólo lectura) — mapa de consumidores de los totales,
   camino OC→cuota→voucher→asiento, y superficie de UI/PDF a tocar.
2. **Construcción** (5, en paralelo sobre archivos disjuntos) — datos, motor,
   API, frontend, PDF. Los archivos están particionados a propósito para que
   dos agentes nunca escriban el mismo: el contrato de §2 y §3 es lo que les
   permite trabajar en paralelo sin coordinarse.
3. **Verificación adversarial** (5) — cada entregable lo revisa un agente cuyo
   trabajo es **refutarlo**, con instrucción explícita de asumir que está mal
   si no puede probar lo contrario.

La integración, la migración contra producción y el deploy los hace el
orquestador, no los agentes.
