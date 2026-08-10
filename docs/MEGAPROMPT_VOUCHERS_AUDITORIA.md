# PROMPT MAESTRO · Vouchers — impresión, flujo, guía y rendimiento

> Ejecutado 2026-08-10.

## 0. Qué pidió Nicolás, textual

> "Arreglar toda la parte de los vouchers: la parte financiera y contable
> tienen que salir diferentes al imprimir el voucher para que se vea que se
> hizo bien el asiento contable. Además necesito ajustarlo para que sea más
> práctico, analiza que toda la lógica y flujo estén bien y arregla la parte
> financiera y contable. Necesito que audites todo el flujo, déjalo perfecto y
> luego crea una guía detallada para que los encargados sepan cómo
> desarrollarlos." + un pedido de optimización de rendimiento.

Adjuntó una captura del PDF de un voucher mostrando **DIFERENCIA −$440.168**
en rojo.

## 1. El bug de la captura, diagnosticado (no es opinión)

El voucher de la captura es **`AFIS-2026-COM-00010`** (source `nubox_form`,
PENDING). Su asiento en la BD:

```
L1  4101-01 COSTO DE VENTA .............. debe  220.084
L2  2102-01 FACTURAS POR PAGAR .......... haber 220.084
total_debit = 220.084   total_credit = 220.084
```

**El asiento CUADRA PERFECTO.** Y el PDF le informa a quien lo firma que hay
un descuadre de $440.168. Eso no es un número feo: es el documento diciéndole
al gerente que el trabajo está mal cuando está bien. Destruye la confianza en
el papel, que es justamente para lo que existe.

La causa está en `backend/app/services/voucher_pdf_service.py:1063-1075`,
rama `if nubox:` — tres errores encadenados:

```python
total_contable = sum(neto_amount for ln in lines)         # → 0
total_financiera = sum(debit + credit for ln in lines)    # → 440.168
diff = total_contable - total_financiera                  # → −440.168
```

1. **`Σ(debit + credit)` no significa nada.** En partida doble, sumar el debe
   Y el haber de todas las líneas da SIEMPRE el doble del asiento. Un asiento
   perfecto de $220.084 imprime "440.168". Ningún voucher correcto puede dar
   bien acá — la fórmula está rota para todos los casos, no para éste.
2. **`neto_amount` es NULL en el 100% de las líneas.** Verificado en
   producción: las 6 líneas de los 4 vouchers tienen `neto_amount`,
   `iva_amount` e `iva_tratamiento` en NULL. `VoucherLineCreate` expone esos
   campos pero **ningún camino de alta los llena**. Por eso las columnas Neto
   e IVA de la tabla salen "—" y la fila TOTAL sale `$0 · $0 · $0`.
3. **La "DIFERENCIA" compara cosas incomparables**: una suma de netos
   tributarios contra una suma de debe+haber. No hay voucher en el mundo donde
   eso dé 0.

Alcance: sólo la rama `nubox` (`source == 'nubox_form'`). Los otros vouchers
caen al `else`, que sí calcula Σ DEBE / Σ HABER y está bien. Pero la rama
`nubox` es la que usa el flujo de compras contra factura, que es el volumen
real.

## 2. Lo que hay que construir: dos vistas, no una mezclada

El pedido de Nicolás es exactamente el diseño correcto. Hoy hay UNA tabla
titulada "DETALLE FINANCIERO / CONTABLE" que intenta ser las dos cosas y no es
ninguna. Van SEPARADAS porque responden preguntas distintas:

### 2.1. Vista CONTABLE — "¿el asiento cuadra?"

Columnas: `#` · `Cuenta` · `Nombre de la cuenta` · `Glosa` · **`Debe`** ·
**`Haber`**. Una línea aparece en una columna o en la otra, nunca en las dos.

Cierre: **Σ DEBE** y **Σ HABER**, y un indicador explícito de cuadratura.
Cuando cuadran —que es el caso normal— tiene que decirlo en verde y con
palabras ("El asiento cuadra"), no dejar al lector sumando de memoria. La
"diferencia" sólo se muestra cuando existe.

Esta es la vista que prueba que el trabajo está bien hecho. Es la que pidió
Nicolás.

