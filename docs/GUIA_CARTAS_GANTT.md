# 📊 Guía Cartas Gantt — Cómo actualizar el avance de proyectos

> **Para:** equipo Cehta Capital + responsables de cada empresa del portafolio
> **Plataforma:** sección Ejecutivo · Cartas Gantt + sección por empresa · Avance
> **Tiempo de lectura:** 8 minutos
> **Versión:** Abril 2026

---

## 🎯 ¿Qué son las Cartas Gantt en la plataforma?

Cada empresa del portafolio puede tener **proyectos** con su:
- **Fecha de inicio** y **fecha fin estimada**
- **Hitos** (milestones intermedios) con sus fechas planificadas
- **Riesgos** abiertos con severidad y mitigación
- **Progreso (%)** del proyecto
- **Estado**: planificado / en progreso / completado / pausado / cancelado

La plataforma renderea automáticamente un **Gantt visual** con la barra del proyecto y dots de cada hito en sus fechas.

---

## 🖥️ Dónde se ven las Cartas Gantt

### A) **Vista cross-empresa (CEO/Ejecutivo)**

**Sidebar → Ejecutivo → Cartas Gantt** (`/cartas-gantt`)

- Vista consolidada de las 9 empresas
- Header con KPIs agregados:
  - Total proyectos cross-portfolio
  - Hitos cumplidos / total
  - Riesgos abiertos
  - Avance promedio
- Cada empresa colapsable con sus proyectos
- Click en empresa → expande con sus Gantts y mini-KPIs
- Click en proyecto → "Ver detalle hitos" muestra cada milestone con fecha y estado
- Botón "Editar / Actualizar progreso" → te lleva a la sección de la empresa

### B) **Vista por empresa**

**Sidebar → Empresas → [EMPRESA] → Avance** (ej: `/empresa/CENERGY/avance`)

- Misma data pero solo de esa empresa
- Acá es donde **editás** todo: crear proyectos, agregar hitos, marcar riesgos
- Después de editar acá, los cambios aparecen en `/cartas-gantt` automáticamente

---

## 🛠️ Cómo crear un proyecto

### Paso 1: ir a la empresa correspondiente

`Sidebar → CENERGY (o la que sea) → Avance`

### Paso 2: click en "Nuevo proyecto"

Se abre un dialog con:

| Campo | Ejemplo | Obligatorio |
|---|---|---|
| **Nombre** | "Implementación Sistema ERP" | ✅ |
| **Descripción** | "Migración de Oracle a SAP S/4HANA" | recomendado |
| **Estado** | planificado / en progreso / completado / pausado / cancelado | ✅ |
| **Progreso %** | 0 inicialmente, vas subiendo a medida que avanzás | default: 0 |
| **Fecha inicio** | 2025-06-01 | ✅ |
| **Fecha fin estimada** | 2025-12-31 | ✅ |
| **Owner email** | persona responsable | recomendado |
| **Dropbox roadmap path** | enlace al roadmap detallado en Dropbox | opcional |

### Paso 3: agregar hitos

Una vez creado el proyecto, dentro del card del proyecto hay un botón **"+ Hito"**:

| Campo | Ejemplo |
|---|---|
| Nombre | "Kickoff con proveedor" |
| Descripción | "Reunión de inicio + firma del contrato" |
| Fecha planificada | 2025-06-15 |
| Estado | pendiente |
| Orden | 1 (van numerados) |
| Progreso % | 0 |
| Deliverable URL | (cuando se complete, link al docu) |

> 💡 **Tip:** los hitos aparecen como **dots** en la barra del Gantt, en sus fechas planificadas. Verde = completado, ámbar = en progreso, gris = pendiente.

### Paso 4: registrar riesgos

Botón **"+ Riesgo"** dentro del card:

| Campo | Ejemplo |
|---|---|
| Título | "Atraso en migración por integración con Nubox" |
| Descripción | "Si Nubox no responde antes del 30 julio, atrasa todo Q3" |
| Severidad | alta / media / baja |
| Probabilidad | alta / media / baja |
| Estado | abierto / mitigado / aceptado / cerrado |
| Owner email | quien hace el follow-up |
| Mitigación | "Plan B: contratar consultor que conozca API Nubox" |

---

## 🔄 Cómo actualizar la Gantt periódicamente

### Cadencia recomendada: **una vez por semana** (lunes 9am)

