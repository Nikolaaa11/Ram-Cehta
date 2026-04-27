# 📐 Guía Completa V2 — Cehta Capital

> Guía técnica + funcional de las mejoras V2: CRUD completo, Reportes para
> Inversionistas, Panel de Auditoría y Gestión de Usuarios. Para Nicolas y
> futuros engineers que mantengan la plataforma.
>
> **Última actualización**: 2026-04-25.

---

## 1. Visión general

V2 transforma la plataforma de un MVP de visualización a una herramienta operativa completa con:
- **CRUD pleno** sobre todos los recursos (crear/leer/editar/eliminar)
- **Reportes formales** para LPs y comité de inversión, exportables a PDF
- **Auditoría interna** para verificar que el ETL funciona y los datos son correctos
- **Gestión de usuarios** sin necesidad de tocar SQL

### Stack técnico (sin cambios)
- **Backend**: FastAPI 0.115 + SQLAlchemy 2.x + Postgres (Supabase)
- **Frontend**: Next.js 15.5 App Router + React 19 + TanStack Query v5
- **PDFs**: `@react-pdf/renderer` (cliente, sin Puppeteer)
- **Modals**: Radix UI Dialog + AlertDialog
- **Toasts**: `sonner` (ya integrado en V1)

### Decisiones técnicas clave (V2)
1. **PDF cliente vs servidor**: cliente. Razones: 0 deps en backend, 0 ataque surface server-side, react-pdf da control pixel-perfect Apple-style.
2. **Confirmation modals con AlertDialog (no Dialog)**: AlertDialog impide cerrar con Escape o click-outside — para destructive actions es UX correcto.
3. **Optimistic updates en delete**: TanStack Query con rollback. UX inmediato, fallback elegante si falla.
4. **Admin gate server-side**: `app/(app)/admin/layout.tsx` redirect ANTES de render. Defensa en profundidad además del backend.

---

## 2. Inventario de features

### 2.1 CRUD completo

| Recurso | Crear | Leer | Editar | Eliminar | Notas |
|---|---|---|---|---|---|
| Proveedor | ✅ V1 | ✅ V1 | 🆕 V2 | 🆕 V2 (soft) | Soft-delete = `activo=false` |
| Orden de Compra | ✅ V1 | ✅ V1 | 🆕 V2 (parcial) | 🆕 V2 (anular) | Solo campos no-críticos editables |
| F29 | ✅ V1 | ✅ V1 | 🆕 V2 | 🆕 V2 (admin) | Mark paid es caso especial |
| Suscripción acción | 🆕 V2 | 🆕 V2 | — | — | Append-only, no se edita |
| Movimiento | ❌ | ✅ V1 | ❌ | ❌ | ETL maneja, no manual |
| Usuario (rol) | 🆕 V2 | 🆕 V2 | 🆕 V2 | 🆕 V2 | Solo admin |

### 2.2 Reportes para Inversionistas (4 tipos)

#### Reporte 1 — Estado del Fondo
- **Audiencia**: LPs, comité de inversión, auditor externo
- **Frecuencia**: mensual
- **Contenido**:
  - Hero: AUM total, Saldo Cehta consolidado, Saldo CORFO consolidado
  - Tabla saldos por empresa (9 filas)
  - Cashflow timeline 12 meses
  - Footer compliance: "Cehta Capital — Confidencial"
- **Filtros**: período (default mes actual), empresa (opcional)
- **Exportable**: PDF

#### Reporte 2 — Composición del Portafolio
- **Audiencia**: Comité, due diligence
- **Frecuencia**: trimestral
- **Contenido**:
  - Una página por empresa con KPIs:
    - Saldo contable, Saldo Cehta, Saldo CORFO
    - OCs pendientes (count + monto)
    - F29 pendientes (count)
    - Última actividad
  - Resumen final con ranking de proyectos por gasto
- **Filtros**: período
- **Exportable**: PDF

#### Reporte 3 — Suscripciones de Acciones
- **Audiencia**: LPs nuevos, contabilidad
- **Frecuencia**: bajo demanda (al cierre de ronda)
- **Contenido**:
  - KPI hero: total acciones, total CLP, total UF, # contratos
  - Tabla detalle: fecha, empresa, acciones_pagadas, monto_uf, monto_clp, contrato_ref, firmado, recibo
- **Filtros**: empresa, año
- **Exportable**: PDF

