# PROMPT MAESTRO · Voucher desde OC + boleta de honorarios en vouchers

> Ejecutado 2026-08-10. Contrato que siguieron los agentes.

## 0. Qué pidió Nicolás, textual

> "1- Haz que en vouchers también salga la opción de boleta de honorarios.
> Haz que se puedan conectar las OC a los vouchers, cosa de que al estar
> creada la OC se pueda tomar esa OC para crear un voucher. Añade el mismo
> plan de cuentas de rho a panimavida"

El tercer punto **ya está hecho** (ver §5) y queda fuera del alcance de los
agentes: era un INSERT, no un desarrollo.

## 1. Terreno verificado contra producción (2026-08-10 — NO son supuestos)

| Hecho | Cómo se verificó |
|---|---|
| **`core.vouchers.oc_id` EXISTE en la BD** pero **NO está en el modelo ORM ni en los schemas Pydantic** | `information_schema.columns` + grep en `models/voucher.py` y `schemas/voucher.py` |
| El único que escribe `oc_id` es `oc_cuotas.py`, por SQL crudo | grep |
| `DocTributarioTipo` (schemas/voucher.py:33) **ya incluye `HONORARIOS`** entre sus 18 tokens | lectura del Literal |
| El voucher generado desde un hito de OC **nace SIN líneas y SIN monto** | `oc_cuotas.py:652-914` |
| `voucher_lines` es debit XOR credit, y se valida `Σdebe == Σhaber` | `schemas/voucher.py:98-197` |
| Hay 3 vouchers; 1 tiene `oc_id` | `SELECT count(*)` |
| PANIMAVIDA es **empresa real** ("Panimávida Energy SpA"), son **11 empresas** | `SELECT ... FROM core.empresas` |
| El plan de cuentas es **global** (212 cuentas, `core.plan_cuentas` sin `empresa_codigo`); lo que se activa por empresa es **`core.plan_cuenta_empresa`** | columnas + PK `(cuenta_codigo, empresa_codigo)` |

Cuentas que YA existen y son las que corresponden (no crear nuevas):

| Código | Nombre | Tipo |
|---|---|---|
| `4201-02` | HONORARIOS PROFESIONALES | GASTO |
| `2105-04` | RETENCIÓN PROFESIONALES | PASIVO |
| `2102-11` | HONORARIOS POR PAGAR | PASIVO |
| `1104-03` | ANTICIPO DE HONORARIOS | ACTIVO |

## 2. El asiento de una boleta de honorarios

Este es el corazón del pedido, y es lo que hoy el operador tendría que armar
a mano cada vez.

```
4201-02  HONORARIOS PROFESIONALES ....... DEBE   bruto
2105-04  RETENCIÓN PROFESIONALES ........ HABER  retención (15,25% en 2026)
2102-11  HONORARIOS POR PAGAR ........... HABER  líquido
```

La partida doble cierra **por construcción**: `bruto = retención + líquido`
es exactamente la identidad §3.3 del megaprompt anterior, que ya está
garantizada por el motor y por un CHECK en la BD. No hay que recalcular nada:
las tres cifras salen de la OC.

Sobre la tercera línea: `2102-11 HONORARIOS POR PAGAR` es el default correcto
para el **devengo** (reconozco el gasto y la obligación). Si el voucher
representa el **pago efectivo**, esa línea va contra la cuenta de banco. El
sistema propone `2102-11` y deja la cuenta editable, con la explicación al
lado. No se elige por el operador: se le explica y decide.

⚠️ **La retención NO es un gasto de la empresa.** Es plata del prestador que
la empresa retiene y entera al SII por él. Por eso va al PASIVO `2105-04` y
no a una cuenta de resultado. Si alguien la manda a gasto, la empresa se
imputa como costo propio un impuesto que no es suyo y el F29 no cuadra.

### 2.1. Los otros tres tipos

| Tipo de OC | Asiento propuesto |
|---|---|
| `FACTURA` / `BOLETA` | gasto DEBE neto · IVA crédito DEBE iva · proveedor HABER total |
| `FACTURA_EXENTA` | gasto DEBE neto · proveedor HABER total (sin línea de IVA) |
| `HONORARIOS` | el de arriba |

⚠️ La **cuenta de gasto no se puede derivar de la OC**: la OC no tiene
`cuenta_codigo`. Para honorarios sí se conoce (`4201-02`, es la definición del
documento). Para los otros tipos la línea de gasto se propone **vacía** y el
operador la elige. Proponer una cuenta inventada es peor que dejarla en
blanco: se guarda mal y nadie lo nota.

## 3. Conectar la OC al voucher

Lo que falta no es la columna —existe— sino que el sistema la sepa usar.

1. **`oc_id` al modelo ORM y a los schemas** de voucher (create + read). Hoy
   la API no lo puede ni leer ni escribir.
2. **Endpoint de propuesta**: dado un `oc_id`, devolver un borrador de voucher
   con contraparte, glosa, tipo de documento, montos y **líneas propuestas**
   según §2. Es una PROPUESTA: no crea nada, el operador la revisa.
3. **Acción "Crear voucher desde esta OC"** en el detalle de la OC, y
   selector de OC en el alta de voucher. Los dos caminos llegan al mismo
   endpoint — el operador puede venir de la OC o del voucher.
