# RHO0001 — Panimávida (BESS RHO)

> Brief técnico-comercial del proyecto flagship de RHO Generación.
> **Última actualización:** 2026-05-03 — auto-generado desde Gantt + estructura para completar con `Brief - Panimávida.pptx`.

---

## Resumen ejecutivo

- **Código interno:** RHO0001
- **Nombre comercial:** Panimávida
- **Tipo:** BESS (Battery Energy Storage System)
- **Capacidad de desarrollo:** **3 MW** *(según Gantt — `[CONFIRMAR vs Brief - Panimávida.pptx`)*
- **Estado:** En curso
- **Encargado:** Javier Álvarez (Acceso Abierto)
- **Cliente final:** `[CONFIRMAR en Brief]`

> Este proyecto es la **prueba de concepto del modelo BESS** de RHO. Su validación habilita el resto del pipeline.

## Localización

- **Comuna:** Panimávida (Región del Maule)
- **Coordenadas:** `[CONFIRMAR — solicitar a Brief o capa GIS]`
- **Punto de inyección SEN:** `[CONFIRMAR subestación de conexión]`
- **Distancia a línea de transmisión:** `[CONFIRMAR]`

## Arquitectura técnica

### Generación

- **Capacidad nominal:** 3 MW *(según Gantt master)*
- **Tecnología generación:** `[CONFIRMAR — solar fotovoltaico / eólico / híbrido]`
- **Hectáreas de terreno:** `[CONFIRMAR Brief]`
- **Generación esperada anual:** `[CONFIRMAR MWh/año]`
- **Factor de planta esperado:** `[CONFIRMAR %]`

### BESS

- **Capacidad de almacenamiento:** `[CONFIRMAR MWh / hora de descarga]`
- **Tecnología batería:** `[CONFIRMAR — probable Li-ion]`
- **Ciclos diarios objetivo:** `[CONFIRMAR — típicamente 1 a 2]`
- **Vida útil estimada:** `[CONFIRMAR — típica 10-15 años]`
- **Proveedor de baterías:** `[CONFIRMAR Brief]`
- **EPC / integrador:** `[CONFIRMAR Brief]`

## Modelo de negocio

### Fuentes de revenue (esperadas)

1. **Inyección spot al SEN** — venta horaria a CEN
2. **Servicios complementarios** — control de frecuencia, reservas, etc. (si aplica)
3. **PPA bilateral** — `[CONFIRMAR si existe contrato]`

### Estructura financiera del proyecto

| Variable | Valor |
|---|---|
| CAPEX total | `[CONFIRMAR Brief]` |
| OPEX anual estimado | `[CONFIRMAR]` |
| Revenue año 1 | `[CONFIRMAR]` |
| Revenue año estabilizado | `[CONFIRMAR]` |
| TIR proyect-level | `[CONFIRMAR]` |
| Payback simple | `[CONFIRMAR]` |
| Apalancamiento (deuda/capital) | `[CONFIRMAR si hay financiamiento bancario]` |

## Timeline — fases del proyecto

> Construido del Gantt master + hoja `RHO0001 Panimávida` (35 columnas + 976 filas detalladas).

### Fase 1 — Acceso Abierto + permisos (en curso)

- ✓ **DESARROLLO PROYECTO 3MW** (referencia top-level)
- ⏳ **Solicitud de Acceso Abierto** — encargado Javier Álvarez, fecha objetivo 2025-10-16
- ✓ **SAC** — Solicitud Aclaraciones submitted, **REAL pagado: $1.005.238 CLP**
  - Observación del Gantt: "OC 0002 Bryan Escobedo - OC 0003 Carolina Mysle"
- ⏳ Creación usuario CEN → ingreso solicitud
- ⏳ Layout preliminar y generación estimada
- ⏳ Títulos / dominio vigente del terreno

### Fase 2 — Construcción

- ⏳ Construcción civil
- ⏳ Instalación BESS + electromecánica
- ⏳ Pruebas de puesta en marcha
- ⏳ Conexión al SEN

