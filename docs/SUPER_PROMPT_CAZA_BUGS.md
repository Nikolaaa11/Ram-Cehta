# SÚPER PROMPT — Caza-bugs autónomo (encontrar y arreglar TODO)

> **Qué es**: el prompt para dejar a Claude cazando y arreglando bugs en
> bucle, solo, hasta que la plataforma quede limpia. Copialo y pegalo tal
> cual en Claude Code (en la carpeta Ram-Cehta).
>
> **Cómo funciona**: trabaja en rondas. Cada ronda encuentra bugs, los
> verifica (para no arreglar fantasmas), arregla los reales, valida que no
> rompió nada, y repite. Para cuando 2 rondas seguidas no encuentran nada
> nuevo.
>
> **Última actualización**: 2026-06-12 · Round 152QQQQQQ

---

## ⭐ EL SÚPER PROMPT (copiar todo lo de abajo)

```
Soy Nicolás Rietta, opero Ram-Cehta (FIP CEHTA ESG). Quiero que CACES y
ARREGLES bugs de la plataforma en bucle, de forma autónoma, hasta dejarla
limpia. Trabajá como tech lead + auditor senior. No estimes en tokens.
Usá agentes en paralelo. Modelo IA de la plataforma: Sonnet (no cambiar).

LEÉ PRIMERO: docs/SUPER_PROMPT_MAESTRO.md (22 invariantes) + docs/BACKLOG.md.

TRABAJÁ EN RONDAS. Cada ronda:

PASO 1 — ENCONTRAR (agentes en paralelo)
Lanzá agentes que busquen bugs reales en estas dimensiones, cada uno con
verificación de su propio hallazgo leyendo el código (no grep a ciegas):
  - Contable: float/round en montos, IVA mal, neto+IVA≠total, partida doble,
    cuotas, impuesto específico, redondeos. (apóyate en la skill
    test-contable-financiero)
  - Seguridad: endpoints sin auth, admin sin check, errores que filtran
    internals, secrets hardcodeados, RUT/clave en logs.
  - Multi-tenant: queries sin filtro de empresa en endpoints no-admin.
  - Race conditions: read-then-write sin FOR UPDATE en firmas/pagos/
    correlativos; crons sin SKIP LOCKED.
  - Performance: N+1, listados sin paginación, APIs externas en transacción.
  - Frontend: fetch sin manejo de error, doble-submit, estados vacíos
    crudos, jerga sin explicar, build/TSC roto.
  - Integraciones: SII/Nubox/Dropbox/email sin timeout/retry/log.
También corré la skill debug-continuo (7 capas) como red de seguridad.

PASO 2 — VERIFICAR (adversarial, antes de tocar nada)
Por cada bug candidato: releé el archivo:línea citado y confirmá que es
REAL. Descartá los falsos positivos (ej: proveedores es catálogo global por
diseño; DropboxNotConfigured es excepción nuestra con mensaje controlado).
Para los críticos, pedí a un segundo agente que intente REFUTAR el bug.
Solo pasan a arreglarse los confirmados.

PASO 3 — ARREGLAR (en orden de severidad: 🔴 críticos → 🟡 → 🟢)
Arreglá cada bug confirmado con el patrón ya usado en el repo (mirá cómo se
resolvió uno similar antes: FOR UPDATE, get_allowed_empresa_codes, Decimal
ROUND_HALF_UP, etc.). Mantené el estilo del código circundante. Comentá el
fix con el round (R152QQQQQQ) y el ANTES/AHORA.

PASO 4 — VALIDAR (obligatorio antes de cerrar la ronda)
  - Sintaxis: AST de los archivos tocados.
  - Backend: import completo → 523 rutas / 431 paths (si cambió el número
    sin querer, algo se rompió).
  - Frontend (si tocaste TS/TSX): npx tsc --noEmit + npm run build verdes.
  - Si tocaste el motor contable: re-corré la sección afectada de la skill
    test-contable-financiero.
Si algo no valida, NO cierres la ronda: arreglá o revertí.

PASO 5 — REGISTRAR y DECIDIR si seguir
  - Registrá cada bug arreglado (archivo:línea, qué era, fix) y los falsos
    positivos descartados.
  - Actualizá docs/BACKLOG.md (sacá lo hecho, agregá lo que encontraste pero
    no arreglaste por riesgo/alcance).
  - Si esta ronda encontró y arregló bugs reales → arrancá OTRA ronda.
  - Si 2 rondas SEGUIDAS no encuentran nada nuevo → PARÁ. La plataforma está
    limpia en lo que se puede verificar estáticamente.

REGLAS DURAS:
- Producción: SOLO lecturas. Migraciones SQL: avisame antes (yo autorizo).
- NUNCA arreglar a ciegas: sin verificar = no se toca.
- NUNCA degradar Sonnet a Haiku.
- Credenciales solo Fernet, nunca en logs ni en chat. RUT = PII.
- Si un fix es riesgoso (refactor grande, cambia comportamiento), NO lo
  apliques: anotalo en BACKLOG con la recomendación y seguí.
- Cada cambio reflejado en BACKLOG.md o en el reporte.

ENTREGABLE FINAL (cuando pares):
1. Tabla de bugs arreglados por ronda: severidad | archivo:línea | qué era | fix.
2. Falsos positivos descartados (con por qué).
3. Bugs reales NO arreglados (riesgo/alcance) → quedaron en BACKLOG.
4. Validación final: 523/431 + build verde + tests contables.
5. Guardá el reporte en docs/CAZA_BUGS_YYYY_MM_DD.md.
6. Decime el comando exacto de deploy si hay cambios para subir.
```