### 2.2. Vista FINANCIERA — "¿cuánta plata sale y cómo se compone?"

Columnas: `Neto` · `IVA` · `Retención` (cuando aplica) · `Total documento`, con
el tipo y folio del documento tributario y la contraparte.

⚠️ **Y acá está la decisión importante**: hoy esos campos están vacíos en la
BD. Hay dos caminos y hay que elegir con criterio, no rellenar con ceros:

- **Si el voucher tiene desglose tributario** (`neto_amount` / `iva_amount`
  cargados, o un documento tributario con IVA), se muestra el desglose.
- **Si NO lo tiene** —que es el caso de todos los vouchers de hoy— la sección
  **dice que no hay desglose cargado**, no imprime `$0`. Un cero es una
  afirmación ("el IVA de esta compra fue cero") y sería falsa. Un guion con la
  aclaración es la verdad.

Es preferible un documento que admite lo que no sabe a uno que inventa.

### 2.3. Regla general del rediseño

**Ningún número impreso puede ser una suma que no signifique nada.** Si una
cifra no responde una pregunta que el lector se hace, no va.

## 3. Auditoría del flujo completo (lo que hay que revisar)

Auditar de punta a punta y reportar TODO lo que esté mal, aunque no se arregle
en esta ronda:

1. **Alta**: los caminos son varios —`/vouchers/nuevo`, `/vouchers/nubox`,
   `/vouchers/corfo`, desde OC, desde prevoucher, desde foto, desde email,
   importación CSV/Excel. ¿Producen todos vouchers equivalentes? ¿Cuáles
   llenan `neto_amount`/`iva_amount` y cuáles no? ¿Por qué?
2. **Estados**: DRAFT → PENDING → APPROVED → EXECUTED, más VOID/REJECTED y
   REVERSO. ¿Las transiciones están todas guardadas? ¿Se puede llegar a un
   estado sin pasar por el anterior?
3. **Firmas**: 2 firmas obligatorias, anti-doble-firma, umbrales reforzados.
   ⚠️ Verificar el auto-approve con `required_roles=[]`
   (`vouchers.py`, "Round 56"): ¿está activo? ¿bajo qué umbral? Un voucher que
   se aprueba solo salteándose las dos firmas sería una violación del
   invariante 11 — hay que confirmar si es intencional y está acotado.
4. **Partida doble**: ya hay trigger en BD (instalado 2026-08-10) + validación
   en Python en `submit_voucher`. Verificar que no haya OTRO camino que escriba
   líneas salteándose las dos: por ejemplo INSERT crudos.
5. **Imputación triple** (cuenta × proyecto × área): ¿dónde se valida de
   verdad? El schema dice explícitamente que NO la valida.
6. **Correlativo sin saltos**: hay dos mecanismos distintos —
   `core.next_voucher_code` (usado por `create_voucher`) y un UPSERT sobre
   `core.correlativos` (usado por `generar-vouchers`). **Dos generadores para
   la misma secuencia es una fuente de colisión o de saltos.** Verificar si
   compiten y proponer unificación.
7. **Período cerrado**: `is_period_locked_for` + los triggers nuevos.
8. **Adjuntos**: el invariante 14 (COMPRA/VENTA exige adjunto) está
   DESACTIVADO por decisión operativa (Round 144). Confirmarlo y dejarlo
   documentado como decisión, no como olvido.
9. **IVA fuera del pozo CORFO**: el invariante 6 también está comentado
   (Round 147). Mismo tratamiento.
10. **Multi-tenant**: `assert_empresa_access` en todos los endpoints.

Para cada hallazgo: severidad, archivo:línea, escenario concreto que lo
dispara, y si es defecto o decisión.

## 4. "Más práctico" — qué significa en concreto

El pedido es de usabilidad, y el criterio es: **el operador no debería tener
que saber contabilidad para cargar un gasto correcto.**

- Reducir pasos y campos del alta a lo mínimo que el sistema no pueda deducir.
- Lo deducible se deduce: la contrapartida de un pago, el IVA de una factura
  afecta, la cuenta de un proveedor recurrente.
- Los errores tienen que decir **qué hacer**, no qué pasó.
- El estado del voucher y qué falta para avanzar tiene que verse sin abrir
  nada.

