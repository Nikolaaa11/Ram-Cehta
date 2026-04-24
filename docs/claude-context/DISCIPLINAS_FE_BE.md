# Disciplinas Frontend / Backend — Plataforma Cehta Capital
**Contexto:** Complemento del `PROMPT_MAESTRO_CEHTA_v3.2.md`
**Propósito:** Mostrar con código concreto cómo se aplican las 5 disciplinas en el día a día.

---

## TL;DR

El frontend de Cehta es moderno y normal — Next.js idiomático con pantallas que tienen personalidad propia. Lo único especial son **5 disciplinas** que eliminan el acoplamiento entre el frontend y las reglas del negocio. Con estas disciplinas, el 80% de los cambios futuros son solo backend.

---

## Las 5 disciplinas

### 1. No constantes de dominio en frontend
### 2. Backend retorna datos listos, no crudos
### 3. Backend dicta permisos
### 4. Validaciones de negocio siempre en backend
### 5. Tipos TS generados desde OpenAPI

---

## Disciplina 1: No constantes de dominio en frontend

### ❌ MAL

```tsx
// frontend/lib/constants.ts
export const IVA_RATE = 0.19
export const EMPRESAS = ['TRONGKAI', 'EVOQUE', 'DTE', 'REVTECH', 'CSL', 'RHO']
export const MAX_MONTO_OC = 50_000_000
export const CONCEPTOS_GENERALES = [
  'Recurso_Humano', 'Operación', 'Desarrollo_Proyecto', ...
]
```

Problemas:
- Si cambia el IVA → deploy frontend
- Si se agrega empresa → deploy frontend
- Si Benja propone nueva categoría → deploy frontend
- Duplicas fuente de verdad (la DB ya tiene estas listas)

### ✅ BIEN

Backend expone un endpoint de catálogos:

```python
# backend/app/api/v1/catalogos.py
@router.get("/catalogos")
async def get_catalogos() -> CatalogosResponse:
    return CatalogosResponse(
        empresas=[EmpresaDTO.from_orm(e) for e in await empresa_repo.list_all()],
        conceptos_generales=await concepto_repo.list_generales(),
        conceptos_detallados=await concepto_repo.list_detallados(),
        bancos=await banco_repo.list_all(),
        proyectos=await proyecto_repo.list_all(),
    )
```

Frontend los consume (con cache agresiva, catálogos cambian poco):

```tsx
// frontend/lib/api/hooks.ts
export function useCatalogos() {
  return useQuery({
    queryKey: ['catalogos'],
    queryFn: () => api.get('/catalogos'),
    staleTime: 5 * 60 * 1000,  // 5 min
  })
}

// frontend/components/oc/OCForm.tsx
function OCForm() {
  const { data: catalogos } = useCatalogos()
  if (!catalogos) return <Skeleton />

  return (
    <Select>
      {catalogos.empresas.map(e => (
        <option key={e.codigo} value={e.codigo}>{e.razon_social}</option>
      ))}
    </Select>
  )
}
```

**Ganas**: catálogos vivos siempre sincronizados con la DB. Agregar una empresa es solo un INSERT.

---

## Disciplina 2: Backend retorna datos listos

### ❌ MAL

Backend expone datos crudos y el frontend los procesa:

```python
# Backend
@router.get("/movimientos")
async def list_movimientos(empresa: str = None) -> list[MovimientoDTO]:
    return await mov_repo.list(empresa=empresa)  # todos los movimientos
```

```tsx
// Frontend hace el trabajo pesado ❌
function Dashboard() {
  const { data: movimientos } = useQuery(['mov'], fetchMovimientos)
  const { data: empresas } = useQuery(['emp'], fetchEmpresas)

  const saldosPorEmpresa = useMemo(() => {
    if (!movimientos || !empresas) return []
    return empresas.map(e => ({
      empresa: e.codigo,
      saldo: movimientos
        .filter(m => m.empresa_codigo === e.codigo)
        .reduce((acc, m) => acc + (m.abono || 0) - (m.egreso || 0), 0)
    }))
  }, [movimientos, empresas])

  // ... 50 líneas más de cálculos
}
```

Problemas:
- Bajar todos los movimientos (pueden ser miles) para mostrar 7 tarjetas
- Lógica de agregación duplicada si otra pantalla la necesita
- Si mañana una app móvil quiere el mismo dashboard, duplica el código

### ✅ BIEN

Backend hace el trabajo. Frontend renderiza:

```python
# backend/app/api/v1/dashboard.py
@router.get("/dashboard")
async def get_dashboard(current_user: User = Depends(get_current_user)) -> DashboardResponse:
    return await dashboard_service.build_dashboard(current_user)
```

