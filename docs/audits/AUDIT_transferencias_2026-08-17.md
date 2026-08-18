# Audit: `/transferencias` · 2026-08-17

**Archivo**: `frontend/app/(app)/transferencias/page.tsx` (987 líneas, client component).

**Método**: lectura completa del `page.tsx`, contrastado contra
`backend/app/api/v1/vouchers_transferencia.py` (endpoints `preview` y
`transferencia-masiva`) y `backend/app/api/v1/vouchers.py` (`bulk-execute`).

**NO se modificó código.** Este doc es solo el diagnóstico.

---

## Resumen ejecutivo

| Sev | # | Findings |
|-----|---|----------|
| P1  | 1 | El modal de confirmación de pagos muestra un monto distinto al que realmente ejecuta |
| P2  | 3 | Subida de comprobante en serie sin progreso ni manejo de 401 · comprobante que se pierde en silencio · copy del footer contradice el botón |
| P3  | 5 | Fecha máxima en UTC · checkbox sin indeterminate · sin aria-live · mobile · "descargué pero no pagué" invisible |

**Lo primero que haría**: F1. Es el mismo bug de fondo que
[F2 de AUDIT_vouchers](AUDIT_vouchers_2026-08-17.md) — conviene arreglar los dos
con el mismo criterio en un solo pase.

**Lo que está bien** (y vale citar como referencia para otras pestañas):
`TransferenciasSkeleton` premium en vez de placeholder, empty state contextual de
3 ramas (`CajaAlDiaState` / esperando firma / borradores sin enviar) que apunta al
siguiente paso real del flujo, `ErrorState` con retry, modal con `useModalA11y`
(focus trap + ESC + scroll lock + restauración de foco), `scope="col"` en los `<th>`,
pull-to-refresh en mobile, y el toast post-descarga que enumera los 3 pasos
siguientes (R152OOOOOO). Es una de las pestañas mejor terminadas de la plataforma.

---

## Findings

### F1 · El modal dice "N vouchers por $X" pero ejecuta el Set completo, incluidos los ocultos por el filtro · P1

**Tipo**: bug
**Esfuerzo**: S (~1h)
**Severidad**: P1 — plata, irreversible, y la confirmación es exactamente donde está el número equivocado

`selectedIds` **sobrevive al cambio de filtro de empresa**, pero el resumen que se le
muestra al usuario se calcula solo sobre lo visible:

```tsx
// :152 — items = solo la empresa filtrada
const items = useMemo(() => {
  const all = data?.items ?? [];
  if (!empresaFilter) return all;
  return all.filter((i) => i.empresa_codigo === empresaFilter);
}, [data, empresaFilter]);

// :183 — el resumen recorre `items` (filtrado)
const selectedSummary = useMemo(() => {
  const sel = items.filter((i) => selectedIds.has(i.voucher_id));
  ...
}, [items, selectedIds]);

// :316 y :228 — pero se ejecuta / se exporta el Set COMPLETO
voucher_ids: Array.from(selectedIds),
```

**Reproducción**:
1. Chip de empresa `CENERGY` → "seleccionar todos los visibles" (ej. 6 vouchers, $12M).
2. Cambiar el chip a `AFIS` → "seleccionar todos los visibles" (ej. 2 vouchers, $1,5M).
3. "Marcar pagados". El modal dice: *"Vas a marcar como **EXECUTED** 2 vouchers por
   un total de **$1.500.000**"*.
4. Confirmar → **se marcan los 8 vouchers, $13,5M**, y el toast de éxito reporta
   `$1.500.000 transferidos` (usa `selectedSummary.total`, `:374`).

O sea: se ejecutan 6 pagos que el usuario no vio en la confirmación, y **el registro
en pantalla del monto pagado también queda mal**. Como EXECUTED es un estado terminal
del flujo (`el voucher pasa al historial y deja de aparecer en esta lista`, dice el
propio modal), no hay deshacer.

Lo mismo aplica al Excel de transferencia (`handleDownload`, `:228`): se descarga una
planilla con vouchers de empresas que no estaban en pantalla. Ahí es menos grave
porque el toast reporta `X-Total-Rows` real del backend, así que la discrepancia es
detectable — pero recién *después* de haber generado el archivo que se sube al banco.

**Fix** (mismo criterio que F2 de vouchers; prefiero A):

