# PROMPT MAESTRO · Arreglar la creación de OC con IA

> Pedido de Nicolás: *"arregla el hacer OC con IA: mejórala completamente, que
> luego de hacerla con IA se pueda editar, que los cálculos y unidades estén
> bien colocados, que sea ultra pro y no tenga problemas, que todo cuadre"*.
>
> Comentarios que le llegaron del equipo:
> 1. no se puede poner unidades
> 2. no se puede quitar el IVA por boleta de honorarios
> 3. el cálculo de valores no cuadra

## 0. Las tres quejas son reales y ya están localizadas

No hay que buscar: el terreno se revisó antes de escribir esto. Cada queja
tiene una causa concreta y verificada en el código.

### Queja 1 — "no se puede poner unidades"

La unidad de medida (Un, Gl, Días, m³, Ton, Hrs) **existe de punta a punta,
menos en el camino de IA**:

| Capa | ¿Tiene `unidad`? |
|---|---|
| `core.ordenes_compra_detalle.unidad` | **Sí** |
| `OCDetalleCreate` (schema del POST) | **Sí**, `str \| None`, máx 20 |
| `_persistir_unidades` en el endpoint | **Sí** |
| PDF, columna "Un." | **Sí** |
| Formulario manual `/ordenes-compra/nueva` | **Sí** |
| Prompt de la IA (`document_analyzer_service`) | **NO** |
| `OcExtractedItem` (respuesta de extracción) | **NO** |
| Pantalla `/importar` | **NO** |
| Pantalla `/desde-mensaje` | **NO** |

O sea: la IA nunca ve que existe el campo, la respuesta no lo transporta y
las dos pantallas ni lo muestran ni lo mandan. Toda OC hecha con IA nace con
la unidad en NULL y el PDF imprime "—".

### Queja 2 — "no se puede quitar el IVA por boleta de honorarios"

`OcExtractedSuggestion` **no tiene `tipo_documento`**. Tampoco lo tienen las
dos pantallas ni el payload que arman. El backend, sin ese campo, aplica su
default: `FACTURA` con 19%.

Consecuencia: **toda OC creada con IA es una factura afecta**, y no hay forma
de emitir una boleta de honorarios (que además necesita la retención de
15,25%) ni una factura exenta desde ese camino. Los cuatro tipos existen
desde la ronda de honorarios/exenta — pero sólo en el formulario manual.

### Queja 3 — "el cálculo de valores no me cuadra"

Cinco causas distintas, todas reales:

1. **La vista previa miente con la UF.** Las dos pantallas calculan
   `iva = moneda === "CLP" ? neto * 0.19 : 0`. El backend aplica IVA también
   a **UF** (`MONEDAS_AFECTAS = ("CLP", "UF")`, decidido en la ronda de la
   UF). Una OC en UF muestra IVA 0 en pantalla y sale con 19% en el
   documento. Es un descuadre garantizado, no intermitente.
2. **19% hardcodeado.** Ignora `iva_porcentaje`, que es editable por OC desde
   la ronda de firmantes/IVA.
3. **Nadie concilia el encabezado con las líneas.** La IA extrae `neto` del
   pie del documento Y `items` de las líneas. El frontend descarta el `neto`
   (bien: el backend lo recomputa) pero **nadie compara los dos**. Si la IA
   se saltó una línea de una cotización de 12 ítems, la OC sale por menos que
   el documento original y no hay ninguna señal.
4. **El total de línea del documento se ignora.** La IA extrae
   `item.total`, pero nadie lo contrasta contra `cantidad × precio_unitario`.
   Si no coinciden, es que uno de los tres números se leyó mal.
5. **Trampa del cero falso, dos veces.** `Number(it.cantidad) || 1` en las
   dos pantallas: una cantidad 0 se convierte en 1 en silencio. Y en el
   backend, `_parse_amount(item.get("cantidad")) or Decimal("1")`, lo mismo.

### Y lo que Nicolás pidió que no está en la lista de quejas

**No existe ningún endpoint para editar los ítems de una OC ya creada.**
`PATCH /ordenes-compra/{id}` sólo toca campos no-críticos y su propio
docstring dice *"NO permite tocar items"*. `OcEditForm` no los muestra.

Es lo más grave del conjunto: la IA se equivoca —es lo esperable— y hoy la
única salida es **borrar la OC y rehacerla entera a mano**. Sin esto, todo lo
demás es cosmético.

## 1. Qué hay que construir

### 1.1. Una sola regla de totales, compartida (raíz de la queja 3)