4. **`oc_cuotas.generar-vouchers` deja de crear vouchers vacíos**: usa la
   misma propuesta, así el voucher de un hito nace con su asiento.
   ⚠️ El monto de esos vouchers sale de `oc_cuotas.monto`, que ya se reparte
   sobre `total_a_pagar` (el LÍQUIDO). Para honorarios, el asiento de un hito
   parcial tiene que prorratear las tres líneas, no copiar las de la OC
   completa. Si el prorrateo no cierra exacto, **el residuo va al último hito**
   y la línea que absorbe es la del líquido, nunca la de la retención: la
   retención es un monto que se declara al SII y no admite ajuste de calce.

### 3.1. Qué NO hacer

- **No auto-aprobar nada.** El voucher nace `DRAFT` y sigue el flujo de 2
  firmas (invariante 11). Que se llene solo no lo hace aprobado.
- **No romper el correlativo** (invariante 5): el código lo asigna el
  mecanismo existente, no el código nuevo.
- **No crear el voucher dos veces.** Si una OC (o un hito) ya tiene voucher,
  la acción tiene que decirlo y ofrecer ir al que existe, no generar otro.
  Un voucher duplicado sobre la misma OC es un pago duplicado esperando.
- **No tocar una OC firmada.** Generar el voucher no modifica la OC.

## 4. Boleta de honorarios en el alta de voucher

El Literal ya acepta `HONORARIOS`; falta que se pueda elegir y que sirva.

- Selector de tipo de documento con las etiquetas en castellano, agrupadas
  (afectos / sin IVA), igual que quedó en la OC.
- Al elegir "Boleta de honorarios" **sin venir de una OC**: pedir el bruto y
  la tasa (default de `core.tax_config` por la fecha del voucher), calcular
  retención y líquido con el MISMO motor
  (`app/domain/value_objects/retencion.py`, no reimplementar), y proponer las
  tres líneas de §2.
- Mostrar las tres cifras antes de guardar. El operador tiene que ver que lo
  que va a girar es el líquido.

## 5. Panimávida — YA HECHO, fuera del alcance de los agentes

`PANIMAVIDA` tenía **0 cuentas habilitadas** en `core.plan_cuenta_empresa`;
las otras 10 empresas tenían las 212. Se copió el plan de RHO con
`INSERT ... SELECT ... ON CONFLICT DO NOTHING` (idempotente) y se verificó con
`EXCEPT` en las dos direcciones: **faltan=0, sobran=0**. Nada que hacer acá.

## 6. Invariantes que no se pueden violar

De `docs/SUPER_PROMPT_MAESTRO.md`:

1. **Partida doble** — `Σdebe == Σhaber`, siempre.
2. **Imputación triple** — los gastos operativos exigen cuenta × proyecto ×
   área; las cuentas de balance puro pueden ir sin proyecto/área.
3. **Correlativo sin saltos** por empresa+año.
4. **2 firmas** para `PENDING → APPROVED`. Nada se auto-aprueba.
5. **Inmutabilidad post-aprobación** — un voucher `APPROVED`/`EXECUTED` no se
   edita.
6. **IVA jamás al pozo CORFO** — ninguna línea con
   `fuente_financiamiento = 'CORFO_SUBSIDIO'` toca IVA crédito.
7. **Scope multi-tenant** — `assert_empresa_access` en todo endpoint nuevo.
   Y la OC y el voucher tienen que ser de la MISMA empresa: tomar una OC de
   otra empresa para crear un voucher es una fuga cross-tenant.

## 7. Lecciones de la ronda anterior que aplican acá

Están en `docs/MEGAPROMPT_OC_HONORARIOS_EXENTA.md`, pero las que muerden:

- **La trampa del cero falso**: nunca `or` para un valor que puede ser 0
  legítimamente. Tampoco `> 0`, que es la misma trampa con otra sintaxis.
- **Pydantic v2**: `X | None` sin `= None` es REQUERIDO.
- **El peso chileno no tiene centavos**: todo monto CLP se redondea a entero,
  y el residuo se absorbe por RESTA, nunca redondeando dos veces.
- **Regenerar `backend/openapi.json`** antes de `npm run gen:types`.
- **Antes de repartir archivos entre agentes, verificar que TODOS los
  archivos que hay que tocar tienen dueño.** La ronda pasada `oc_cuotas.py`
  se quedó sin asignar y por eso los hitos se calculaban sobre el bruto.
- Un fallback que puede cambiar una cifra de plata tiene que **levantar**, no
  degradar.

## 8. Definición de terminado

- [ ] Desde el detalle de una OC se puede crear un voucher con su asiento
      propuesto, en los 4 tipos de documento.
- [ ] Desde el alta de voucher se puede elegir una OC y se prellena.
- [ ] "Boleta de honorarios" es elegible en el alta de voucher aunque no haya
      OC, y arma las 3 líneas.
- [ ] El asiento de honorarios cierra la partida doble con las cuentas
      `4201-02` / `2105-04` / `2102-11`.
- [ ] Un hito parcial prorratea, con el residuo en el líquido y nunca en la
      retención.
- [ ] No se puede crear dos veces el voucher de la misma OC/hito.
- [ ] No se puede tomar una OC de otra empresa.
- [ ] Los 1310 tests preexistentes siguen en verde + tests nuevos del asiento.
