---
name: ux-gerentes
description: Auditoría de UX de Ram-Cehta desde los ojos de cada perfil real — gerente general que firma, contador que concilia, operador que carga. Detecta fricción, confusión y features que nadie usa. Correr mensual o cuando haya quejas de usuarios.
---

# Skill: UX Gerentes y Usuarios

La plataforma sirve si **un gerente general no-técnico puede firmar un
voucher desde el celular en menos de 1 minuto sin preguntar cómo**. Esa es
la vara. Auditar desde los ojos de cada perfil, NO desde los del developer.

## Los 4 perfiles reales

| Perfil | Qué hace en la plataforma | Su pantalla típica | Su miedo |
|---|---|---|---|
| **Gerente General** (9 GGs) | Firma vouchers y OCs, mira su caja | Celular, 2 min entre reuniones | Firmar algo equivocado |
| **Contador/MCG** | Concilia, exporta a Nubox, F29 | Desktop, sesiones largas | Cuadres que no cuadran |
| **Operador (Nicolás)** | Carga OCs, vouchers, cartolas, persigue firmas | Desktop, todo el día | Que algo se trabe y no saber por qué |
| **Encargado de área** | Crea OCs de su área, ve su presupuesto | Mixto | Que su OC se pierda |

## Recorrido por perfil (con browser o capturas)

Para CADA perfil, ejecutar su flujo principal y anotar fricción:

### Gerente General (móvil 390px)
1. Llega email "tienes voucher por firmar" → ¿el link va DIRECTO al voucher?
2. ¿Ve monto, proveedor y respaldo (PDF) sin scroll infinito?
3. ¿El botón firmar es obvio y grande? ¿Confirmación clara post-firma?
4. ¿Cuántos taps desde email a firmado? (objetivo: ≤ 4)

### Contador
1. Conciliación: ¿cuántos clics para matchear 1 movimiento? ¿Sugerencias útiles?
2. Export Nubox CSV: ¿descarga limpia? ¿glosas completas?
3. ¿Los montos cuadran visualmente (totales en pantalla vs export)?

### Operador
1. Crear OC completa: ¿el autocomplete de proveedor funciona? ¿cuotas claras?
2. Subir cartola: ¿errores de parseo se explican en español claro?
3. ¿El Action Center muestra TODO lo pendiente sin buscar en 5 páginas?

### Encargado de área
1. ¿Ve SOLO su empresa/área (multi-tenant)?
2. ¿El estado de su OC es visible sin preguntar? (DRAFT/aprobada/pagada)

## Qué buscar (criterios)

- **Jerga técnica visible**: "EXECUTED", "payload", "null" → traducir
- **Mensajes de error crípticos**: todo error debe decir QUÉ pasó y QUÉ hacer
- **Datos vacíos sin explicación**: tabla vacía debe decir "Aún no hay X. Creá uno con el botón +"
- **Acciones sin confirmación**: anular/borrar requiere confirm con detalle
- **Acciones CON exceso de confirmación**: leer no debe pedir confirm
- **Features muertas**: revisar telemetría `feature_usage` —
  `SELECT feature, COUNT(*) FROM core.feature_usage WHERE used_at > NOW() - INTERVAL '30 days' GROUP BY feature ORDER BY 2 DESC;`
  → lo que nadie usó en 30 días es candidato a esconder o eliminar
- **Mobile**: tablas con scroll horizontal OK, inputs 16px (no zoom iOS),
  botones ≥ 44px

## Formato del reporte

```
# UX Audit — YYYY-MM-DD
## Por perfil
### Gerente General: X fricciones
| # | Pantalla | Fricción | Severidad | Fix |
...
## Features sin uso (30 días): [lista]
## Quick wins de UX (hacer ya): [≤5 ítems, máx 30 min c/u]
```

Implementar los quick wins en la misma sesión. Lo demás → BACKLOG.md.
Validar con `debug-continuo` capas 1-3 después de cambios.