#### Reporte 4 — Compliance Tributario
- **Audiencia**: Auditor, contador
- **Frecuencia**: mensual
- **Contenido**:
  - KPI: F29 pagadas mes actual, F29 vencidas, F29 próximas
  - Tabla por empresa × período: estado de F29
  - Heatmap visual de compliance
- **Filtros**: año, empresa
- **Exportable**: PDF

### 2.3 Panel de Auditoría (admin only)

| Sección | Ruta | Función |
|---|---|---|
| Landing | `/admin` | KPIs + accesos rápidos |
| ETL Runs | `/admin/etl` | Histórico de procesos del ETL externo `cehta-etl` |
| ETL Detail | `/admin/etl/{run_id}` | Drilldown a rejected rows del run |
| Data Quality | `/admin/data-quality` | Issues automáticos de inconsistencias |
| Usuarios | `/admin/usuarios` | Asignar/cambiar/quitar roles |

### 2.4 Data Quality Issues (auto-detectadas)

El backend computa en `GET /audit/data-quality`:
1. **OCs sin pago > 30 días** (severity: medium)
2. **F29 vencidas no pagadas** (severity: high)
3. **Empresas sin movimientos en período actual** (severity: low — alerta de ETL)
4. **Movimientos con saldo NULL** (severity: medium — ETL data gap)
5. **Filas rechazadas en último ETL** (severity: alta si > 5%, baja si < 5%)

Cada issue: severity, category, count, description, link a recurso afectado.

---

## 3. Modelos de datos nuevos (V2)

### 3.1 `core.suscripciones_acciones` (ya en schema)
```sql
suscripcion_id BIGSERIAL PRIMARY KEY,
empresa_codigo TEXT NOT NULL REFERENCES core.empresas(codigo),  -- quien emite
fecha_recibo DATE NOT NULL,
acciones_pagadas NUMERIC(18,4) NOT NULL,
monto_uf NUMERIC(18,4),
monto_clp NUMERIC(18,2) NOT NULL,
contrato_ref TEXT,
recibo_url TEXT,
firmado BOOLEAN DEFAULT FALSE,
fecha_firma TIMESTAMPTZ,
created_at TIMESTAMPTZ DEFAULT now()
```

### 3.2 `audit.etl_runs` (ya en schema)
```sql
run_id UUID PRIMARY KEY,
started_at, finished_at TIMESTAMPTZ,
source_file TEXT,
source_hash TEXT,        -- SHA256 del Excel — útil para detectar reprocesamiento
rows_extracted, rows_loaded, rows_rejected INT,
status TEXT CHECK (status IN ('running','success','failed','partial')),
error_message TEXT,
triggered_by TEXT          -- 'scheduled' | 'manual' | 'webhook'
```

### 3.3 `audit.rejected_rows` (ya en schema)
```sql
rejected_id BIGSERIAL,
run_id UUID REFERENCES audit.etl_runs(run_id) ON DELETE CASCADE,
source_sheet TEXT,
source_row_num INT,
reason TEXT,
raw_data JSONB,
created_at TIMESTAMPTZ
```

### 3.4 `core.user_roles` (V1, expandido en uso V2)
```sql
user_id UUID PRIMARY KEY REFERENCES auth.users,
app_role TEXT CHECK (app_role IN ('admin','finance','viewer')),
assigned_at TIMESTAMPTZ,
assigned_by TEXT,
updated_at TIMESTAMPTZ
```

---

## 4. RBAC — scopes V2

Se extiende la matriz canónica en `backend/app/core/rbac.py`:

| Scope | admin | finance | viewer |
|---|:-:|:-:|:-:|
| `oc:read` | ✓ | ✓ | ✓ |
| `oc:create` | ✓ | ✓ | — |
| `oc:update` 🆕 | ✓ | ✓ | — |
| `oc:approve` | ✓ | ✓ | — |
| `oc:cancel` | ✓ | — | — |
| `oc:mark_paid` | ✓ | ✓ | — |
| `proveedor:read` | ✓ | ✓ | ✓ |
| `proveedor:create` | ✓ | ✓ | — |
| `proveedor:update` | ✓ | ✓ | — |
| `proveedor:delete` | ✓ | — | — |
| `f29:read` | ✓ | ✓ | ✓ |
| `f29:create` | ✓ | ✓ | — |
| `f29:update` | ✓ | ✓ | — |
| `f29:delete` 🆕 | ✓ | — | — |
| `suscripcion:read` 🆕 | ✓ | ✓ | ✓ |
| `suscripcion:create` 🆕 | ✓ | ✓ | — |
| `audit:read` 🆕 | ✓ | — | — |
| `user:read` 🆕 | ✓ | — | — |
| `user:write` 🆕 | ✓ | — | — |
| `user:delete` 🆕 | ✓ | — | — |
| `movimiento:read` | ✓ | ✓ | ✓ |