- **A — limpiar la selección al cambiar de empresa**:
  ```tsx
  useEffect(() => { setSelectedIds(new Set()); }, [empresaFilter]);
  ```
  Es lo que el usuario espera del chip y mata la clase entera de bug.
- **B — operar solo sobre lo visible**: pasar los ids de `items.filter(selected)` a
  `handleDownload` y `handleBulkExecute`.
- **C — si se quiere conservar la selección cross-empresa a propósito** (tiene sentido:
  "pago todo lo del día de las 10 empresas"), entonces la barra sticky debe mostrar
  el total **global** (`selectedIds`) y no el filtrado, y agregar un aviso del tipo
  *"3 de los 8 seleccionados están fuera del filtro actual"*.

Sea cual sea la opción, `selectedSummary` y lo que se manda al backend tienen que
salir de la misma fuente.

---

### F2 · El comprobante se sube en un loop secuencial, sin progreso y sin manejo de 401 · P2

**Tipo**: bug + performance
**Esfuerzo**: M (~4h)

```tsx
// :339
if (executeFile && executedVoucherIds.length > 0) {
  for (const vid of executedVoucherIds) {
    const r = await fetch(`${API_BASE}/vouchers/${vid}/attachments`, { method: "POST", ... });
```

Tres problemas en el mismo bloque:

1. **Serie, no paralelo**: el *mismo* archivo se sube N veces, una tras otra. Con un
   lote de 40 vouchers y un PDF de 2MB sobre Fly (gru), son 40 uploads secuenciales —
   fácilmente 40-80 segundos.
2. **Sin progreso**: el botón dice `Procesando…` de punta a punta. El usuario no sabe
   si va por el 3 o por el 38, y no tiene cómo cancelar. Es muy probable que cierre la
   pestaña a mitad, dejando parte del lote sin respaldo.
3. **`fetch` crudo sin manejo de sesión expirada**: se usa `fetch` directo en vez de
   `apiClient`, así que un 401 (token vencido justo durante un lote largo — que es
   precisamente cuando más probable es) cae en `attachedFail++` y se reporta como
   "comprobante falló en 37 vouchers", sin disparar `handleSessionExpired()`.
   Es el mismo patrón que `docs/BACKLOG.md:26` ya marca como deuda para
   `vouchers/nubox`.

**Fix**:
- Paralelizar con concurrencia acotada (4-6 a la vez) — reduce ~6x el tiempo.
- Reemplazar el `fetch` crudo por el helper de `apiClient` que ya maneja 401, o
  chequear `r.status === 401` explícitamente y cortar el loop llamando a
  `handleSessionExpired()`.
- Mostrar progreso real: `toast.loading("Subiendo comprobante 12/40…", { id })`, que
  es el patrón que ya usa `runBulkApprove` en `/vouchers`.
- **Mejor aún (evita todo lo anterior)**: un endpoint que reciba el archivo una sola
  vez y lo asocie a los N vouchers del lote. Es 1 request en vez de 40 y elimina los
  estados parciales. Requiere backend (~4h más), pero es el fix correcto.

---

### F3 · Si el lookup por código falla, el comprobante se pierde sin que nadie se entere · P2

**Tipo**: bug
**Esfuerzo**: S (~1h)

```tsx
// :332
const executedVoucherIds = (resp.executed_codes ?? []).map((codigo) => {
  const v = allItems.find((it) => it.codigo === codigo);
  return v?.voucher_id;
}).filter((v): v is number => v !== undefined);
```

El backend devuelve **códigos**; el front los traduce a ids buscando en la lista que
tiene cacheada. Si un código no aparece en `data.items` (lista desactualizada, voucher
que cambió entre el `preview` y el `bulk-execute`, o cualquier divergencia de
normalización), el `.filter()` lo descarta en silencio.

Consecuencia: ese voucher queda **EXECUTED pero sin comprobante adjunto**, y el
contador de fallos (`attachedFail`) **no lo cuenta** — el usuario ve
*"comprobante subido a 38 vouchers"* sin saber que faltaron 2. Para un respaldo de
pago que después se audita, eso es un agujero silencioso.

**Fix corto**: comparar longitudes y avisar.

```tsx
const notFound = (resp.executed_codes ?? []).length - executedVoucherIds.length;
if (notFound > 0) {
  toast.info(`${notFound} voucher(s) quedaron sin comprobante adjunto — subilos desde su detalle.`,
             { duration: 12000 });
}
```

