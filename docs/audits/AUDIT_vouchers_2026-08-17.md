# Audit: `/vouchers` · 2026-08-17

**Archivos**: `frontend/app/(app)/vouchers/page.tsx` (40 líneas, Server Component)
+ `frontend/app/(app)/vouchers/VouchersClientView.tsx` (1868 líneas, cliente).

**Método**: lectura completa del `page.tsx` + `VouchersClientView.tsx`, contrastado
contra `backend/app/api/v1/vouchers.py` (endpoints `/vouchers`, `/vouchers/search`,
`/vouchers/paginated`) y `frontend/components/providers.tsx` (defaults TanStack).

**NO se modificó código.** Este doc es solo el diagnóstico.

---

## Resumen ejecutivo

| Sev | # | Findings |
|-----|---|----------|
| P1  | 3 | Fuga cross-empresa en el buscador · firma masiva sobre vouchers ocultos · la búsqueda descarta todos los filtros |
| P2  | 6 | Sin error state · truncado silencioso a 200 · Σ total mezcla monedas · flash de vacío falso · filas no navegables por teclado · loading pobre |
| P3  | 6 | Chips con lógica floja · off-by-one UTC · 7 CTAs sin jerarquía · mobile · bulk secuencial · código muerto |

**Lo primero que haría**: F1 (seguridad, 30 min) y F2 (plata + irreversible, 1h).
Ambos son de bajo esfuerzo y alto impacto.

**Lo que está bien** (no tocar): persistencia de filtros en URL (bookmarkeable/compartible),
`initialData` SSR para primer paint sin loading, debounce 300ms en la búsqueda,
prefetch en `onMouseEnter` de fila, stagger de animación limitado a ≤15 filas,
empty state con listado explícito de los filtros probados.

---

## Findings

### F1 · `/vouchers/search` no valida scope multi-tenant — fuga de datos entre empresas · P1

**Tipo**: bug (seguridad)
**Esfuerzo**: S (~30 min, es backend)
**Severidad**: P1 — viola el invariante §1.4.16 de `docs/SUPER_PROMPT_MAESTRO.md`

Cuando el usuario escribe 3+ caracteres en el buscador, el front deja de usar
`GET /vouchers` (que sí filtra por scope) y pasa a `GET /vouchers/search`:

```tsx
// VouchersClientView.tsx:535
const useServerSearch = debouncedSearch.length >= 3;
const { data: searchResults } = useQuery<VoucherListItem[]>({
  queryFn: () => apiClient.get(`/vouchers/search?q=...&limit=100`, session),
```

El endpoint destino **no recibe `EmpresaScopeDep`** y su SQL no tiene ningún
filtro por empresa:

```python
# backend/app/api/v1/vouchers.py:126
@router.get("/vouchers/search", response_model=list[VoucherListItem])
async def search_vouchers(
    user: CurrentUser,
    db: DBSession,          # ← falta scope: EmpresaScopeDep
    q: str = Query(..., min_length=2, max_length=200),
    ...
    SELECT voucher_id, codigo, empresa_codigo, ... contraparte_nombre, total_debit
    FROM core.vouchers
    WHERE search_tsv @@ websearch_to_tsquery('spanish', :q)   -- ← sin WHERE empresa
```

Comparar con el hermano de al lado, que sí lo hace bien:

```python
# backend/app/api/v1/vouchers.py:196
async def list_vouchers(user: CurrentUser, db: DBSession, scope: EmpresaScopeDep, ...)
```

**Impacto**: un usuario con rol en 1 sola empresa (ej. Erick en CENERGY, Caterin en
CENERGY) escribe cualquier palabra común en el buscador de `/vouchers` y ve código,
glosa, contraparte, RUT y monto de vouchers de las 10 empresas del portafolio. El RUT
chileno es PII bajo Ley 19.628. No hace falta manipular la URL: **la ruta de ataque es
el input de búsqueda de la pantalla**.

El fallback ILIKE (cuando la migration 0046 no está) tiene el mismo problema.

**Fix**: inyectar el scope y filtrar en ambas ramas del try/except:

```python
async def search_vouchers(
    user: CurrentUser,
    db: DBSession,
    scope: EmpresaScopeDep,
    q: str = Query(..., min_length=2, max_length=200),
    limit: int = Query(default=50, ge=1, le=100),
):
    scope_filter = None if scope.is_global else list(scope.allowed_codes or [])
    if scope_filter is not None and not scope_filter:
        return []
    # ... y en el SQL:
    #   AND (:all_scope OR empresa_codigo = ANY(:codes))
```

Copiar el patrón exacto de `preview_transferencia_masiva`
(`backend/app/api/v1/vouchers_transferencia.py:583`), que ya lo resuelve bien.

**Verificar después del fix**: loguearse con un usuario de 1 sola empresa, buscar
"pago" y confirmar que no aparece ningún `empresa_codigo` ajeno.

---

### F2 · La firma masiva firma vouchers que el filtro está ocultando · P1

**Tipo**: bug
**Esfuerzo**: S (~1h)
**Severidad**: P1 — acción irreversible sobre plata, con confirmación que miente

`selectedIds` es un `Set` global que **sobrevive a los cambios de filtro**, pero todo
lo que se le muestra al usuario se calcula sobre `filteredVouchers` (la vista actual):

```tsx
// :583 — solo los seleccionados VISIBLES
const selectedItems = useMemo(
  () => filteredVouchers.filter((v) => selectedIds.has(v.voucher_id)), ...);

// :637 — el Σ total recorre solo filteredVouchers
for (const v of filteredVouchers) { if (selectedIds.has(v.voucher_id)) sum += ... }

// :1749 — pero se firma el Set COMPLETO
onClick={() => runBulkApprove(Array.from(selectedIds))}
```

**Reproducción**:
1. Filtrar `empresa = CENERGY`, estado `PENDING` → "Seleccionar todos" (ej. 8 vouchers).
2. Cambiar el filtro a `empresa = AFIS` → "Seleccionar todos" (ej. 3 vouchers).
3. El modal dice *"Firmar 11 vouchers"* pero el **Σ total solo suma los 3 de AFIS**.
4. Confirmar → se firman los 11, incluidos 8 que el usuario ya no tenía en pantalla
   cuando decidió.

El texto del modal cierra con *"esta acción queda firmada con tu usuario y no se puede
deshacer"* — o sea, la confirmación es exactamente donde el número está mal.

**Fix** (elegir uno, prefiero el A):

- **A — limpiar la selección al cambiar de filtro.** Es lo que el usuario espera y
  elimina la clase entera de bug:
  ```tsx
  useEffect(() => {
    setSelectedIds(new Set());
  }, [empresaFilter, tipoFilter, estadoFilter, sourceFilter, proyectoFilter,
      fechaDesde, fechaHasta, debouncedSearch, uf100Active]);
  ```
- **B — operar solo sobre lo visible**: pasar `selectedItems.map(v => v.voucher_id)`
  a `runBulkApprove` y a `runBulkDeleteDrafts`, y mostrar `selectedItems.length` en
  vez de `selectedIds.size` en la barra sticky (`:1561`) y en el modal (`:1688`).

**Mismo bug, peor consecuencia, en `/transferencias`**: ver F1 de
[AUDIT_transferencias_2026-08-17.md](AUDIT_transferencias_2026-08-17.md). Conviene
arreglar los dos juntos con el mismo criterio.

---

### F3 · Buscar (3+ caracteres) descarta silenciosamente TODOS los demás filtros · P1

**Tipo**: bug
**Esfuerzo**: M (~4h — requiere tocar el endpoint)
**Severidad**: P1 — el usuario cree estar viendo un subconjunto filtrado y no lo está

```tsx
// :553
const base = useServerSearch ? (searchResults ?? []) : /* ... lista filtrada ... */;
```

Cuando `useServerSearch` es true, `filteredVouchers` pasa a ser **exclusivamente** el
resultado de `/vouchers/search?q=`, que no acepta `empresa_codigo`, `tipo`, `status`,
`proyecto_codigo` ni rango de fechas. Los `<select>` siguen mostrando los valores
elegidos, la URL sigue teniendo `?empresa=AFIS&status=PENDING`, pero la tabla ya no
los respeta.

**Reproducción**: filtrar `empresa = AFIS` + `estado = PENDING`, escribir "arriendo".
La tabla muestra vouchers de todas las empresas y de todos los estados, con los
selects de AFIS/PENDING todavía puestos.