### Frontend usage
```tsx
const { data: me } = useMe();
const canDelete = me?.allowed_actions.includes("proveedor:delete") ?? false;
{canDelete && <DeleteButton/>}
```

---

## 5. Endpoints V2

### Backend nuevos (resumen)
```
POST   /api/v1/suscripciones-acciones
GET    /api/v1/suscripciones-acciones
GET    /api/v1/suscripciones-acciones/totals

GET    /api/v1/audit/etl-runs
GET    /api/v1/audit/etl-runs/{run_id}
GET    /api/v1/audit/etl-runs/{run_id}/rejected-rows
GET    /api/v1/audit/data-quality

GET    /api/v1/admin/users
POST   /api/v1/admin/users               # body: { email, app_role }
PATCH  /api/v1/admin/users/{user_id}/role
DELETE /api/v1/admin/users/{user_id}

PATCH  /api/v1/ordenes-compra/{oc_id}    # full edit (campos no-críticos)
PATCH  /api/v1/f29/{f29_id}              # mark paid + cualquier campo
DELETE /api/v1/f29/{f29_id}              # admin only
```

---

## 6. Patrones de UI V2

### 6.1 Edit/Delete pattern

Página de detalle → header con botones a la derecha:

```tsx
// app/(app)/proveedores/[id]/page.tsx
<header>
  <h1>{proveedor.razon_social}</h1>
  <ProveedorActions proveedorId={id} razonSocial={proveedor.razon_social} />
</header>
```

`ProveedorActions` es un client component que:
1. Lee `me.allowed_actions` con `useMe()`
2. Renderiza botón "Editar" si `proveedor:update` permitido
3. Renderiza botón "Eliminar" + ConfirmDeleteDialog si `proveedor:delete`
4. Mutations con TanStack Query + sonner toast

### 6.2 ConfirmDeleteDialog (reutilizable)

```tsx
<ConfirmDeleteDialog
  trigger={<Button variant="destructive"><Trash2/> Eliminar</Button>}
  title="¿Eliminar proveedor?"
  description="Esta acción marca el proveedor como inactivo. Los datos quedan en histórico."
  onConfirm={() => deleteMutation.mutateAsync()}
/>
```

Internamente usa `@radix-ui/react-alert-dialog` con styling Apple:
- Overlay: `bg-ink-900/40 backdrop-blur-sm`
- Content: `rounded-2xl shadow-card-hover ring-1 ring-hairline`
- Animations: `data-[state=open]:animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200 ease-apple`
- Icon de warning en círculo `bg-negative/10 text-negative`

### 6.3 Edit form pattern

```
app/(app)/proveedores/[id]/editar/page.tsx (server)
  ↓ pre-fetch via serverApiGet
  ↓ pasa a client form
components/proveedores/ProveedorEditForm.tsx (client)
  - useState con initialData
  - form ↔ state
  - submit → apiClient.patch(`/proveedores/${id}`, dirtyFields)
  - solo enviar dirty fields (compara contra initialData)
  - on success → toast + router.push(`/proveedores/${id}`)
```

### 6.4 Mark F29 paid pattern

Botón "✓ Marcar pagado" en fila de F29 → abre `MarkPaidDialog`:

```
Dialog content:
  - Título: "Marcar F29 como pagado"
  - Form:
    - Fecha de pago (date input, default today)
    - URL del comprobante (text, opcional)
  - [Cancelar] [Confirmar pago]
  
Submit:
  apiClient.patch(`/f29/${id}`, { 
    estado: "pagado", 
    fecha_pago, 
    comprobante_url 
  })
```

### 6.5 PDF generation pattern