**Fix correcto**: pedirle al backend que `bulk-execute` devuelva `executed_ids`
(numéricos) además de `executed_codes`, y eliminar el lookup por string. Se resuelve
solo si se hace el endpoint de attachment por lote de F2.

---

### F4 · El texto del pie contradice el botón que está arriba · P2

**Tipo**: bug (copy desactualizado)
**Esfuerzo**: S (~15 min)

```tsx
// :935
💡 Workflow: selecciona los vouchers a pagar → descarga el Excel → cargá al banco
   (BCI / Santander / BancoEstado) → confirmás las transferencias. Después marcá cada
   voucher como EXECUTED desde su pantalla de detalle.
```

El *"desde su pantalla de detalle"* quedó de antes de la Etapa A. Hoy existe el botón
**"Marcar pagados"** en la barra sticky de esta misma pantalla, que hace exactamente
eso en lote — y el toast post-descarga (`:268`) ya dice lo correcto
(*"volvé aquí, seleccioná los pagados y usá Marcar EXECUTED"*).

Las dos instrucciones conviven en la misma página y se contradicen. Un operador nuevo
va a hacer lo del pie: abrir 20 vouchers uno por uno.

El header (`:466`) tiene un desfase parecido: *"Revisa datos, selecciona los del día y
descarga el Excel para cargar al banco"* — describe solo la mitad del flujo, sin
mencionar el paso de confirmación que la pantalla ahora también cubre.

**Fix**: reescribir el pie para que termine en *"→ volvé acá, seleccionalos y usá
**Marcar pagados** con el comprobante"*, y alinear el subtítulo del hero.
15 minutos, cero riesgo.

---

### F5 · `max={today}` se calcula en UTC — de noche permite fechar un pago mañana · P3

**Tipo**: bug
**Esfuerzo**: S (~30 min)

```tsx
// :120
const today = new Date().toISOString().slice(0, 10);
// :660
<input type="date" value={executeFecha} max={today} ... />
```

`toISOString()` es UTC y Chile es UTC-3/-4: pasadas las ~21:00 locales, `today` ya es
la fecha de mañana. El `max` que debía impedir fechas futuras deja pasar **un día en
el futuro**, y el default de `executeFecha` también arranca en mañana.

Como `fecha_ejecucion` va al voucher y al audit log, un pago confirmado a las 22:30 del
17 queda registrado como ejecutado el 18 — cruzando períodos si eso pasa un fin de mes.

**Fix**: usar fecha local (mismo helper que propongo en F13 del audit de vouchers):

```ts
const ymdLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const today = ymdLocal(new Date());
```

Vale revisar de paso si el backend valida `fecha_ejecucion <= hoy`; si no lo hace, el
`max` del input es la única defensa y conviene reforzarlo server-side.

---

### F6 · El checkbox "seleccionar todos" no tiene estado indeterminado · P3

**Tipo**: accessibility / nice-to-have
**Esfuerzo**: S (~30 min)

```tsx
// :787
<input type="checkbox" checked={allFilteredSelected} onChange={toggleAllVisible}
       aria-label="Seleccionar todos los visibles" ... />
```

Con selección parcial (5 de 12) el checkbox se ve **vacío**, igual que con 0
seleccionados. Es el estado donde más importa distinguir, porque es justo cuando el
usuario está eligiendo qué pagar.

**Fix**: agregar `ref` + `indeterminate`:

```tsx
const selectAllRef = useRef<HTMLInputElement>(null);
useEffect(() => {
  if (selectAllRef.current) {
    const n = items.filter(i => selectedIds.has(i.voucher_id)).length;
    selectAllRef.current.indeterminate = n > 0 && n < items.length;
  }
}, [items, selectedIds]);
```

Detalle menor del mismo bloque: el `<th>` del checkbox (`:786`) es el único sin
`scope="col"` — los otros 8 lo tienen (fix del QA de 14/05). Agregarlo por consistencia.

---

### F7 · La barra sticky de acciones no se anuncia a lectores de pantalla · P3

**Tipo**: accessibility
**Esfuerzo**: S (~30 min)

La barra de `:540` aparece/desaparece según `selectedIds.size > 0` y su contenido
("6 seleccionados · Total: $12.400.000 · 2 sin datos bancarios") cambia con cada
click, pero es un `<div>` plano: un lector de pantalla no anuncia nada de eso.
Para un usuario con lector, el estado de la selección es invisible.

Lo mismo con el aviso `{selectedSummary.sinBanco} sin datos bancarios` (`:548`),
que es una advertencia relevante antes de generar la planilla del banco.

