# Bloque E · Subsidio CORFO REVTECH/TRONGKAI

> Estado de la implementación post-reunión Claudia (mayo 2026).
> Cubre Ajustes E1–E9 del `prompt_v2_voucher_claudia.md`. E10 (SUM/E/SE) queda pendiente de definición.

---

## 1. Resumen ejecutivo

CORFO asignó **$3.000.000.000** a un proyecto compartido entre **REVTECH** y **TRONGKAI** como coejecutores. Cada empresa ejecuta su parte y rinde sus gastos al pozo del subsidio. La plataforma permite:

- ✅ Cargar el subsidio + 2 proyectos coejecutores con sus % default y cuentas contables
- ✅ Crear vouchers con reparto **CORFO / P-tec / Empresa directa** por línea
- ✅ Bifurcación F.A: *"¿Asignás a financiamiento subsidiado?"* Sí/No
- ✅ Regla bloqueante: el IVA **siempre** va a cuenta corporativa, **nunca** al pozo CORFO
- ✅ Dashboard de ejecución con desglose por empresa coejecutora
- ✅ Validación pre-submit (frontend) + bloqueo backend al firmar

---

## 2. Datos cargados en producción

### Subsidio

| Campo | Valor |
|---|---|
| Código | `CORFO-2026-REVTECH-TRONGKAI` |
| Programa | CORFO |
| Monto total | $3.000.000.000 CLP |
| Vigencia | 2026-01-01 → 2027-12-31 |
| Estado | ACTIVO |

### Proyectos coejecutores

| Código | Empresa | Presupuesto | Reparto default |
|---|---|---|---|
| `PRJ-REVTECH-COR-001` | REVTECH | $1.500.000.000 | 50% CORFO / 20% P-tec / 30% Empresa |
| `PRJ-TRONGKAI-COR-001` | TRONGKAI | $1.500.000.000 | 50% CORFO / 20% P-tec / 30% Empresa |

### Cuentas contables configuradas

| Fuente | Cuenta destino |
|---|---|
| CORFO subsidio | `4102-01` (gasto operacional) |
| P-tec CEHTA Capital | `4102-01` (mismo gasto, marcado por fuente) |
| Empresa directa | `4102-01` |
| IVA corporativo | `1170-01` (IVA crédito fiscal) |

---

## 3. Flow operativo para el operador

### A. Crear un voucher CORFO

**Opción 1 — Form Nubox** (`/vouchers/nubox`):
1. Elegí empresa **REVTECH** o **TRONGKAI** → aparece banner verde + columna **"Fuente $"**
2. En cada línea de *Información Contable* + *Financiera*, seleccioná la fuente:
   - `CORFO (subsidio)` — para gastos elegibles que cargan al pozo
   - `P-tec (CEHTA Capital)` — aporte pecuniario empresarial
   - `Empresa directa` — gasto 100% empresa, fuera del subsidio
   - `IVA corporativo` — obligatorio para la línea de IVA
3. Guardar → DRAFT

**Opción 2 — Form CORFO** (`/vouchers/corfo`):
1. Form dedicado solo a REVTECH/TRONGKAI
2. Ingresás neto + tipo doc + proyecto
3. Si F.A → pregunta "¿Asignás a financiamiento?" Sí/No
4. Editor de % (CORFO/P-tec/Empresa) con default del proyecto
5. Preview de las N líneas generadas + IVA corporativo
6. Crear → DRAFT

### B. Subir factura adjunta
Card *Adjuntos* en el detalle del voucher:
- Tipo COMPRA/VENTA → exige al menos 1 adjunto factura/boleta
- Tipo Invoice (importación) → checklist 3 docs: Invoice + DIN + Factura Importación

### C. Enviar a aprobación
Botón *"Enviar a aprobación"* → si todo OK pasa a **PENDING**.
La validación E8 bloqueante corre acá: si una línea CORFO_SUBSIDIO tiene cuenta IVA, rechaza con error claro.

### D. 2 firmas en `/aprobaciones`
1. **GG titular** firma (`btoro@cenergy.cl` global, o titular dedicado por empresa: REVTECH=`camilo@revtech.cl`, TRONGKAI=`jocuevas@trongkai.com`)
2. **DIRECTOR** firma (`grietta@cehtacapital.com` o backup `contactocehta@gmail.com`)
3. Tras 2da firma → **APPROVED**

### E. Pagar en `/transferencias`
- Voucher aparece en el listado
- Tildás los del día → click *"Descargar Excel transferencia masiva"*
- Cargás el XLSX al banco
- Volvés y click *"Marcar EXECUTED"* → cierra el loop

---

## 4. Reportería · "dónde están las platas"

### Dashboard subsidio (`/admin/subsidios/CORFO-2026-REVTECH-TRONGKAI`)

Muestra:
- **4 KPIs**: Monto total · Presupuesto asignado · Ejecutado · Disponible
- **Barra de progreso global** con % ejecutado
- **Card por coejecutor** (REVTECH y TRONGKAI):
  - Presupuesto vs Ejecutado (barra)
  - Disponible
  - Desglose CORFO / P-tec / Empresa
  - Cantidad vouchers ejecutados
  - Lista de proyectos asociados