### Para cada proyecto en progreso:

#### 1. Actualizar el **progreso %** del proyecto

Edita el proyecto y subí el porcentaje según donde estés realmente:
- 0% — recién inicia
- 25% — primeros entregables visibles
- 50% — la mitad del trabajo concreto está hecho
- 75% — solo falta la fase final
- 100% — completado (cambia el estado también)

> ⚠️ **No mientas con el %**. El CEO va a ver un proyecto al 90% y va a creer que está casi terminado. Si en realidad el último 10% es el más difícil, marcá 70% o 75%.

#### 2. Marcar **hitos completados** que se hayan cumplido

Dentro del card del proyecto, en la lista de hitos, click en el hito → cambiar estado a "completado" y poner la **fecha real** de cumplimiento.

Esto:
- Pinta el dot del Gantt en verde
- Suma al contador "Hitos cumplidos / total"
- Mejora la métrica `pctHitos` del CEO Dashboard

#### 3. Actualizar **estado** de hitos en progreso

Si un hito **se atrasó**, no lo borrés ni le cambies la fecha. Mejor:
- Cambiá su estado a "en_progreso" (si ya empezó pero no terminó)
- Subí su progreso % (ej. "estamos al 60% del hito kickoff")
- Agregá una **nota** explicando el motivo del atraso (campo descripción)

Esto deja **trazabilidad** — el CEO puede ver el patrón de atrasos.

#### 4. Cerrar / abrir **riesgos**

- Si un riesgo se materializó: estado → "aceptado" (lo absorbiste) o creá un proyecto nuevo de mitigación
- Si se mitigó: estado → "mitigado" + fecha de cierre
- Si surge uno nuevo: agregalo cuanto antes con severidad realista

#### 5. Si un proyecto cambia drásticamente:

- **Re-estimar fechas:** editá `fecha_fin_estimada` con honestidad. Si pasás de "31 dic 2025" a "30 jun 2026", cambialo. La plataforma audita el cambio (`/admin/audit`).
- **Pausar:** estado → "pausado" si el proyecto se detiene por dependencias externas. Volvé a activarlo cuando se reactive.
- **Cancelar:** solo si realmente no se va a hacer. Quedá como histórico.

---

## 📈 KPIs que la plataforma calcula automáticamente

### Por proyecto (visible en cada card en `/cartas-gantt`):

| KPI | Cómo se calcula |
|---|---|
| **Avance %** | Lo que el responsable carga manualmente (campo `progreso_pct`) |
| **Hitos cumplidos** | Cuenta de hitos con `estado='completado'` / total hitos |
| **En progreso** | Cuenta de hitos `estado='en_progreso'` |
| **Pendientes** | Cuenta de hitos `estado='pendiente'` |
| **Riesgos** | Cuenta de riesgos con `estado='abierto'` |

### Cross-portfolio (header de `/cartas-gantt`):

| KPI | Cálculo |
|---|---|
| **Total proyectos** | Suma de proyectos de todas las empresas |
| **Empresas con proyectos** | Cuántas de las 9 tienen al menos 1 proyecto |
| **Hitos cumplidos** | Suma cross-empresa: `hitos_completados / hitos_totales` |
| **% del total** | Ratio del anterior — proxy del avance global del portfolio |
| **Riesgos abiertos** | Suma de todos los riesgos críticos del portfolio |
| **Avance promedio** | El % de hitos cumplidos como proxy del avance ponderado |

---

## 🎨 Cómo leer el Gantt visual

```
[Junio 2025] ──────────────── [Diciembre 2025]
═══════════════════════════                       (barra del proyecto, gris)
██████████████████                                 (% completado, verde)
        ●  ●  ◌      ◌                            (hitos: ● completado, ◌ pendiente)
```

- **Barra gris**: rango total del proyecto (fecha inicio → fecha fin)
- **Barra verde**: progreso actual (basado en `progreso_pct`)
- **Dot verde**: hito completado en su fecha
- **Dot ámbar**: hito en progreso
- **Dot gris**: hito pendiente
- **Dot rojo**: hito cancelado

> 🔍 **Hover sobre un dot** → tooltip con nombre + estado + fecha planificada.

---

## ⚙️ Casos prácticos

### Caso 1: "Acabamos de completar el hito 'Kickoff' del proyecto ERP de CENERGY"

