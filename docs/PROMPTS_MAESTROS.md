# PROMPTS MAESTROS — Ram-Cehta · FIP CEHTA ESG

> **Qué es esto**: Tu caja de herramientas de prompts para operar y mejorar
> la plataforma con Claude. Cada prompt se copia y pega tal cual en Claude
> Code. Las "skills" (`.claude/skills/`) se activan solas cuando el prompt
> las menciona.
>
> **Cómo se usa**: abrí Claude Code en la carpeta `Ram-Cehta`, copiá el
> prompt que corresponda al día, pegá, Enter. Nada más.
>
> **Última actualización**: 2026-06-10 · Round 152IIIIII

---

## 🚀 EL SÚPER PROMPT — Mejora total de la plataforma

Usalo cuando tengas una sesión larga (1-3 horas) y quieras que Claude
trabaje a fondo. Es el prompt "dejá todo full":

```
Soy Nicolás Rietta, opero Ram-Cehta (FIP CEHTA ESG). Lee primero
docs/SUPER_PROMPT_MAESTRO.md (22 invariantes NO negociables) y
docs/BACKLOG.md.

MISIÓN DE HOY: mejora integral de la plataforma. Trabajá como tech lead
senior con agentes en paralelo. No estimes en tokens — gastá lo necesario.

ORDEN DE TRABAJO:
1. Corré la skill debug-continuo completa (7 capas). Arreglá todo lo que
   falle.
2. Corré la skill auditor-plataforma (8 dimensiones en paralelo, con
   verificación adversarial de hallazgos). Arreglá los críticos.
3. Corré la skill performance-scan. Implementá los quick wins de impacto
   alto/esfuerzo bajo.
4. Corré la skill ux-gerentes para 1 perfil (rotá: GG → contador →
   operador → encargado). Implementá los quick wins.
5. Revisá docs/BACKLOG.md: tomá los 3 ítems H de mayor valor y hacelos.
6. Validación final: skill debug-continuo capas 1-3 (sintaxis + import
   523 rutas/431 paths + build frontend). TODO verde antes de terminar.
7. Actualizá docs/BACKLOG.md (sacá lo hecho, agregá lo encontrado) y dame
   el resumen: qué arreglaste, qué mejoró, qué queda, y el comando exacto
   de deploy.

REGLAS:
- NUNCA violar un invariante del SUPER_PROMPT_MAESTRO.
- NUNCA tocar datos de producción sin avisarme.
- Modelo IA de la plataforma: Sonnet (no cambiar a Haiku).
- Si algo necesita una decisión mía (borrar algo, gastar plata, tocar
  producción), preguntame ANTES.
```

---

## 🔍 PROMPT DIARIO — Debug matinal (10-15 min)

Para empezar el día sabiendo que todo está sano:

```
Soy Nicolás. Corré la skill debug-continuo completa sobre Ram-Cehta.
Arreglá automáticamente lo que sea seguro arreglar (sintaxis, imports,
bugs obvios). Lo que requiera decisión, listámelo. Terminá con la tabla
de 7 capas y decime en una línea: ¿la plataforma está sana hoy?
```

---

## 🕵️ PROMPT SEMANAL — Auditoría completa (lunes, 30-60 min)

```
Soy Nicolás. Corré la skill auditor-plataforma completa: 8 agentes en
paralelo, verificación adversarial de cada hallazgo crítico. Comparalo
contra la auditoría anterior (busca el último docs/AUDITORIA_*.md).
Guardá el reporte nuevo, actualizá el BACKLOG, y preguntame si arreglo
los críticos ahora.
```

---

## ⚡ PROMPT QUINCENAL — Performance

```
Soy Nicolás. La plataforma tiene que volar. Corré la skill
performance-scan: medí latencias reales en producción primero, después
diagnosticá, después optimizá SOLO lo medido. Quick wins de impacto alto
en la misma sesión. Mostrame el antes/después de cada optimización.
```

---

## 👔 PROMPT MENSUAL — UX de gerentes y usuarios

```
Soy Nicolás. Quiero que la plataforma de verdad les sirva a los gerentes
generales y usuarios. Corré la skill ux-gerentes con los 4 perfiles
(GG móvil, contador, operador, encargado de área). Usá el browser si está
disponible. Implementá los quick wins de UX hoy mismo. Mostrame también
qué features nadie usó en 30 días según feature_usage.
```

---

## ✅ PROMPT POST-DEPLOY — QA de producción (después de CADA deploy)

```
Soy Nicolás. Acabo de deployar. Corré la skill qa-produccion completa
(solo lecturas, no crees ni modifiques datos). Verificá backend, frontend,
flujos críticos e integraciones. Si algo falla, pasá directo a la skill
incident-response.
```

---

## 🚨 PROMPT DE EMERGENCIA — Algo está roto

```
Soy Nicolás. Hay un problema en producción: [PEGÁ ACÁ EL ERROR O SCREENSHOT].
Corré la skill incident-response. Diagnóstico ANTES de tocar nada.
Explicame en español simple qué pasó, qué vas a hacer, y hacelo.
```

---

## 📅 PROMPT DE CIERRE MENSUAL — días 1-10 del mes

```
Soy Nicolás. Es cierre mensual. Corré la skill cierre-mensual paso a paso.
Antes de empezar, corré qa-produccion para confirmar que todo está sano.
Guiame con comandos exactos — no soy ingeniero.
```