### Fase 3 — Operación comercial (COD)

- 🎯 **Fecha objetivo COD:** `[CONFIRMAR Brief]`
- ⏳ Primera inyección comercial al SEN
- ⏳ Validación de arbitraje horario BESS
- ⏳ Reporte primer mes operativo

### Fase 4 — Operación + monitoreo (steady state)

- Operación 24/7
- Reporte mensual al directorio
- Mantenimiento preventivo BESS

## Hitos cumplidos a la fecha (extraídos del Gantt)

> Conteo de la columna Estado del Gantt master para RHO0001:

- **Hitos completados:** `[VIVO desde core.hitos donde proyecto_id = RHO0001 AND estado = 'completado']`
- **Hitos en progreso:** `[VIVO]`
- **Hitos pendientes:** `[VIVO]`
- **Progreso global:** `[VIVO desde core.proyectos_empresa]`

## Stakeholders

| Rol | Persona | Notas |
|---|---|---|
| Líder Acceso Abierto | Javier Álvarez | Recurrente en todos los hitos del proyecto |
| Layout / Desarrollo | Diego (apellido `[CONFIRMAR]`) | Apoyo para factibilidad |
| Generación estimada | Daniela (apellido `[CONFIRMAR]`) | Apoyo cálculo Layout |
| Legal / Títulos | Yadi (apellido `[CONFIRMAR]`) | Dominio vigente |
| EPC | `[CONFIRMAR Brief]` | |
| Cliente final | `[CONFIRMAR Brief]` | |

## ESG Impact (estimado)

> Datos a confirmar con Brief — para sección ESG de Informes LP.

| Métrica | Estimación | Equivalente concreto |
|---|---|---|
| CO2 evitado anual | `[CONFIRMAR ton/año]` | `[autos equivalentes/año]` |
| Generación renovable | `[CONFIRMAR MWh/año]` | `[hogares chilenos equivalentes]` |
| Empleos directos creados | `[CONFIRMAR]` | construcción + operación |
| Empleos indirectos | `[CONFIRMAR]` | proveedores locales |
| Comunidad impactada | Panimávida (comuna ~5K habitantes) | RSE local `[CONFIRMAR programas]` |

> Para cálculos: factor de emisión grid CL ≈ 0.40 ton CO2/MWh (CDE Chile 2024). 1 ton CO2 ≈ 0.21 autos/año (IPCC).

## Riesgos identificados

> Pull desde `core.riesgos` filtrado por proyecto_id de RHO0001.

- `[VIVO desde /empresa/RHO/avance tab Riesgos]`

Riesgos típicos del proyecto (para AI Asistente):

1. **Demora en aprobación CEN** — mitigación: estrategia SAA temprana
2. **Curtailment** — mitigación: BESS para arbitraje horario
3. **Costo de batería volátil** — mitigación: lock-in con proveedor antes de COD
4. **Gestión de derechos de paso** — mitigación: legal proactivo (Yadi)

## Material de referencia

- 📊 **Gantt detallado:** hoja "RHO0001 Panimávida" del Plan de Trabajo BESS RHO
- 📊 **Brief - Panimávida.pptx** — `01-Empresas/RHO/05-Proyectos & Avance/Briefs/RHO0001 Panimávida/`
- 📁 **Carpeta Dropbox:** `01-Empresas/RHO/05-Proyectos & Avance/`

---

**Para AI Asistente — guía de respuestas:**
- "¿Cómo va Panimávida?" → consultar `core.proyectos_empresa` por progreso_pct + mencionar el último hito completado
- "¿Cuándo se inaugura?" → si fecha COD está confirmada, citar; si no, "fecha estimada COD aún en validación, pull al GP"
- "¿Cuántos MW?" → 3 MW (según Gantt — pero validar contra Brief si hay actualización)
- Cualquier dato `[CONFIRMAR]` no contestar como certeza — sugerir consultar el Brief