No inventar features nuevas: hacer que las que hay se usen sin manual.

## 5. Guía para los encargados

Documento HTML autocontenido, en el mismo estilo que las guías que ya existen
en `frontend/public/` (mirar `GUIA_INGRESO_VOUCHERS.html` y REUSAR su
estructura y estilo — no inventar un diseño nuevo).

Tiene que servirle a alguien que **no sabe contabilidad**:

- Qué es un voucher y por qué existe, en dos párrafos y sin jerga.
- Los tipos (EGRESO / COMPRA / VENTA / TRASPASO…) y cuándo usar cada uno.
- **El debe y el haber explicados de una vez y bien**, con la regla práctica
  para no equivocarse.
- Los asientos típicos del fondo, con números reales:
  compra con factura afecta · boleta de honorarios con retención ·
  gasto exento · pago de una cuota de OC · caja chica.
- El circuito de firmas: quién firma, en qué orden, qué pasa si rechaza.
- Los 8 errores más comunes y cómo se ven en pantalla.
- Qué NO hacer nunca (editar un voucher aprobado, forzar cuadratura con una
  línea de ajuste inventada, imputar IVA al pozo CORFO).

Nada de contenido inventado: los ejemplos salen del plan de cuentas real y de
los flujos que existen.

## 6. Rendimiento — con la escala REAL, sin teatro

Nicolás pidió optimizar "como para tráfico masivo de millones de usuarios".
**Hay que decirle la verdad: esta plataforma tiene 45 usuarios y 4 vouchers en
producción.** Optimizar para millones sería trabajo desperdiciado y además
riesgoso: cada cambio de arquitectura que no responde a un problema medido es
superficie nueva para bugs en un sistema que mueve plata.

Lo que SÍ corresponde, y hay que hacer de verdad:

1. **Arreglar la ineficiencia real que ya está identificada**: el bucle de
   validación de líneas de `create_voucher` es N+1 puro — hasta 4 queries por
   línea. `prevouchers.py` ya resolvió lo mismo en lote; hay que portar ese
   patrón. Con 200 líneas (el máximo del schema) son hasta 800 queries contra
   un pool de 4 conexiones. **Ese sí es un problema de verdad y hoy.**
2. **Medir antes de tocar.** Cualquier otra optimización tiene que venir con
   el número de antes y el de después. Sin medición, no se toca.
3. **No hacer**: caché distribuido, sharding, colas, réplicas de lectura,
   micro-optimizaciones de render. No hay problema que las justifique.
4. Si al medir aparece algo más (índices faltantes, N+1 en listados,
   serialización cara), reportarlo con el número.

**Regla dura**: en un sistema contable, la corrección le gana a la velocidad
siempre. Ninguna optimización puede cambiar un resultado.

## 7. Invariantes que no se pueden violar

Los 22 de `docs/SUPER_PROMPT_MAESTRO.md`. Los que este trabajo toca de cerca:
partida doble · inmutabilidad post-aprobación · correlativo sin saltos ·
2 firmas · scope multi-tenant · audit log inmutable.

## 8. Trampas conocidas de este repo

- `or` (y `> 0`) como fallback donde el 0 es legítimo.
- Pydantic v2: `X | None` sin `= None` es REQUERIDO.
- El peso chileno no tiene centavos; residuo por RESTA.
- Regenerar `backend/openapi.json` ANTES de `npm run gen:types`.
- ⚠️ **Nada garantiza que una migración de alembic esté aplicada** — el deploy
  no las corre. Si el código dice "la BD lo valida", verificar en la BD.
- Antes de repartir archivos entre agentes, confirmar que todos tienen dueño.

## 9. Definición de terminado

- [ ] El PDF de `AFIS-2026-COM-00010` dice que el asiento CUADRA.
- [ ] Vista contable y financiera separadas, cada una con su total.
- [ ] Ningún `$0` que en realidad significa "no cargado".
- [ ] Auditoría del flujo completa, con severidades y escenarios.
- [ ] Guía HTML lista para un encargado sin formación contable.
- [ ] N+1 de `create_voucher` resuelto, con el número de antes y después.
- [ ] Tests en verde (1387 al empezar) + tests nuevos del cálculo de totales.