```python
# backend/app/services/dashboard_service.py
class DashboardService:
    async def build_dashboard(self, user: User) -> DashboardResponse:
        empresas = await self.empresa_repo.list_for_user(user)

        kpis = []
        for e in empresas:
            saldo = await self.mov_repo.saldo_actual(e.codigo)
            trend = await self._calc_trend_mes_anterior(e.codigo)
            kpis.append(KpiData(
                id=f"saldo_{e.codigo}",
                label=f"Saldo {e.codigo}",
                value_raw=saldo,
                value_formatted=format_clp(saldo),
                trend_pct=trend,
                severity="info" if saldo > 0 else "warning",
                drill_down_url=f"/movimientos?empresa={e.codigo}",
            ))

        iva_info = await self.iva_service.iva_a_pagar_mes_actual()
        kpis.append(KpiData(
            id="iva_a_pagar",
            label="IVA a pagar (mes)",
            value_raw=iva_info.monto,
            value_formatted=format_clp(iva_info.monto),
            trend_pct=None,
            severity="danger" if iva_info.dias_hasta_vencimiento < 5 else "info",
            drill_down_url="/f29",
        ))

        return DashboardResponse(
            kpis=kpis,
            flow_chart=await self._build_flow_chart(),
            f29_alertas=await self._build_f29_alertas(),
        )
```

```tsx
// frontend/app/(app)/dashboard/page.tsx
export default async function DashboardPage() {
  const data = await api.getDashboard()

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        {data.kpis.map(kpi => <KpiCard key={kpi.id} {...kpi} />)}
      </div>
      <FlowChart {...data.flow_chart} />
      <F29AlertsPanel alertas={data.f29_alertas} />
    </div>
  )
}
```

```tsx
// frontend/components/dashboard/KpiCard.tsx
export function KpiCard({ label, value_formatted, trend_pct, severity, drill_down_url }: KpiData) {
  return (
    <Link href={drill_down_url}>
      <Card className={severityClasses[severity]}>
        <CardHeader>{label}</CardHeader>
        <CardContent className="text-2xl font-bold">{value_formatted}</CardContent>
        {trend_pct !== null && <TrendBadge pct={trend_pct} />}
      </Card>
    </Link>
  )
}
```

Nota: `value_formatted` viene del backend. El frontend ni siquiera hace `Intl.NumberFormat` — el backend ya lo hizo. Esto es opcional (también podrías mandar solo `value_raw` y formatear en frontend con `Intl`), pero para valores monetarios complejos (UF + CLP, negativos en paréntesis, etc.) es más seguro que el backend lo haga.

**Ganas**: Una query HTTP en lugar de dos. Lógica centralizada. App móvil futura consume lo mismo sin duplicar código.

---

## Disciplina 3: Backend dicta permisos

### ❌ MAL

```tsx
function OCDetailPage({ oc }: { oc: OC }) {
  const { user } = useAuth()

  return (
    <>
      <OCHeader oc={oc} />
      {/* ❌ frontend conoce reglas de autorización */}
      {user.role === 'admin' || user.role === 'finance' ? (
        <Button onClick={approveOC}>Aprobar</Button>
      ) : null}
      {user.role === 'admin' && oc.estado === 'emitida' ? (
        <Button onClick={cancelOC}>Anular</Button>
      ) : null}
      {/* … más condicionales … */}
    </>
  )
}
```

Problemas:
- Frontend conoce qué roles existen (acoplamiento)
- Si agregas rol nuevo → tocar todas las pantallas
- Las reglas de "qué puede hacer quién con qué" están duplicadas (backend también las tiene, para seguridad real)
- Si cambia una regla, hay que actualizar dos lugares

### ✅ BIEN

Backend calcula qué acciones están disponibles para este usuario y este recurso:

```python
# backend/app/services/authorization_service.py
class AuthorizationService:
    def allowed_actions_for_oc(self, user: User, oc: OC) -> list[str]:
        actions = []
        if user.has_scope("oc:read"):
            actions.append("download_pdf")
        if user.has_scope("oc:approve") and oc.estado == OCEstado.EMITIDA:
            actions.append("approve")
        if user.has_scope("oc:cancel") and oc.estado in (OCEstado.EMITIDA, OCEstado.PARCIAL):
            actions.append("cancel")
        if user.has_scope("oc:mark_paid") and oc.estado == OCEstado.EMITIDA:
            actions.append("mark_paid")
        return actions
```

