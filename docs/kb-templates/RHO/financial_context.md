# RHO Generación SpA — Financial Context

> Contexto financiero para AI Asistente, Informes LP y compliance.
> **Última actualización:** 2026-05-03 — base inicial. Requiere completar con datos del Brochure + Estados Financieros.
> **Fuentes:** Gantt master (REAL/PROYECTADO en CLP), DB de movimientos plataforma Cehta, documentos institucionales 15-04-2026.

---

## Estructura societaria

- **Razón social:** Rho Generación SpA
- **RUT:** 77.931.386-7
- **Tipo societario:** Sociedad por Acciones (SpA)
- **Sociedad constituida:** `[CONFIRMAR fecha en Copia de Inscripción.pdf]`
- **Capital suscrito:** `[CONFIRMAR en Certificado de Capital.pdf]`
- **Inscripción Conservador:** `[CONFIRMAR en Copia de Inscripción.pdf]`
- **Vigencia sociedad:** vigente al `[CONFIRMAR fecha emisión Vigencia Sociedad.pdf]`
- **Vigencia poderes:** vigente al `[CONFIRMAR Vigencia de Poder 17064671-1.pdf]`
- **RUT poder vigente:** 17.064.671-1 — `[CONFIRMAR nombre del apoderado]`

> 📂 Documentos institucionales en `03-Legal/Constitución Sociedad/` y `03-Legal/Poderes Notariales/`.

## Modelo de negocio

RHO genera **flujos de tres fuentes**:

1. **Venta de energía al SEN** — inyección al spot market vía CEN
2. **Servicios de almacenamiento (BESS)** — arbitraje horario + servicios complementarios
3. **PPA bilaterales** — `[CONFIRMAR si existen contratos firmados]`

### Estructura de costos típica (estimada del Gantt)

Del análisis de la columna `REAL` y `PROYECTADO` del Gantt master, los costos identificables en CLP:

- **Hitos pagados confirmados:** SAC RHO0001 = $1.005.238 CLP (caso de uso real)
- **OCs identificadas en Excel:** OC 0002 Bryan Escobedo + OC 0003 Carolina Mysle (referenciadas en observaciones)

> Para detalle de OCs y movimientos, consultar plataforma `/empresa/RHO/transacciones`.

## Compliance financiero

### F29 / IVA

- **Estado de declaraciones F29:** `[CONSULTAR /empresa/RHO/legal o /f29-tributario]`
- **Frecuencia esperada:** mensual
- **Repositorio Dropbox:** `01-Empresas/RHO/03-Legal/Declaraciones SII/F29/`

### F22 — Renta Anual

- **Última declaración:** `[CONFIRMAR año + estado]`
- **Repositorio:** `01-Empresas/RHO/03-Legal/Declaraciones SII/F22 (Renta Anual)/`

### Cartolas bancarias

- **Banco principal:** `[CONFIRMAR — probable Banco Estado o Santander, validar con la operativa]`
- **Frecuencia upload Dropbox:** mensual
- **Repositorio:** `01-Empresas/RHO/04-Financiero/Cartolas Bancarias/`

## Proyección financiera (placeholder — completar con Brochure)

### CAPEX

| Proyecto | CAPEX estimado (CLP) | Fase |
|---|---|---|
| RHO0001 Panimávida | `[CONFIRMAR Brief]` | desarrollo |
| RHO0002 La Ligua | `[CONFIRMAR Brief]` | desarrollo |
| RHO0003 Codegua | `[CONFIRMAR]` | desarrollo |
| ... 9 proyectos restantes | | |
| **Total CAPEX cartera** | `[CONFIRMAR Brochure]` | |

### Revenue proyectado

| Año | Revenue estimado | Notas |
|---|---|---|
| 2026 | `[CONFIRMAR]` | primer año comercial Panimávida |
| 2027 | `[CONFIRMAR]` | + La Ligua + Codegua online |
| 2028 | `[CONFIRMAR]` | full ramp-up cartera |
| 2030 | `[CONFIRMAR]` | steady state |

### Métricas de retorno

- **TIR proyectada (proyect-level):** `[CONFIRMAR Teaser]`
- **TIR proyectada (LP-level con apalancamiento):** `[CONFIRMAR Teaser]`
- **Payback estimado:** `[CONFIRMAR]`
- **Múltiplo MOIC esperado:** `[CONFIRMAR]`

## Movimientos en plataforma

> Consultar `/empresa/RHO/transacciones` y `/movimientos?empresa=RHO` para el detalle vivo.

- Total transacciones registradas: `[VIVO desde DB]`
- Conceptos más frecuentes: `[VIVO]`
- Banco principal de movimiento: `[VIVO]`

## Riesgos financieros conocidos

> Pull desde `core.riesgos` filtrado por empresa_codigo='RHO'.

- `[VIVO desde /empresa/RHO/avance tab Riesgos]`

## Hitos financieros del Gantt

> Cada hito con campo `REAL` o `PROYECTADO` poblado representa un compromiso de capital.

Top 3 categorías de gasto identificadas en el Gantt:

1. **Solicitud SAC** — pagos al SEC por aclaraciones técnicas
2. **Estudios de factibilidad** — consultorías de conexión
3. **Permisos y certificaciones** — municipales / ambientales

## Datos pendientes de confirmar

Bloque para que el GP/finance complete tras revisar documentos institucionales + brochure:

- `[CONFIRMAR]` Año fiscal de RHO
- `[CONFIRMAR]` Estructura accionaria pre-FIP CEHTA
- `[CONFIRMAR]` % de participación de FIP CEHTA en RHO
- `[CONFIRMAR]` Existencia de deuda bancaria estructurada
- `[CONFIRMAR]` Líneas de crédito comprometidas
- `[CONFIRMAR]` Programas CORFO / ANID en aplicación
- `[CONFIRMAR]` Auditor externo
- `[CONFIRMAR]` Política de distribución a LPs

---

**Notas para AI Asistente:**
- Cuando preguntan "¿cuánto factura RHO?" → responder con datos VIVOS de `/empresa/RHO/transacciones`, NO con números inventados.
- Cuando preguntan por proyecciones → citar este documento Y aclarar "datos al `[fecha update]`".
- Si el dato está marcado `[CONFIRMAR]` → responder "ese dato no está validado en el KB, te recomiendo consultar el Brochure o Estados Financieros".