El descuadre no se arregla corrigiendo el `0.19` de las dos pantallas: se
arregla haciendo **imposible** que diverjan. El repo ya tiene el patrón para
esto en `oc-filename`: un **snapshot JSON que leen las dos suites**.

- `backend/tests/fixtures/oc_totales_esperado.json` — casos y resultados,
  generados desde `_derivar_totales_oc`, que es y sigue siendo la autoridad.
- `backend/tests/unit/test_oc_totales_paridad.py` — el backend produce el
  snapshot.
- `frontend/lib/oc/totales.ts` — la misma regla en TS.
- `frontend/lib/__tests__/oc-totales-paridad.test.ts` — el TS produce el
  mismo snapshot.

Si alguien toca una de las dos y no la otra, una de las dos suites falla. Es
la única forma de que "la pantalla dice lo mismo que el PDF" deje de ser una
promesa y pase a ser una propiedad verificada.

Casos obligatorios del snapshot: CLP y UF · los 4 tipos de documento ·
IVA 19 / 0 / pactado · retención 15,25 · cantidades con decimales · el peso
sin centavos y la UF con dos.

### 1.2. Unidades y tipo de documento en todo el camino de IA

- `document_analyzer_service`: agregar `unidad` y `tipo_documento` al esquema
  que se le pide a la IA, con instrucciones explícitas de cómo reconocer una
  boleta de honorarios (la palabra "honorarios", la retención, la ausencia de
  IVA).
- `OcExtractedItem` += `unidad`.
- `OcExtractedSuggestion` += `tipo_documento`, `iva_porcentaje`,
  `retencion_porcentaje`.
- Las dos pantallas: columna Unidad, selector de tipo de documento, y esos
  campos en el payload.

### 1.3. Conciliación, visible

La extracción tiene que **avisar cuando no cuadra**, no elegir en silencio:

- Σ(cantidad × precio) de las líneas vs el `neto` del encabezado.
- `item.total` del documento vs `cantidad × precio` de esa línea.

Cuando difieren, un aviso arriba del formulario diciendo **qué número dice el
documento y qué número van a producir las líneas**. La decisión es del
operador; el sistema no puede elegir por él, pero tampoco puede callarse.

### 1.4. Editar la OC después de crearla

`PUT /ordenes-compra/{oc_id}/items` que reemplaza el itemizado completo y
recalcula todo con `_derivar_totales_oc`.

Guardas, no negociables:
- Reutiliza `_assert_oc_sin_firmas` — una OC firmada no cambia de monto: el
  firmante aprobó una cifra.
- Bloquea si hay vouchers con plata (APPROVED/EXECUTED/SYNCED/RECONCILED):
  cambiar el total dejaría los pagos ya girados contra un total que dejó de
  existir.
- Recalcula neto/IVA/retención/total/total_a_pagar. No acepta montos del
  cliente.
- Persiste las unidades (el ORM no mapea esa columna).
- `audit_log` con el antes y el después.

Y su editor en la pantalla de edición, con el mismo pegado desde Excel y el
mismo textarea que crece que ya tiene el alta.

## 2. Lo que NO se hace

- **No** se cambia `_derivar_totales_oc`. Es la autoridad y está probada; el
  frontend se acomoda a ella, nunca al revés.
- **No** se deja que el cliente mande montos. El backend recomputa siempre.
- **No** se "arregla" el descuadre eligiendo automáticamente entre el neto
  del encabezado y la suma de las líneas. Se avisa y decide la persona.
- **No** se toca el formulario manual salvo para compartir componentes.

## 3. Invariantes

Los 22 de `docs/SUPER_PROMPT_MAESTRO.md`. De cerca: correlativo sin saltos ·
inmutabilidad post-firma · el peso sin centavos y la UF con dos · scope
multi-tenant.

Trampas del repo: `or` / `||` con ceros legítimos · Pydantic v2 sin `= None`
· regenerar `openapi.json` antes de `gen:types` · **verificar el esquema real
en la BD antes de escribir SQL** (esta semana rompió el borrado de OC y el
alta de Tecmávida por columnas que no existían).

## 4. Definición de terminado

- [ ] El snapshot de totales existe y las DOS suites lo verifican.
- [ ] Una OC en UF muestra en pantalla el mismo IVA que sale en el PDF.
- [ ] Se puede crear una boleta de honorarios con IA, con su retención.
- [ ] Se pueden poner unidades en las dos pantallas de IA.
- [ ] Cuando el documento y las líneas no cuadran, la pantalla lo dice.
- [ ] Los ítems de una OC se pueden editar después de creada, y una OC
      firmada o con pagos sigue sin poder cambiar de monto.
- [ ] Verificado contra producción, no sólo con tests.