```python
# backend/app/api/v1/oc.py
@router.get("/oc/{oc_id}")
async def get_oc(oc_id: int, user: User = Depends(get_current_user)) -> OCDetailResponse:
    oc = await oc_service.get(oc_id, user)
    return OCDetailResponse(
        **oc.to_dict(),
        allowed_actions=auth_service.allowed_actions_for_oc(user, oc),
    )
```

```tsx
// frontend/components/oc/OCActionsBar.tsx
const ACTION_CONFIG = {
  download_pdf: { label: "Descargar PDF", icon: Download, variant: "outline" },
  approve:      { label: "Aprobar",        icon: Check,    variant: "default" },
  cancel:       { label: "Anular",         icon: X,        variant: "destructive" },
  mark_paid:    { label: "Marcar pagada",  icon: DollarSign, variant: "default" },
} as const

export function OCActionsBar({ ocId, allowed_actions }: { ocId: number, allowed_actions: string[] }) {
  return (
    <div className="flex gap-2">
      {allowed_actions.map(action => {
        const config = ACTION_CONFIG[action]
        if (!config) return null
        return (
          <Button
            key={action}
            variant={config.variant}
            onClick={() => executeAction(ocId, action)}
          >
            <config.icon /> {config.label}
          </Button>
        )
      })}
    </div>
  )
}
```

**Ganas**: el frontend no sabe nada de roles. Si agregas un nuevo rol o cambias las reglas, solo backend.

Nota: `ACTION_CONFIG` en frontend es un mapping de `action_id → UI` (label, icono, color). Esto NO es lógica de negocio — es presentación. Qué botón se muestra lo decide el backend; cómo se ve lo decide el frontend.

---

## Disciplina 4: Validaciones de negocio siempre en backend

### La regla exacta

| Validación | Dónde |
|---|---|
| Campo requerido | Frontend (UX) + Backend (seguridad) |
| Formato email | Frontend (UX) + Backend (seguridad) |
| Tipo numérico | Frontend (UX) + Backend (seguridad) |
| Largo mínimo/máximo | Frontend (UX) + Backend (seguridad) |
| Formato visual de RUT (`XX.XXX.XXX-X`) | Frontend (UX) |
| RUT mod-11 válido | **Solo backend** |
| Monto < saldo disponible de la empresa | **Solo backend** |
| Fecha dentro del período fiscal válido | **Solo backend** |
| OC no supera presupuesto asignado al proyecto | **Solo backend** |
| Proveedor está habilitado | **Solo backend** |

### ✅ Implementación concreta

Backend tiene una función pura, testeada:

```python
# backend/app/domain/value_objects/rut.py
def validate_rut(rut: str) -> bool:
    # mod-11, ya implementado en cehta-etl
    ...

@router.get("/validate/rut")  # público, útil para UX en vivo
async def validate_rut_endpoint(rut: str) -> ValidationResponse:
    is_valid = validate_rut(rut)
    return ValidationResponse(
        valid=is_valid,
        message=None if is_valid else "RUT inválido (dígito verificador incorrecto)"
    )
```

Frontend hace validación UX en vivo llamando al endpoint:

```tsx
// frontend/components/shared/RutInput.tsx
export function RutInput({ value, onChange, onValidChange }: Props) {
  const [error, setError] = useState<string | null>(null)

  // Debounce: solo llama al backend 500ms después del último cambio
  const debouncedValue = useDebounce(value, 500)

  useEffect(() => {
    if (!debouncedValue || !isRutFormatValid(debouncedValue)) return

    api.validateRut(debouncedValue).then(res => {
      setError(res.valid ? null : res.message)
      onValidChange?.(res.valid)
    })
  }, [debouncedValue])

  return (
    <div>
      <Input
        value={value}
        onChange={e => onChange(formatRutVisual(e.target.value))}
        placeholder="12.345.678-9"
      />
      {error && <span className="text-red-500 text-sm">{error}</span>}
    </div>
  )
}

// isRutFormatValid es solo regex visual (ni siquiera mod-11)
// formatRutVisual es solo cosmético (pone puntos y guion)
```

La validación "real" vuelve a ocurrir en backend cuando se envía el form:

```python
# backend/app/api/v1/proveedores.py
@router.post("/proveedores")
async def create_proveedor(data: ProveedorCreate) -> ProveedorResponse:
    if not validate_rut(data.rut):
        raise HTTPException(422, "RUT inválido")
    # ... resto
```

Si el usuario bypasea el frontend (curl, editor de requests), el backend lo atrapa. El frontend da buena UX pero no es la red de seguridad.

---

## Disciplina 5: Tipos TS generados desde OpenAPI

### Workflow