**Fix**:

```tsx
<div role="status" aria-live="polite" aria-atomic="true" className="...">
  {selectedSummary.count} seleccionados · Total: {toCLP(selectedSummary.total)}
  {selectedSummary.sinBanco > 0 && ` · ${selectedSummary.sinBanco} sin datos bancarios`}
</div>
```

---

### F8 · Mobile: tabla de 9 columnas sin adaptación · P3

**Tipo**: nice-to-have
**Esfuerzo**: M (~4h)

La tabla (`:783`) tiene 9 columnas — Código, Empresa, Fecha, Proveedor, Glosa, Monto,
Datos bancarios, WA — dentro de un `overflow-x-auto`. A diferencia de `/vouchers`
acá ni siquiera hay `min-w`, así que las columnas se comprimen hasta volverse
ilegibles antes de empezar a scrollear, y las dos que definen la decisión (**Monto** y
**Datos bancarios**) quedan al final.

La barra sticky (`:540`) con selector de banco + input de cuenta origen + 3 botones
en `flex-wrap` ocupa media pantalla en 375px.

Que la pantalla tenga pull-to-refresh implementado (`:148`) indica que **el uso mobile
está previsto**; la tabla no acompaña.

**Fix**: bajo `md`, lista de cards — proveedor + monto grande + badge de datos
bancarios + checkbox — y mover el selector de banco/cuenta origen dentro del modal de
descarga en vez de tenerlo en la barra sticky.

---

### F9 · Nada distingue "ya descargué el Excel" de "todavía no lo bajé" · P3

**Tipo**: nice-to-have
**Esfuerzo**: M (~4h)

El flujo tiene dos pasos separados por una salida al banco (descargar Excel → subirlo
→ confirmar → volver y marcar pagados), que pueden ser horas distintas o incluso
personas distintas (el propio header del archivo lo dice: *"el user que aprueba puede
no ser el mismo que paga"*). Pero al volver, la pantalla se ve **idéntica**: tras
descargar, `setSelectedIds(new Set())` limpia la selección (`:280`) y no queda ninguna
marca de qué vouchers ya se enviaron al banco.

Riesgos concretos: pagar dos veces el mismo lote, o dar por pagado algo que nunca se
cargó al portal.

**Fix**: registrar el `exportado_at` en el voucher al generar el Excel (el backend ya
conoce los ids del request) y mostrar en la fila un chip *"En banco · hace 2h"*, más
un chip de filtro **"Descargados sin confirmar"**. Es el hueco más grande que le queda
al flujo, aunque no sea un defecto de la pantalla en sí.

---

## Notas de performance (sin finding)

- La query del preview usa `staleTime: 30_000` (`:136`), razonable para una cola
  operativa. `enabled: !!session` correcto.
- Se reusa `useSidebarState()` (cache compartida) para decidir qué empty state mostrar
  en vez de pedir counters aparte — buen patrón, vale replicarlo.
- Tras `bulk-execute` se invalidan las 3 queries relacionadas
  (`transferencias-preview`, `vouchers`, `vouchers-kpis`) — correcto.
- El endpoint `GET /vouchers/transferencia-masiva/preview` **sí** recibe
  `EmpresaScopeDep` y filtra por `scope.allowed_codes`
  (`vouchers_transferencia.py:583`). Contrasta con `/vouchers/search`, que no lo hace
  — ver F1 del audit de vouchers.
- 987 líneas en un archivo, pero ya hay 4 componentes extraídos a
  `components/transferencias/`. La estructura está sana; lo único que valdría sacar es
  el modal de confirmación (~160 líneas).

---

## Verificación pendiente (⚠ este audit es solo lectura de código)

Según [feedback_verificar_ui_no_solo_api], hay que reproducir en la UI con Playwright
antes de dar los findings por confirmados. Prioridad:

1. **F1** (5 min, es el crítico): con vouchers APPROVED de ≥2 empresas — seleccionar
   todos en una, cambiar de chip, seleccionar todos en la otra, abrir el modal y
   comparar el monto del modal contra lo que realmente queda EXECUTED.
   **Hacerlo contra un entorno de prueba, no contra pagos reales.**
2. **F5** (1 min): cambiar la hora del sistema a las 23:00 y ver qué `max` toma el
   input de fecha.
3. **F2/F3**: lote de 3+ vouchers con comprobante adjunto, mirando la pestaña Network.
