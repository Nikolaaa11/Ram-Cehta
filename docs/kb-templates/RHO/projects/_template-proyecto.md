# {CODIGO} — {NOMBRE_COMERCIAL}

> Template para proyectos de RHO Generación. Copiar este archivo y reemplazar `{}` con datos reales.
> Cada proyecto debería tener su propio archivo en `08-AI Knowledge Base/projects/{CODIGO}.md`.

---

## Resumen ejecutivo

- **Código interno:** {CODIGO} (ej: RHO0002)
- **Nombre comercial:** {NOMBRE} (ej: La Ligua / San Expedito)
- **Tipo:** {TIPO} (BESS / Solar FV / Eólico / Híbrido)
- **Capacidad:** {MW} MW
- **Estado:** {ESTADO} (En curso / Completado / Pausado / Planificación)
- **Encargado:** {NOMBRE_PERSONA}
- **Cliente final:** {CLIENTE} (si aplica)

## Localización

- **Comuna:** {COMUNA}, Región {REGION}
- **Coordenadas:** {LAT, LON}
- **Punto de inyección SEN:** {SUBESTACION}
- **Distancia a línea de transmisión:** {KM}

## Arquitectura técnica

### Generación
- Capacidad nominal: {MW}
- Tecnología: {TECNOLOGIA}
- Hectáreas: {HA}
- Generación esperada anual: {MWH_AÑO}
- Factor de planta: {%}

### BESS (si aplica)
- Capacidad almacenamiento: {MWH}
- Horas de descarga: {HORAS}
- Tecnología batería: {TIPO}
- Ciclos diarios: {N}
- Vida útil: {AÑOS}
- Proveedor: {PROVEEDOR}
- EPC: {EPC}

## Modelo de negocio

### Fuentes revenue
1. {FUENTE_1} — {DESCRIPCION}
2. {FUENTE_2} — {DESCRIPCION}
3. {FUENTE_3} — {DESCRIPCION}

### Estructura financiera

| Variable | Valor |
|---|---|
| CAPEX total | {CLP} |
| OPEX anual | {CLP/año} |
| Revenue año 1 | {CLP} |
| Revenue estabilizado | {CLP} |
| TIR proyect-level | {%} |
| Payback | {años} |
| Apalancamiento | {%} |

## Timeline

### Fase 1 — Desarrollo (encargado: {ENCARGADO_F1})
- {HITO_1} — fecha objetivo {FECHA}
- {HITO_2} — {FECHA}

### Fase 2 — Construcción (encargado: {ENCARGADO_F2})
- {HITO_1} — {FECHA}
- {HITO_2} — {FECHA}

### Fase 3 — COD (encargado: {ENCARGADO_F3})
- 🎯 Fecha objetivo COD: {FECHA}
- Primera inyección comercial: {FECHA}

### Fase 4 — Operación
- Operación 24/7 a partir de {FECHA}

## Hitos cumplidos a la fecha

> Pull en vivo desde `core.hitos` para este proyecto_id.

- Completados: `[VIVO]`
- En progreso: `[VIVO]`
- Pendientes: `[VIVO]`
- Progreso global: `[VIVO]`

## Stakeholders

| Rol | Persona | Notas |
|---|---|---|
| {ROL_1} | {NOMBRE_1} | |
| {ROL_2} | {NOMBRE_2} | |

## ESG Impact

| Métrica | Valor | Equivalente |
|---|---|---|
| CO2 evitado/año | {TON} ton | {AUTOS} autos/año |
| Generación renovable | {MWH} MWh | {HOGARES} hogares CL |
| Empleos directos | {N} | construcción + operación |

## Riesgos

> Pull desde `core.riesgos` filtrado por proyecto_id.

- `[VIVO]`

Riesgos arquetípicos:
1. {RIESGO_1} — mitigación: {MITIGACION_1}
2. {RIESGO_2} — mitigación: {MITIGACION_2}

## Material de referencia

- 📊 Gantt detallado: hoja "{CODIGO} {NOMBRE}" en Plan de Trabajo BESS RHO
- 📊 Brief: `01-Empresas/RHO/05-Proyectos & Avance/Briefs/{CODIGO} {NOMBRE}/`

---

**Notas de uso:**
- Reemplazar TODAS las `{VARIABLES}` antes de subir a Dropbox
- Si un dato no se conoce, usar `[CONFIRMAR]` explícito (no inventar)
- Update periódico: cada vez que se cierra un hito relevante, actualizar la fase correspondiente