1. Sidebar → CENERGY → Avance
2. Buscar proyecto "Implementación Sistema ERP" → expandir hitos
3. Click en hito "Kickoff" → editar
4. Estado: `completado` → fecha real cumplimiento: hoy
5. Guardar
6. Volver a `/cartas-gantt` y verificar que el dot está verde

### Caso 2: "El proyecto de migración de RHO se atrasa 1 mes"

1. Sidebar → RHO → Avance
2. Editar proyecto "Migración a Cloud"
3. Cambiar `fecha_fin_estimada` de `2025-12-31` a `2026-01-31`
4. En descripción, agregar nota: "Atraso por dependencia API banco"
5. Guardar
6. La plataforma audita automáticamente el cambio (`/admin/audit` muestra el diff)

### Caso 3: "Apareció un riesgo nuevo en TRONGKAI"

1. Sidebar → TRONGKAI → Avance
2. Card del proyecto correspondiente → "+ Riesgo"
3. Llenar todos los campos (severidad alta, probabilidad media)
4. Guardar
5. El KPI "Riesgos abiertos" del CEO Dashboard sube automáticamente

### Caso 4: "Quiero un snapshot semanal del avance del portfolio"

1. `/cartas-gantt` arriba a la derecha → "Expandir todo"
2. Print el navegador (Ctrl+P) o screenshot
3. Adjuntar al acta del Comité de Vigilancia o reporte semanal CEO
4. (Bonus: usar también `/portafolio` para los saldos USD/CLP/UF)

---

## 📋 Checklist de actualización semanal (lunes 9am)

```
[ ] Por cada empresa con proyectos en progreso:
    [ ] Revisé el progreso %, lo actualicé si cambió
    [ ] Marqué los hitos completados de la semana pasada
    [ ] Actualicé fechas de hitos atrasados
    [ ] Cerré riesgos mitigados
    [ ] Agregué riesgos nuevos detectados
[ ] Verifiqué KPIs en /cartas-gantt — los números cuadran con la realidad
[ ] Si hay un proyecto crítico — lo discuto en stand-up del lunes
[ ] Si hay riesgos altos abiertos — escalado al Comité
```

---

## 🆘 Errores comunes

| Error | Solución |
|---|---|
| El Gantt aparece con texto "Definí fecha de inicio y fecha fin estimada" | Editar el proyecto y agregar ambas fechas |
| Los hitos no aparecen como dots | Verificar que tengan `fecha_planificada` cargada |
| El % del proyecto no sube aunque haya hitos completados | El % es manual, no se calcula automático. Subí `progreso_pct` a mano |
| No veo proyectos de una empresa | Esa empresa todavía no tiene proyectos cargados — andá a su sección Avance y creá el primero |
| El estado "pausado" no se ve diferente al "en progreso" | En el card sí — el badge cambia a ámbar. En el Gantt visual no se diferencia (sigue siendo barra) |

---

## 🔗 Endpoints técnicos (para devs)

Para integraciones externas (Power BI, scripts), la API expone:

```bash
# Listar proyectos de una empresa
GET /api/v1/avance/CENERGY/proyectos
# Auth: Bearer JWT o cak_<token>

# Crear proyecto
POST /api/v1/avance/proyectos
# body: { empresa_codigo, nombre, descripcion, fecha_inicio, ... }

# Crear hito
POST /api/v1/avance/proyectos/{proyecto_id}/hitos
# body: { nombre, fecha_planificada, estado, ... }

# Actualizar hito
PATCH /api/v1/avance/hitos/{hito_id}
# body: { estado, fecha_completado, progreso_pct, ... }
```

Documentación interactiva completa en `/admin/api-docs` (filtrá por tag "avance").

---

## 📊 Reportes derivados

Una vez que el equipo carga las Cartas Gantt consistentemente, podés:

1. **CEO Weekly Digest** (`/admin/digest`) — incluye automáticamente:
   - Cantidad de hitos completados la semana pasada
   - Riesgos nuevos abiertos
   - Proyectos que cambiaron de estado

2. **Action Center** (`/action-center`) — muestra hitos próximos a vencer junto con F29 / OCs / contratos

3. **Audit log** (`/admin/audit`) — filtrar por entity_type=proyecto o hito para ver historial completo de cambios (quién cambió qué cuándo)

---

*Guía mantenida por Nicolás Rietta. Para preguntas o sugerencias de mejoras, mensaje directo o issue en el repo.*