```tsx
// components/reportes/FondoReportView.tsx
"use client";
import dynamic from "next/dynamic";

const PDFDownloadButton = dynamic(
  () => import("./PDFDownloadButton"),
  { ssr: false, loading: () => <Skeleton className="h-9 w-32" /> }
);

export function FondoReportView({ data }) {
  return (
    <>
      <ReportePreview data={data} />  {/* HTML preview */}
      <PDFDownloadButton data={data} />  {/* lazy-loaded */}
    </>
  );
}

// PDFDownloadButton.tsx
"use client";
import { PDFDownloadLink } from "@react-pdf/renderer";
import { FondoPDF } from "./pdf/FondoPDF";

export default function PDFDownloadButton({ data }) {
  return (
    <PDFDownloadLink document={<FondoPDF data={data} />} fileName="estado-fondo.pdf">
      {({ loading }) => loading ? "Generando..." : "Descargar PDF"}
    </PDFDownloadLink>
  );
}
```

### 6.6 Optimistic delete

```tsx
const deleteMutation = useMutation({
  mutationFn: (id: number) => apiClient.delete(`/proveedores/${id}`, session),
  onMutate: async (id) => {
    await qc.cancelQueries({ queryKey: ["proveedores"] });
    const prev = qc.getQueryData<Page<Proveedor>>(["proveedores"]);
    if (prev) {
      qc.setQueryData(["proveedores"], {
        ...prev,
        items: prev.items.filter(p => p.proveedor_id !== id),
        total: prev.total - 1,
      });
    }
    return { prev };
  },
  onError: (_, __, ctx) => {
    if (ctx?.prev) qc.setQueryData(["proveedores"], ctx.prev);
    toast.error("No se pudo eliminar");
  },
  onSuccess: () => toast.success("Proveedor eliminado"),
  onSettled: () => qc.invalidateQueries({ queryKey: ["proveedores"] }),
});
```

---

## 7. Apple PDF design system

### Tipografía
- Fuente: **Inter** (registrada via Font.register, fallback de SF Pro que no es libre)
- Sizes: title 24pt, h2 16pt, body 10pt, caption 8pt

### Layout
- Page size: A4
- Margins: 48pt (consistente)
- Header en cada página: brand "Cehta Capital" 14pt + título 12pt + page X/Y a la derecha
- Footer: "Cehta Capital — Confidencial · No distribuir · Generado dd/mm/yyyy"

### Colors
```ts
PDF_COLORS = {
  ink: { 900: "#1d1d1f", 700: "#424245", 500: "#6e6e73", 300: "#a1a1a6" },
  cehtaGreen: "#1d6f42",
  positive: "#34c759",
  negative: "#ff3b30",
  hairline: "#e5e5e7",
  surfaceMuted: "#f5f5f7",
}
```

### Componentes
- `<KpiBlock>` — value grande + label uppercase
- `<TableSimple>` — header gris + rows con `borderBottomColor: hairline`
- `<SectionHeader>` — `borderBottom + paddingBottom + marginBottom`
- `<Footer>` — fixed en bottom de cada Page

---

## 8. Wireframes V2

### `/proveedores/[id]` (post-V2)
```
┌─ Header ──────────────────────────────────────────┐
│  ← Volver a proveedores                            │
│                                                    │
│  Razón Social SpA                                  │
│  RUT 76.123.456-7                                  │
│                          [Editar] [Eliminar]      │
└────────────────────────────────────────────────────┘
[Datos generales — Surface]
[Datos bancarios — Surface]
Footer: timestamps
```

### `/admin` (landing)
```
┌─ Header ──────────────────────────────────────────┐
│  Administración                                   │
│  Auditoría, calidad de datos y usuarios           │
└────────────────────────────────────────────────────┘
┌─ Grid 3-col ──────────────────────────────────────┐
│ ┌─ ETL Runs ──┐ ┌─ Data Quality ─┐ ┌─ Usuarios ──┐│
│ │ Database⚡   │ │ Shield🛡       │ │ UserCog⚙    ││
│ │ 24 runs/24h │ │ 3 issues       │ │ 5 users     ││
│ │ último: ✓   │ │ 1 high         │ │             ││
│ │ [Ver →]     │ │ [Ver →]        │ │ [Ver →]     ││
│ └─────────────┘ └────────────────┘ └─────────────┘│
└────────────────────────────────────────────────────┘
```

