# RHO Generación SpA — Strategic Priorities

> Roadmap operativo y estratégico de RHO. Base para Outlook Section de Informes LP.
> **Última actualización:** 2026-05-03 — auto-generado desde Gantt importado.
> **Fuentes:** Plan de Trabajo BESS RHO (Gantt master), 12 proyectos en cartera, 1.434 hitos.

---

## Tesis estratégica de los próximos 24 meses

RHO ejecuta una **estrategia geográfica de portafolio diversificado**: 12 proyectos a lo largo de Chile (Panimávida → Ranguil) en distintas fases de desarrollo, con objetivo de **rotar capital eficientemente** entre fases.

Las prioridades son, en orden:

1. **Cierre comercial Panimávida (RHO0001)** — flagship que valida el modelo BESS
2. **Acceso abierto en pipeline avanzado** (RHO0002, RHO0003, RHO0008, RHO0009)
3. **Originación temprana** del resto de la cartera (RHO0004 Santa Victoria, RHO0005 Ruil, RHO0006 Chimbarongo, RHO0007 Molina, RHO0010 Ranguil)

## Cartera completa — los 12 proyectos

> Pull en vivo del Gantt master. Estados al 2026-05-03.

| Código | Nombre | Estado | Fase actual | Encargado |
|---|---|---|---|---|
| **RHO0001** | Panimávida (BESS RHO) | En curso | Solicitud Acceso Abierto + SAC pagado | Javier Álvarez |
| **RHO0002** | La Ligua (San Expedito) | En curso | SAA + creación usuario CEN | Javier Álvarez |
| **RHO0003** | Codegua (Explícito) | En curso | SAA + SAC | Javier Álvarez |
| **RHO0004** | Santa Victoria | No Aplica / Planificación | Pendiente kickoff | — |
| **RHO0005** | Ruil | No Aplica / Planificación | Pendiente kickoff | — |
| **RHO0006** | Chimbarongo | En curso | SAA inicial | Javier Álvarez |
| **RHO0007** | Molina | En curso | SAA inicial | Javier Álvarez |
| **RHO0008** | Agua Santa (San Expedito II) | En curso | SAA inicial | Javier Álvarez |
| **RHO0009** | Quebrada | En curso | `[CONFIRMAR fase]` | `[CONFIRMAR]` |
| **RHO0010** | Ranguil | En curso | `[CONFIRMAR fase]` | `[CONFIRMAR]` |
| **+2 adicionales** | `[CONFIRMAR en hoja Proyectos del Gantt]` | | | |

## Próximos 6 meses — hitos críticos

> Pull desde `core.hitos` con `fecha_planificada BETWEEN now() AND now()+6mo`, top 10 más relevantes.

Esta sección se completa **automáticamente** cuando el sistema `/avance/portfolio/upcoming-tasks` está vivo. Mientras tanto, top 5 hitos críticos identificados manualmente del Gantt:

| Mes objetivo | Hito | Proyecto | Encargado |
|---|---|---|---|
| `[VIVO]` | Cierre SAA RHO0001 → ingreso comercial | RHO0001 | Javier Álvarez |
| `[VIVO]` | SAC RHO0002 La Ligua | RHO0002 | Javier Álvarez |
| `[VIVO]` | Layout preliminar Codegua | RHO0003 | Diego (Desarrollo) |
| `[VIVO]` | Visita terreno LNG RHO0008 | RHO0008 | Javier Álvarez |
| `[VIVO]` | Kickoff Santa Victoria | RHO0004 | `[CONFIRMAR asignación]` |

## OKRs trimestrales

> Si existen, deberían estar en `01-Empresas/RHO/05-Proyectos & Avance/OKRs/`.

- `[FALTA: confirmar si RHO maneja OKRs trimestrales o solo Gantt]`

Estructura recomendada por trimestre:

```markdown
## Q2 2026
- O1: Lograr COD comercial de Panimávida
  - KR1: Inyección comercial al SEN antes de mayo
  - KR2: Generar 100 MWh primer mes operativo
  - KR3: Validar arbitraje BESS con 3 ciclos diarios
- O2: Avanzar 2 proyectos a etapa de SAC aprobada
  - KR1: SAC La Ligua aprobada
  - KR2: SAC Codegua submitted
- O3: Cerrar originación de 2 proyectos nuevos
```

## Riesgos estratégicos

> Pull desde `core.riesgos` filtrado por empresa_codigo='RHO'.

- `[VIVO desde /empresa/RHO/avance tab Riesgos]`

Riesgos arquetípicos del sector renovable chileno (para AI Asistente):

1. **Curtailment** (recorte de inyección por congestión SEN) — mitigable con BESS
2. **Demoras en aprobación CEN** — proyectos pueden esperar 6-18 meses
3. **Cambios regulatorios PMG / PMS** (precio nodo, distribución de costos)
4. **Cumplimiento ambiental** — DIA / EIA según escala
5. **Riesgo de contraparte** en PPA bilaterales si los hay

## Comparables del mercado (contexto para Informes LP)

Empresas comparables en Chile (BESS + renovables distribuidas):

- AES Andes (BESS de gran escala)
- Acciona (renovables + storage incipiente)
- Enel Green Power (utility-scale, no comparable directo)
- CMPC + Arauco (autogeneración industrial)
- **Diferenciación de RHO:** acceso abierto + portafolio mid-scale + foco BESS

> ⚠️ `[FALTA: confirmar comparables en Brochure]`. Si menciona competidores específicos, agregar.

## Pipeline de capital

- **Capital comprometido FIP:** `[CONFIRMAR aporte FIP CEHTA]`
- **Capital integrado a la fecha:** `[VIVO desde core.suscripciones_acciones]`
- **Capital pendiente para próximas etapas:** `[CONFIRMAR según Brochure]`
- **Necesidad capital próximos 12 meses:** `[CONFIRMAR]`

## Equipo objetivo (próximos 6 meses)

- `[CONFIRMAR si hay nuevas contrataciones planificadas]`

Roles típicos para escalar operación:

- Director Técnico
- Project Manager por región (Norte/Centro/Sur)
- Gerente Comercial (PPA bilaterales)
- Compliance Officer (DIA/EIA + cambios regulatorios)

## Datos pendientes de confirmar

- `[CONFIRMAR]` Quién es el GM de RHO operativamente (probable: Javier Álvarez por recurrencia en Gantt — confirmar con Organigrama_RHO_CORPORATIVO.pptx)
- `[CONFIRMAR]` MW totales del portafolio una vez COD-eado todo
- `[CONFIRMAR]` Plan B si el regulador rechaza un SAA importante
- `[CONFIRMAR]` Roadmap M&A — si hay intención de adquirir activos en operación

---

**Para AI Asistente:**
- Si te preguntan "¿qué proyectos viene haciendo RHO?" → responder con la tabla de cartera completa.
- Si preguntan "¿qué hito viene esta semana?" → llamar tool `query_upcoming_tasks` filtrado por RHO.
- Si preguntan por OKRs y este documento dice `[FALTA confirmar]` → responder "RHO trackea via Gantt master, OKRs formales no están registrados en el KB".