Efectos colaterales de la misma causa:
- El banner de resumen de proyecto (`:1134`) calcula "Total gastado / Vouchers /
  Promedio" sobre `filteredVouchers` → **cifras del proyecto contaminadas con
  vouchers de otros proyectos** apenas hay texto en el buscador.
- El empty state (`:1229`) enumera *"Probaste empresa=AFIS, estado=PENDING,
  búsqueda='x'"* como si los tres se hubieran aplicado.
- Los KPIs de arriba siguen calculados sobre `vouchers` (sin buscar), así que header
  y tabla se contradicen.

**Fix (orden de preferencia)**:
1. Agregar los filtros al endpoint `/vouchers/search` (empresa, tipo, status, fechas,
   proyecto) y pasarlos desde el front — aprovechando que igual hay que tocarlo por F1.
2. Mientras tanto, aplicar los filtros del cliente encima del resultado del search:
   ```tsx
   const base = useServerSearch
     ? (searchResults ?? []).filter((v) =>
         (!empresaFilter || v.empresa_codigo === empresaFilter) &&
         (!tipoFilter || v.tipo === tipoFilter) &&
         (!estadoFilter || v.status === estadoFilter))
     : /* ... */;
   ```
   (Imperfecto — el search trae 100 filas top-rank, así que sigue pudiendo perder
   resultados — pero deja de mentir sobre lo que muestra.)
3. Mínimo indispensable si no se hace ninguna de las dos: deshabilitar visualmente los
   selects mientras hay búsqueda activa, con un tooltip que lo explique.

---

### F4 · Sin error state: si la API falla, la pantalla dice "aún no hay vouchers" · P2

**Tipo**: bug
**Esfuerzo**: S (~1h)

La query principal nunca desestructura `error`:

```tsx
// :495
const { data: vouchers, isLoading } = useQuery<VoucherListItem[]>({ ... });
```

Si `/vouchers` devuelve 500 / timeout / 401, `vouchers` queda `undefined` y el render
cae en la rama `!vouchers || vouchers.length === 0` (`:1200`), que muestra el
`AdminEmptyState`: **"Empezá a registrar comprobantes · Aún no hay vouchers"**.

Un fallo de infraestructura se presenta como "tu base de datos está vacía", en la
pantalla contable principal. El operador va a pensar que se le borraron los datos.

`/transferencias` ya resuelve esto bien (`ErrorState` con `onRetry`); acá falta el
mismo patrón:

```tsx
const { data: vouchers, isLoading, error, refetch } = useQuery(...);
...
{error ? (
  <ErrorState
    title="No se pudo cargar la lista de vouchers"
    error={error as Error}
    onRetry={() => refetch()}
  />
) : isLoading ? ( ... ) : ...}
```

Nota: las queries auxiliares (`empresas`, `proyectos`, `sourceStats`, `searchResults`)
tampoco manejan error, pero ahí el modo degradado es aceptable (un select vacío).

---

### F5 · Truncado silencioso a 200 vouchers — y el CSV exporta ese recorte · P2

**Tipo**: bug
**Esfuerzo**: M (~4h)

```tsx
// :519
qs.set("limit", "200");
```

El backend acepta `limit` hasta 500 (`vouchers.py:211`) y ya existe
`/vouchers/paginated` — cuyo propio docstring dice *"Mejor que /vouchers (limit fijo)
para listados largos"* (`vouchers.py:346`) y trae el total con `COUNT(*) OVER()`
(ya optimizado, ver `docs/BACKLOG.md:80`).

En la pantalla nada indica que la lista está recortada: no hay "mostrando 200 de N",
no hay paginación, no hay botón "cargar más". Con 10 empresas en cierre mensual,
200 se pasa fácil.

**Lo que lo vuelve P2 y no P3**: el botón *Exportar CSV* (`:728`) exporta
`filteredVouchers` — es decir, el recorte — y después dice:

```tsx
toast.success(`${filteredVouchers.length} vouchers exportados`);
```

El operador se lleva un CSV de 200 filas creyendo que tiene el universo completo, y ese
CSV termina en una conciliación o en un envío a MCG. **Un export contable incompleto
que se presenta como completo.**

**Fix**: migrar a `/vouchers/paginated`, mostrar `total` en el header
("200 de 1.437") y, en el export, o bien traer todas las páginas antes de generar el
CSV, o bien advertir explícitamente en el toast que se exportó un subconjunto.