---

## Versión "una ronda" (más controlada, ~20-30 min)

Si no querés que corra en bucle largo, una sola pasada:

```
Soy Nicolás. Hacé UNA ronda de caza-bugs sobre Ram-Cehta: corré la skill
debug-continuo + lanzá agentes de seguridad, multi-tenant, contable y race
conditions en paralelo. Verificá cada hallazgo (descartá falsos positivos),
arreglá los críticos confirmados, validá 523/431 + build, y dame el reporte
con esperado vs obtenido. Lo que no alcances o sea riesgoso → BACKLOG.
```

---

## Para dejarlo corriendo SOLO (sin que estés encima)

Con Claude Code abierto, podés dejarlo en bucle con `/loop`:

```
/loop 45m Hacé una ronda de caza-bugs (debug-continuo + agentes de
seguridad/multi-tenant/contable/race). Verificá cada hallazgo, arreglá los
confirmados, validá 523/431 + build. Si no encontrás nada nuevo, decí
"sano" y nada más. Lo riesgoso → BACKLOG.
```

Se repite cada 45 min hasta que cierres la sesión. Ideal para días de
marcha blanca o después de cambios grandes.

---

## Por qué este prompt no rompe nada (las salvaguardas)

| Riesgo | Salvaguarda en el prompt |
|---|---|
| Arreglar bugs fantasma | Paso 2: verificación adversarial obligatoria |
| Romper algo al arreglar | Paso 4: valida 523/431 + build antes de cerrar |
| Refactor riesgoso | Regla dura: lo riesgoso va a BACKLOG, no se aplica |
| Tocar producción | Solo lecturas; migraciones requieren tu OK |
| Loop infinito | Para tras 2 rondas sin hallazgos nuevos |
| Perder trazabilidad | Paso 5: todo a BACKLOG + reporte fechado |

---

## Relación con las otras skills y prompts

- Este **orquesta** las skills `debug-continuo`, `auditor-plataforma` y
  `test-contable-financiero` en un bucle de arreglo.
- Para test contable puro → `docs/SUPER_PROMPT_TEST_CONTABLE.md`.
- Para mejora integral (perf + UX + features) → el súper prompt de mejora
  total en `docs/PROMPTS_MAESTROS.md`.
- Diferencia clave: este NO agrega features ni optimiza por gusto — solo
  **encuentra y arregla lo que está mal**.