---

# 🔄 CÓMO DEJARLO CORRIENDO CONSTANTEMENTE

Hay 4 niveles de automatización, del más simple al más completo:

## Nivel 1 — Ya está corriendo solo (no hacer nada)

| Qué | Dónde | Frecuencia |
|---|---|---|
| Monitor de salud + incidentes | Fly cron `monitor_cron` (Round 126) | cada 10 min* |
| Auto-sync SII/Nubox + conciliación | Fly cron `auto_sync_cron` (Round 126) | diario 06:00* |
| Smoke test backend producción | GitHub Actions `smoke-backend-prod.yml` | según workflow |
| Telemetría de uso | Middleware `feature_usage` (Round 152PPPPP) | siempre |

\* Requiere los schedules de Fly configurados (acción pendiente tuya):
```powershell
fly machine list -a cehta-backend   # anotá los IDs
fly machine update <id-monitor> --schedule "*/10 * * * *" -a cehta-backend
fly machine update <id-autosync> --schedule "0 6 * * *" -a cehta-backend
```

## Nivel 2 — Loop dentro de una sesión de Claude Code

Con Claude Code abierto, podés dejar un loop trabajando mientras hacés
otra cosa:

```
/loop 30m corré la skill debug-continuo capas 1-4 y 6; si encontrás un
bug nuevo arreglalo; si todo está verde decime "sano" y nada más
```

Se repite cada 30 minutos hasta que cierres la sesión o escribas algo.
Útil en días de marcha blanca o después de cambios grandes.

## Nivel 3 — Tareas programadas en la nube (claude.ai)

En claude.ai/code se pueden crear **scheduled tasks** que corren solas
aunque tu compu esté apagada. Pedímelo así:

```
Crea una tarea programada que corra todos los días a las 8:00 AM
(hora Chile) el prompt diario de debug de docs/PROMPTS_MAESTROS.md
y me deje el reporte.
```

Recomendación de calendario:

| Cuándo | Prompt |
|---|---|
| Lunes 8:00 | Auditoría semanal |
| Mar-Vie 8:00 | Debug diario |
| Día 1 del mes 9:00 | Recordatorio cierre mensual |
| Día 15 del mes | Performance scan |

## Nivel 4 — Windows Task Scheduler (opcional, tu PC)

Para correr el debug diario sin abrir Claude manualmente:

```powershell
# Crea tarea diaria 8:00 AM que abre Claude Code con el prompt de debug
schtasks /create /tn "RamCehta-DebugDiario" /sc daily /st 08:00 /tr "powershell -Command \"cd C:\Users\DELL\Documents\0.11.Nikolaya\Ram-Cehta; claude -p 'Corré la skill debug-continuo completa y dejame el reporte en docs/DEBUG_DIARIO.md. Arreglá solo lo seguro.' --allowedTools 'Read,Grep,Glob,Bash(python*)'\""
```

(Modo `-p` = headless: corre, reporta y termina solo.)

---

# 🗂️ MAPA COMPLETO DE SKILLS

| Skill | Para qué | Cadencia sugerida |
|---|---|---|
| `debug-continuo` | Escaneo de bugs en 7 capas | Diaria + post-cambios |
| `auditor-plataforma` | Auditoría 8 dimensiones multi-agente | Semanal |
| `performance-scan` | Medir y optimizar velocidad | Quincenal |
| `qa-produccion` | Smoke test E2E producción (read-only) | Post-deploy + diaria en marcha blanca |
| `ux-gerentes` | UX desde los ojos de cada perfil | Mensual |
| `test-contable-financiero` | Prueba el MOTOR de plata (IVA, partida doble, cuotas, impuesto específico, estados) con casos sintéticos | Tras cambios de montos + pre-marcha blanca |
| `audit-financiero` | Auditoría de DATOS reales (vouchers trabados, gaps SII, caja ociosa) | Pre-cierre mensual |
| `cierre-mensual` | Wizard de cierre | Días 1-10 del mes |
| `incident-response` | Triage de bugs en producción | Cuando algo se rompe |

**Para el test total contable/financiero** copiá el súper mega prompt de
`docs/SUPER_PROMPT_TEST_CONTABLE.md` (5 fases: motor + datos reales + flujos +
auditoría multi-agente + E2E supervisado).

**Para caza-bugs autónomo en bucle** (encontrar → verificar → arreglar →
validar → repetir hasta limpiar) copiá el súper prompt de
`docs/SUPER_PROMPT_CAZA_BUGS.md`. Tiene versión bucle, versión 1-ronda, y
versión `/loop` para dejarlo corriendo solo.

---

# ⚠️ REGLAS QUE NINGÚN PROMPT PUEDE SALTARSE

1. Los 22 invariantes de `docs/SUPER_PROMPT_MAESTRO.md` mandan SIEMPRE.
2. Producción no se toca sin avisar (datos, secrets, deploys).
3. Validación antes de terminar: sintaxis + import (523/431) + build.
4. Todo cambio queda reflejado en BACKLOG.md o en un doc de auditoría.
5. Modelo IA de la plataforma: Sonnet. No degradar a Haiku.
6. Credenciales SII/Nubox: solo Fernet, nunca en logs ni en chat.
7. RUT chileno = PII (Ley 19.628): nunca completo en logs.