```
┌──────────────────────────────────────────────────┐
│ Backend (FastAPI)                                 │
│                                                    │
│   Pydantic models → @router endpoints             │
│                           │                        │
│                           ▼                        │
│                     openapi.json (auto-generado)  │
└───────────────────────────┬──────────────────────┘
                            │
                            │ CI step:
                            │ openapi-typescript backend/openapi.json \
                            │   -o frontend/types/api.ts
                            ▼
┌──────────────────────────────────────────────────┐
│ Frontend                                          │
│                                                    │
│   import type { DashboardResponse } from '@/types/api'│
│                                                    │
│   const data: DashboardResponse = await api.getDashboard()│
└──────────────────────────────────────────────────┘
```

### Configuración concreta

`backend/app/main.py`:
```python
app = FastAPI(
    title="Cehta Capital API",
    version="0.1.0",
    openapi_tags=[...],
)

@app.on_event("startup")
async def dump_openapi():
    if settings.dump_openapi:
        import json
        with open("openapi.json", "w") as f:
            json.dump(app.openapi(), f, indent=2)
```

`frontend/package.json`:
```json
{
  "scripts": {
    "gen:types": "openapi-typescript ../backend/openapi.json -o types/api.ts",
    "predev": "npm run gen:types",
    "prebuild": "npm run gen:types"
  }
}
```

`.github/workflows/frontend-ci.yml`:
```yaml
- name: Generate types from OpenAPI
  run: |
    npm run gen:types
    if ! git diff --exit-code types/api.ts; then
      echo "::error::types/api.ts está desactualizado. Regenera localmente y commitea."
      exit 1
    fi
```

### Consecuencia

Si alguien cambia un campo en backend (renombra `total` a `monto_total`), el build del frontend falla inmediatamente en CI. No hay error silencioso en runtime ni datos undefined en producción.

---

## Test de humo: ¿está el código cumpliendo las disciplinas?

Al terminar cada sprint, correr estos checks:

```bash
# Disciplina 1 — no constantes de negocio
grep -rn "0\.19\|0,19" frontend/src           # debe estar vacío
grep -rn "EMPRESAS\s*=\s*\[" frontend/src     # debe estar vacío
grep -rn "= *'TRONGKAI'\|= *\"TRONGKAI\"" frontend/src  # solo en tests
grep -rnE "^\s*const\s+(IVA|TAX|RATE|MAX_MONTO)" frontend/src  # vacío

# Disciplina 2 — no cálculos de negocio en frontend
grep -rn "\.reduce.*+\|\.reduce.*-\|\.reduce.*\*" frontend/src/app frontend/src/components
# debe estar vacío o ser solo manipulación de arrays de UI (concat de clases, etc.)

# Disciplina 3 — no authorization logic en frontend
grep -rn "user\.role ===" frontend/src        # vacío
grep -rn "if.*permission" frontend/src        # vacío

# Disciplina 4 — no validaciones de dominio
grep -rn "validateRut\|validarRut\|mod11\|mod-11" frontend/src  # vacío
grep -rn "calcularIVA\|compute.*iva" frontend/src  # vacío

# Disciplina 5 — tipos sincronizados
diff <(npm run gen:types --silent && cat frontend/types/api.ts) frontend/types/api.ts
# debe ser idéntico (sin diff)
```

Si algún check falla, el build se marca en ámbar y se revisa en PR.

---

## Cuándo rompería una disciplina (y por qué no deberías)

| Tentación | Por qué es mala idea |
|---|---|
| "Pongamos IVA en frontend, es más rápido" | El día que cambie (o necesites UF) toca frontend. No ahorras nada. |
| "Validemos RUT en frontend para evitar el roundtrip" | Ya validas formato regex sin roundtrip. Mod-11 puro es del dominio. |
| "Calculemos el total en cliente, es trivial" | 1 mes después tienes 30 lugares que calculan "trivialmente" y uno tiene un bug sutil. |
| "El endpoint devuelve muchos campos que no uso" | Entonces el endpoint no es para esa pantalla. Crea uno que devuelva lo que necesitas. |
| "Hardcodemos las empresas, cambian muy poco" | Empresa 8 llegará antes de lo que crees. |

---

## Resumen operativo para code review

Antes de aprobar un PR, pregúntate por cada archivo frontend tocado:
- [ ] ¿Tiene algún número mágico de negocio? Debe ser 0.
- [ ] ¿Hace algún cálculo aritmético sobre datos del backend? No debería.
- [ ] ¿Decide qué mostrar basándose en `user.role`? No debería (usar `allowed_actions`).
- [ ] ¿Valida reglas de dominio (mod-11, montos, fechas de negocio)? No debería.
- [ ] ¿Los tipos TS usados vienen de `@/types/api` (auto-generados)? Deberían.

Si las 5 respuestas son correctas, merge.