---

### F6 · Σ total mezcla CLP y UF y lo rotula todo como CLP · P2

**Tipo**: bug
**Esfuerzo**: S (~1h)

```tsx
// :635
for (const v of filteredVouchers) {
  if (selectedIds.has(v.voucher_id)) sum += Number(v.total_debit ?? 0);   // ← sin mirar v.moneda
}
// :1568 y :1733
<Currency value={selectedTotal} moneda="CLP" size="sm" />
```

Si el usuario selecciona un voucher de 120 UF y uno de $3.000.000 CLP, el modal de
firma masiva muestra `$3.000.120` — un número que no existe. Aparece justo encima del
aviso de que la firma es irreversible.

**Fix**: agrupar por moneda y renderizar un `Currency` por cada una, o bloquear la
selección mixta con un aviso ("hay vouchers en UF y CLP, el total no es comparable").
Lo mínimo: no rotular como CLP algo que no lo es.

---

### F7 · Flash de "no hay resultados" mientras la búsqueda está en vuelo · P2

**Tipo**: bug (percepción de estado)
**Esfuerzo**: S (~1h)

```tsx
const base = useServerSearch ? (searchResults ?? []) : ...;
```

Con `searchResults` todavía `undefined`, `filteredVouchers` es `[]` y el render entra
en el empty state *"No hay vouchers que coincidan con los filtros"* (`:1214`).
`isLoading` corresponde a la otra query, así que no lo tapa.

Resultado: **cada búsqueda muestra el vacío falso ~300-600ms antes de traer los
resultados.** El usuario que tipea rápido ve parpadear "no hay nada" repetidas veces.

**Fix**: traer `isFetching` de la query de búsqueda y usarlo como loading:

```tsx
const { data: searchResults, isFetching: searchFetching } = useQuery({...});
const showingLoader = isLoading || (useServerSearch && searchFetching && !searchResults);
```

O mantener los resultados anteriores con `placeholderData: keepPreviousData` de
TanStack v5 — es una línea y elimina el parpadeo entero.

---

### F8 · Las filas de la tabla no son navegables por teclado · P2

**Tipo**: accessibility
**Esfuerzo**: S (~1h)

```tsx
// :1532
<tr key={v.voucher_id} className={rowClass} onClick={onRowClick} onMouseEnter={onRowEnter}>
```

`<tr onClick>` sin `tabIndex`, sin `role`, sin handler de teclado. **Con teclado o
lector de pantalla no hay forma de abrir el detalle de un voucher desde la lista.**
Lo único focusable de la fila es el checkbox (y solo en filas PENDING/DRAFT) y el
`<code>` del tooltip, que no navega.

`/transferencias` lo resuelve bien: el código es un `<Link href={/vouchers/${id}}>`
real. Vale copiar ese patrón.

**Fix (mínimo)**: envolver el código en un `<Link>` y dejar el `onClick` de la fila
como atajo de mouse. **Fix (completo)**: además dar semántica a la fila:

```tsx
<tr
  tabIndex={0}
  role="link"
  aria-label={`Abrir voucher ${v.codigo}`}
  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRowClick(); } }}
  className={`${rowClass} focus-visible:outline focus-visible:outline-2 focus-visible:outline-cehta-green`}
  ...
>
```

---

### F9 · Loading state pobre comparado con el resto de la plataforma · P2

**Tipo**: nice-to-have
**Esfuerzo**: S (~1h)

```tsx
// :1198
{isLoading ? (<p className="text-sm text-ink-500">Cargando vouchers…</p>) : ...}
```

Un párrafo suelto donde va la tabla: colapsa el layout y después salta (CLS).
`/transferencias` ya tiene `TransferenciasSkeleton` (KPIs + chips + tabla con shimmer)
y el patrón `Surface`/skeleton está establecido en la plataforma.

**Fix**: crear `components/vouchers/VouchersSkeleton.tsx` reproduciendo header de KPIs
(4 cards) + fila de chips + 8 filas de tabla. Es el gemelo directo del de transferencias.

*Atenuante*: el SSR de `page.tsx` ya entrega `initialVouchers`, así que en la carga
inicial casi nunca se ve. Se ve cada vez que se cambia un filtro, que es lo frecuente.

---