### `/reportes` (landing)
```
┌─ Header ──────────────────────────────────────────┐
│  Reportes                                          │
│  Genera reportes formales para inversionistas...   │
└────────────────────────────────────────────────────┘
┌─ Grid 2x2 ────────────────────────────────────────┐
│ ┌─ TrendingUp Estado del Fondo ──────┐            │
│ │ AUM consolidado, NAV, último ETL    │            │
│ │ [Generar →]                          │            │
│ └──────────────────────────────────────┘            │
│ ┌─ PieChart Composición del Portafolio ─┐          │
│ │ Distribución entre las 9 empresas      │          │
│ │ [Generar →]                            │          │
│ └────────────────────────────────────────┘          │
│ ... etc                                            │
└────────────────────────────────────────────────────┘
```

---

## 9. Cómo usar la plataforma post-V2 (Nicolas)

### Crear un nuevo proveedor
1. Sidebar → **Proveedores** → click **+ Nuevo proveedor**
2. Completar form (RUT validado en backend con dígito verificador)
3. **Guardar** → redirect a lista. Toast verde "Proveedor creado".

### Editar un proveedor
1. Click "Ver detalle" en la lista
2. Click **Editar** (top-right)
3. Modificar campos → **Guardar cambios**
4. Toast verde + redirect al detalle.

### Eliminar un proveedor (solo admin)
1. Detalle del proveedor
2. Click **Eliminar** (rojo)
3. Modal: "¿Eliminar proveedor X?"
4. Click confirmar → soft delete (queda inactivo, OCs históricas se preservan)

### Marcar F29 como pagado
1. Sidebar → **F29 / Tributario**
2. En la fila correspondiente, click **✓ Marcar pagado**
3. Modal: ingresar fecha de pago + URL comprobante
4. Confirmar → estado pasa a "pagado".

### Generar reporte para inversionistas
1. Sidebar → **Reportes**
2. Elegí tipo (Estado del Fondo, Portafolio, Suscripciones, Tributario)
3. Aplicar filtros (período, empresa)
4. Preview en pantalla (verifica datos)
5. Click **📥 Descargar PDF** → el archivo se genera y descarga
6. Compartí con LPs / comité por email

### Ver runs del ETL
1. Sidebar → **Admin** (solo admin puede ver)
2. **ETL Runs** → tabla histórica
3. Click row → drilldown con rejected rows si hubo
4. Si último run falló → ir a `/admin/data-quality` para ver issues

### Asignar rol a un usuario
1. Pre-requisito: el usuario debe existir en Supabase Auth (crear en Supabase Dashboard → Authentication → Users)
2. Sidebar → **Admin** → **Usuarios**
3. Click **+ Invitar usuario**
4. Email + rol → **Confirmar**
5. Toast verde → el usuario al loguear tendrá ese rol.

### Cambiar rol de un usuario
1. Admin → Usuarios → fila del usuario
2. Click el dropdown de rol → seleccionar nuevo
3. Confirmar.
   - Nota: el cambio se refleja en el JWT del usuario en su PRÓXIMO login (los tokens actuales son válidos hasta 1h por default).

---

## 10. Roadmap futuro (Post-V2)

### V3 — Workflow & automation
- [ ] Solicitudes de pago multi-step approval (workflow con estados)
- [ ] Email notifications (Resend / Postmark)
- [ ] Reportes programados (cron → email PDF a LPs)
- [ ] Dropbox OAuth real (refresh token persistido) para sync directo
- [ ] Bulk actions (eliminar múltiples, exportar lista)

### V4 — Analytics & Forecasting
- [ ] Forecasting de cashflow (modelo simple ARIMA o Prophet)
- [ ] Alertas inteligentes (saldo bajo proyectado, OC sospechosa)
- [ ] Reportes parametrizables (drag&drop builder simple)

### V5 — Compliance avanzado
- [ ] Cifrado en reposo de cuentas bancarias (pgcrypto)
- [ ] Audit log per-action (no solo ETL)
- [ ] Export para SII (formato CSV oficial)

---

## 11. Recursos relacionados

- `docs/RUNBOOK.md` — deploy zero to prod
- `docs/rotacion-credenciales.md` — rotación de credenciales
- `docs/sentry-setup.md` — observabilidad
- `docs/SECURITY.md` — modelo de amenazas
- `docs/THREAT_MODEL.md`
- `e2e/README.md` — E2E tests setup

## 12. Soporte

Si algo no funciona post-V2:
1. Capturar el error exacto + URL + qué hacías
2. `fly logs --app cehta-backend` últimas 50 líneas
3. Console del browser (F12 → Console tab)
4. Sentry dashboard (sentry.io) para stacktrace
5. Mandalo todo y te ayudo a debuggear.