- **Ejecución total por fuente** (barras horizontales): cuánto del total ejecutado va a cada fuente

### Health check (`/admin/system-status`)

Vista global:
- Bandeja personal del operador (4 KPIs)
- Subsidios activos (cards con link)
- Proyectos contables (configurados vs incompletos)
- Lista de proyectos con config Bloque E incompleta + link directo a editar

### Listado proyectos (`/admin/proyectos`)

- Filtro por empresa
- Card por proyecto con badge **Configurado** (verde) o **Incompleto** (amber)
- Reparto / presupuesto / vigencia visibles sin abrir el detalle
- Click → editar `% y cuentas` desde la UI sin SQL

---

## 5. Reglas bloqueantes (no negociables)

| # | Regla | Dónde se valida |
|---|---|---|
| E3 | Suma de % CORFO + P-tec + Empresa = 100 exacto | CHECK constraint DB + UI live |
| E8 | IVA crédito fiscal **NUNCA** a fuente CORFO_SUBSIDIO | Frontend pre-submit + backend `/submit` |
| Anti-doble-firma | Un mismo usuario no puede firmar 2 pasos del mismo voucher | Backend `/approve` |
| 2 firmas siempre | GG (paso 1) + DIRECTOR (paso 2), en ese orden | Backend `/approve` |
| Adjunto COMPRA/VENTA | Voucher COMPRA o VENTA requiere ≥1 factura/boleta antes de aprobar | Backend `/submit` |
| Invoice 3 docs | Si tipo doc = INVOICE, el operador debe subir Invoice + DIN + Factura Importación | UI checklist visual (soft warn) |

---

## 6. Usuarios autorizados a firmar

| Email | Rol | Empresa(s) |
|---|---|---|
| `grietta@cehtacapital.com` | **DIRECTOR** | 10/10 (titular) |
| `contactocehta@gmail.com` | **DIRECTOR** | 10/10 (backup) |
| `btoro@cenergy.cl` | **GG** | 10/10 (fallback global) |
| `camilo@revtech.cl` | **GG titular** | REVTECH |
| `jocuevas@trongkai.com` | **GG titular** | TRONGKAI |

> Ver `docs/validacion_vouchers_cuentas.md` para detalle por empresa.

---

## 7. Pendientes (no implementados aún)

| Item | Por qué pendiente |
|---|---|
| **Sub-componentes SUM/E/SE** | Claudia debe definir si son etapas / rubros elegibles / hitos |
| **Bloque A — RR.HH. multi-fuente** | Necesita plantillas de distribución por trabajador definidas + tabla empleados con grado/RUT |
| **Bloque C — Viáticos** | Pre-requisito: política formal de viáticos firmada |
| **Bloque G — Ingresos por proyecto** | Pendiente confirmar política contable (cuotas subsidio: ingreso o disminución pasivo) |
| **Códigos Claudia** | Pre-requisito: listado de códigos + mapeo a cuentas |

---

## 8. Rounds técnicos relacionados

| Round | Foco | Estado |
|---|---|---|
| 80 | Invoice + ciclo importación (3 docs) | ✅ producción |
| 81 | Modelo de datos Bloque E (migración 0066) | ✅ producción |
| 82 | UX firma vouchers (lista de firmantes autorizados) | ✅ producción |
| 83 | Subsidio CORFO real $3.000MM + 2 proyectos seed | ✅ producción |
| 84 | Idempotencia POST /approve (doble-click safe) | ✅ producción |
| 85 | Form `/vouchers/corfo` dedicado | ✅ producción |
| 86 | CORS regex fix (multi-URL Vercel) | ✅ producción |
| 87 | Banner + columna Fuente en `/vouchers/nubox` | ✅ producción |
| 88 | Fix ESLint que bloqueaba builds Vercel | ✅ producción |
| 89 | Dashboard subsidio "dónde están las platas" | ✅ producción |
| 90 | Validación E8 IVA-no-CORFO en frontend | ✅ producción |
| 91 | UI admin para editar proyecto sin SQL | ✅ producción |
| 92 | Listado `/admin/proyectos` con badges | ✅ producción |
| 93 | `/admin/system-status` health check global | ✅ producción |
| 94-100 | Polish visual hero pattern (7 pantallas) + HeroBanner component | ✅ producción |
| 101 | Este documento | ✅ doc |
| 102 | 58 proyectos del Excel `centros_costo_consolidado` + UI nuevo proyecto + selector Proyecto en `/vouchers/nubox` | ✅ producción |
| 103 | Planilla transferencia formato **Banco Santander** (13 columnas) + selector UI GENERICO/SANTANDER | ✅ producción |
| 104 | Columna **Proyecto** en lista `/vouchers` (proyecto dominante de la primera línea) | ✅ producción |
| 105 | Fix SSE: detección client-side de JWT expirado antes de reconectar (elimina spam 401 en logs Fly) | ✅ producción |

---

*Última actualización: 18/05/2026 · Cehta Capital · FIP CEHTA ESG*