### F10 · 7 CTAs compitiendo en el header, sin jerarquía · P2

**Tipo**: nice-to-have
**Esfuerzo**: M (~4h)

En `:720-822` hay siete acciones en fila: Exportar CSV · Importar CSV · Plantillas ·
Importar con IA · Desde mensaje · Asiento manual · **Nuevo voucher**. Cuatro son
maneras distintas de crear un voucher, y sus nombres no dicen cuándo usar cada una
(*"Asiento manual"* vs *"Nuevo voucher"* — que en realidad va al form Nubox).

Ya hay conciencia del problema en el propio código (`:801`, "lo promovemos a botón
primario verde"), pero el resto quedó en la fila.

En pantallas chicas los 7 botones envuelven en 3-4 líneas y empujan los KPIs bajo el
pliegue.

**Fix**: dejar dos botones visibles — **Nuevo voucher** (primario) y un split-button
"Crear de otra forma ▾" con las 3 alternativas de creación, más un menú "⋯" para
Exportar/Importar/Plantillas. `docs/BACKLOG.md:86` ya pide unificar terminología
(*Contraparte* vs *Proveedor*); conviene hacerlo en el mismo pase.

---

### F11 · El chip "Sobre UF 100" descarta todo lo que esté en CLP · P3

**Tipo**: bug (expectativa del usuario)
**Esfuerzo**: S (~1h)

```tsx
// :569
return base.filter((v) => v.moneda === "UF" && Number(v.total_debit ?? 0) > 100);
```

La limitación está documentada en el comentario (`:549`, no se convierte CLP→UF porque
la lista no trae `exchange_rate`), pero el chip dice *"Sobre UF 100"* a secas. Como
casi todos los vouchers chilenos son CLP, **el chip va a devolver lista vacía la
mayoría de las veces** y el usuario va a concluir que está roto.

**Fix**: renombrar el chip a **"UF > 100"** y agregar en el `title` "solo vouchers
emitidos en UF; los CLP no se convierten". Alternativa mejor: exponer `total_clp`
(equivalente) en `VoucherListItem` y filtrar por monto real, que es lo que el operador
quiere ("los grandes").

---

### F12 · El chip "Este mes" se ilumina con cualquier rango de fechas · P3

**Tipo**: bug (cosmético)
**Esfuerzo**: S (~15 min)

```tsx
// :974
fechaDesde && fechaHasta && !thisWeekActive
  ? "bg-blue-50 text-blue-700 ring-blue-200"   // ← estado "activo"
```

Cualquier rango elegido a mano (ej. 01-mar a 31-mar) pinta "Este mes" como si fuera el
preset aplicado.

**Fix**: espejar lo que ya se hizo bien en `thisWeekActive` (`:345`) — comparar contra
el primer y último día del mes actual:

```tsx
const thisMonthActive = useMemo(() => {
  if (!fechaDesde || !fechaHasta) return false;
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return fechaDesde === ymdLocal(first) && fechaHasta === ymdLocal(last);
}, [fechaDesde, fechaHasta]);
```

---

### F13 · `toISOString()` es UTC: los presets de fecha se corren un día de noche · P3

**Tipo**: bug
**Esfuerzo**: S (~1h)

`:322`, `:331-332`, `:351-352` usan `new Date().toISOString().slice(0, 10)`.
`toISOString()` devuelve **UTC**; Chile es UTC-3/-4. Después de las ~21:00 hora local,
la fecha UTC ya es la de mañana.

Efecto: a las 22:00 del 17-ago, "Esta semana" filtra `desde=2026-08-11` `hasta=2026-08-18`
— un día en el futuro, y corriendo la ventana un día hacia adelante. Silencioso: no
falla, simplemente filtra distinto de lo que dice el chip.

**Fix**: un helper local en `lib/format.ts` y usarlo en todos lados:

```ts
export const ymdLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
```

Mismo patrón está en `/transferencias:120` (ver F5 de ese audit) — arreglar juntos.

---

### F14 · La firma masiva son N POST secuenciales sin tope · P3

**Tipo**: performance
**Esfuerzo**: M (~4h)

```tsx
// :416
for (let i = 0; i < ids.length; i++) { await apiClient.post(`/vouchers/${id}/approve`, ...); }
```

Con 60 vouchers y ~300ms de RTT a Fly (gru), son ~18s con el modal bloqueado.
El toast sí muestra `Firmando i/N`, así que el feedback existe — el problema es la
duración y que no hay forma de cancelar a mitad.

**No proponer un endpoint bulk-approve**: el loop secuencial es deliberado para que cada
firma pase por la validación individual de firmante elegible (invariante §1.3.11,
"bypass de las 2 firmas" está prohibido — `docs/BACKLOG.md:160`). El fix correcto es
mantener llamadas individuales pero:
- paralelizar con concurrencia acotada (`p-limit` a 4-6) → ~4x más rápido, misma semántica;
- poner un tope duro (ej. 50, como ya hace el bulk-PDF en `:1604`) con mensaje claro;
- agregar botón "Detener" que corte el loop en la iteración siguiente.

---

### F15 · Código muerto: `kpis.totalAmount` se calcula y nunca se renderiza · P3

**Tipo**: cleanup
**Esfuerzo**: S (~15 min)

`:677-687` recorre todos los vouchers acumulando `totalAmount`, que no se usa en
ninguna parte del JSX (los 4 `<Kpi>` de `:827` son draft/pending/approved/threshold).
Además sumaría monedas mixtas, igual que F6.

**Fix**: borrarlo. O — probablemente lo que se quería — agregar un quinto KPI de monto
total, pero recién después de resolver el tema de monedas de F6.

---

### F16 · Mobile: la tabla obliga a scroll horizontal y los filtros son un muro · P3

**Tipo**: nice-to-have
**Esfuerzo**: M (~4h)

- `:1296` — `min-w-[800px]` con wrapper `overflow-x-auto`. En 375px de ancho eso son
  ~2 pantallas de scroll lateral por fila; las columnas Estado y Total (las que
  importan) quedan fuera de vista.
- `:1038` — la barra de filtros tiene 5 `<select>` + 2 `<input type=date>` + buscador
  sin ningún breakpoint. En mobile son ~7 líneas apiladas antes de llegar a la tabla.
- La barra sticky de acciones (`:1554`) usa `flex-wrap` con 5 elementos: en pantalla
  chica ocupa media pantalla.

**Fix**: por debajo de `md`, renderizar una lista de cards (código + glosa + monto +
badge de estado, tap → detalle) en vez de tabla, y colapsar los filtros en un
`<details>` "Filtros (3 activos)". El toggle de densidad (`:1017`) no aporta nada en
mobile — esconderlo con `hidden md:inline-flex`.

---

## Notas de performance (sin finding)

- Los defaults de TanStack (`providers.tsx:18`) son razonables: `staleTime` 2min,
  `gcTime` 10min, `refetchOnWindowFocus: false`, `retry: 1`. La query principal de
  vouchers no declara `staleTime` propio → hereda los 2min, que está bien para una
  lista operativa.
- `sourceStats` usa `staleTime: 30_000` con comentario R152zz. Consistente.
- El `useEffect` de sync a URL (`:257`) corre en cada tecla del buscador
  (`search` está en las deps) y hace `history.replaceState`. Es barato, pero se podría
  usar `debouncedSearch` en vez de `search` para no escribir la URL 20 veces por
  palabra tipeada. Trivial, no amerita finding.
- `VouchersClientView.tsx` son 1868 líneas / 80KB en un solo archivo cliente. No es un
  problema de bundle (se tree-shakea poco de todos modos), sí de mantenibilidad:
  extraer `<VouchersTable>`, `<VouchersFilters>` y los 2 modales bajaría el archivo a
  ~600 líneas. Sugerencia de refactor, no finding.

---

## Verificación pendiente (⚠ este audit es solo lectura de código)

Según [feedback_verificar_ui_no_solo_api], **hay que abrir la pantalla con Playwright**
antes de dar por buenos estos findings. En particular F2, F3 y F7 son reproducibles a
mano en 2 minutos cada uno:

1. **F2**: filtrar CENERGY → seleccionar todos → cambiar a AFIS → seleccionar todos →
   leer el número del modal vs el Σ total.
2. **F3**: filtrar empresa+estado → escribir "pago" → mirar si aparecen otras empresas.
3. **F7**: escribir despacio en el buscador y mirar si parpadea el empty state.
4. **F1**: requiere un login con scope acotado (ej. cescobar@cenergy.cl).
