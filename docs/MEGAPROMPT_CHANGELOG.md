# CHANGELOG — Megaprompt OC/Voucher/Usuarios (2026-07-09)

Mapa completo de las 5 fases (5 agentes en paralelo sobre el repo + verificación
contra la BD viva). Lo verificado contra producción manda sobre lo que dedujeron
los agentes de las migraciones.

## ✅ HECHO en esta sesión

### FASE 2.1 · Usuaria Caterin Escobar
- Creada `cescobar@cenergy.cl`, `app_role=finance` + **GG en las 10 empresas**
  (clon de Victoria = acceso total operativo). Clave temporal `Cehta-Cescob-4429`.
  `app_metadata.app_role` seteado. Ver [SUPUESTOS](MEGAPROMPT_SUPUESTOS.md).

### FASE 1a · Borrado/revocación de usuarios (FIX — ✅ VERIFICADO EN PROD)
- `backend/app/api/v1/admin_users.py`. Dos causas del bug "no se pueden borrar usuarios":
  1. **Gate de 2FA**: el DELETE exigía `current_admin_with_2fa` → 403 "2FA required" antes
     de ejecutar nada (el admin no tiene 2FA). Removido (revocación es reversible → no
     amerita 2FA; se mantiene en assign/update role que otorgan privilegios).
  2. **Lógica incompleta**: solo borraba `core.user_roles` → la cuenta de Supabase seguía
     activa (login) y los roles por empresa intactos.
- Ahora "Revocar acceso" corta el acceso de verdad: (1) banea la cuenta en Supabase Auth
  (`ban_duration`, reversible), (2) desactiva roles por empresa (`active=false`), (3)
  revoca API tokens, (4) baja el rol global. Preserva historial. Protegido: uno mismo,
  nrietta, último admin.
- **Test E2E en prod (5/5 verde)**: crear user → login OK → revocar (204) → login DESPUÉS
  = 400 (bloqueado) → roles empresa 0, rol global 0.

## 📋 MAPA — estado real de cada fase

### FASE 1 · Debug
- **Botones inertes: NO hay bugs.** Los ítems "que no hacen nada" fueron removidos del
  menú a propósito (R152GGGG); sus URLs siguen funcionando. Ya estaba limpio.
- **Borrado usuarios:** arreglado (arriba).

### FASE 1b · SII — BLOQUEADO por reCAPTCHA v3 (externo)
- Verificado en BD: las tablas `sii_documentos`, `sii_sync_runs`, `empresa_credenciales`
  (9 filas), `auto_sync_runs` **SÍ existen** (el agente se equivocó leyendo migraciones).
- El login al SII funciona (httpx cookie-based). El bloqueo real: la descarga de RCV
  del SII exige **reCAPTCHA v3** (token hardcodeado `'c3'`). Es un muro anti-bot externo;
  intentos previos (R28, R152HHHHHH) ya lo enfrentaron. No es "arreglable" de forma
  confiable sin un servicio de resolución de captcha o navegador headless con token real.
- Achievable sin resolver el captcha: (a) seedear la 10ª credencial faltante, (b) hacer
  visibles los errores de sync en el frontend (hoy algunos son silenciosos), (c) dejar el
  import CSV manual del RCV como camino oficial mientras el captcha bloquee la API.

### FASE 2 · Usuarios/roles
- 2.1 Caterin: ✅ hecho.
- 2.3 "todos suben gastos en cualquier empresa": el scoping multi-tenant HOY limita a las
  empresas del usuario. Es una decisión de política (romper aislamiento). Los usuarios de
  "acceso total" (GG en las 10, como Caterin) ya pueden en todas.
- 2.4 Aprobación por encargado: ✅ ya existe (`approval_rules` por empresa: GG+DIRECTOR).

### FASE 3 · Flujo de firmas OC — parcial (falta máquina de estados + firma 1-click)
- YA existe: auto-envío del PDF al GG (R152IIII), OC→voucher desde cuotas (R152yyy),
  panel "OCs firmadas → vouchers", kanban por estado, branding por empresa.
- FALTA: estados intermedios (`en_firma`/`firmada`/`enviada_proveedor`/`facturada`),
  componente de firma en 1 click (estampa user+fecha en PDF), notificaciones in-app +
  recordatorio 48h a firmantes, FK `vouchers.oc_id`. Es un build grande y coherente.

### FASE 4 · Tipos de documento voucher — parcial
- YA existe: 21 tipos (FACTURA/BOLETA/NC/ND/HONORARIOS + 16 electrónicos), aprobación
  por reglas, import CSV masivo.
- FALTA: subir **Excel .xlsx** (parsear + resumen), distinguir **BH propia vs BH tercero**,
  boleta venta/servicio como tipos separados, e "Excel de transferencia" (parsear
  beneficiarios). Build moderado.

## Recomendación de prioridad para las siguientes sesiones
1. FASE 3 flujo de firmas (alto valor operativo, build acotado y coherente).
2. FASE 4 tipos de voucher (BH propia/tercero + Excel transferencia).
3. FASE 1b SII: dejar el import CSV como camino oficial; el captcha no se resuelve barato.

---

# MEGAPROMPT PREVOUCHER (2026-07-13) — commits 17594d4 + 595acff

## F1 · Sistema de pre-vouchers ✅
Decisión de diseño: **el voucher DRAFT ES el pre-voucher** (cero tabla nueva,
cero migración de datos, una sola fuente de verdad).
- **Entrada**: /gastos generalizado — categoría nueva "Otro gasto" (4201-08 +
  área ADM), `source='prevoucher'`, wording "Pre-voucher enviado".
- **Cola de especialistas**: página /prevouchers + `GET /prevouchers/cola`
  (creador vía JOIN auth.users, adjuntos, días de espera, cuadre, OC origen,
  scope multi-tenant). Item "Pre-vouchers · Cola" en el sidebar.
- **El eslabón que faltaba**: `PUT /vouchers/{id}/lines` (replace-all de
  líneas de un DRAFT, mismas validaciones que crear: cuenta imputable +
  habilitada por empresa, área aplica, proyecto de la empresa, correlativo,
  debit XOR credit). Antes NO existía NINGÚN endpoint de edición de líneas:
  el especialista tenía que borrar y recrear el voucher.
- **Editor de imputación** en el detalle del voucher (solo DRAFT): componente
  VoucherLinesEditor — editar/agregar/quitar líneas inline con selects de
  cuenta/área/proyecto y verificación de cuadre en vivo.

## F2 · Verificación E2E en producción
Ver resultado al final de esta sección (script test_e2e_prevoucher).

## F3 · Guía de flujo + cargos ✅
GUIA_FLUJO_CARGOS.html (menú Recursos + copia en Descargas): las 5 estaciones
del flujo, tabla de cargos (2 niveles), cómo cambiarlos paso a paso, reglas de
aprobación, y el sistema de carpetas completo.

## F4 · Sistema de carpetas ✅
- **Mapa completo** de dónde saca/guarda información la plataforma (26 rutas
  Dropbox documentadas — ver guía §4). Root canónico `/Cehta Capital`.
- **scripts/ensure_dropbox_folders.py**: crea idempotente la estructura
  canónica (154 rutas: raíz + 15 carpetas × 10 empresas). Solo crea, nunca
  borra/mueve. Correr en Fly: `flyctl ssh console -a cehta-backend -C
  "python -m scripts.ensure_dropbox_folders"`.

## Bugs reales encontrados por el mapeo y arreglados de paso
1. **vouchers.py:2301** `dbx.ensure_folder` → método inexistente
   (`ensure_folder_path`): subir un adjunto formal a un voucher devolvía
   **502 SIEMPRE** desde que se creó la feature.
2. **backup_db.py** `DropboxService()` sin token → TypeError: el cron de
   backup **nunca pudo subir** un dump a /99-Backups/. Ahora carga la
   credencial de core.integrations.
3. **Roles por empresa inoperables**: el modal exigía el UUID de Supabase que
   ninguna pantalla mostraba. Ahora se asigna por **email** (backend resuelve),
   el listado muestra emails (JOIN auth.users) y la búsqueda es por email.
4. **admin_users DELETE** no invalidaba el cache de scope (ventana de 60s en
   que el revocado seguía viendo empresas). Fix: invalidate_user_cache.

## F2 · Resultado E2E final (post-fixes): ✅ 7/7 VERDE en producción
Erick crea pre-voucher (201, source=prevoucher persistido) → Caterin lo ve en
la cola (creador+cuadre) → reclasifica líneas (PUT /lines 200) → submit →
PENDING → limpieza total (reject 200 ✅ fix verificado, reopen, delete).

## ⚠️ F4 · ÚNICO PASO MANUAL PENDIENTE (Nicolás — 2 minutos)
El script de carpetas corrió en Fly pero Dropbox lo rechazó: la app de
Dropbox de Cehta (ID 6959091) NO tiene habilitado el permiso de ESCRITURA
`files.content.write`. Esto bloquea crear carpetas Y probablemente todas las
subidas (fotos de boletas, adjuntos, backups) están soft-fallando.
Pasos:
  1. Entrar a https://www.dropbox.com/developers/apps con la cuenta dueña
     de la app → app ID 6959091 → pestaña **Permissions**.
  2. Marcar `files.content.write` (y `files.content.read` si no está) → Submit.
  3. En la plataforma: /admin/dropbox-connect → reconectar Dropbox (re-OAuth
     para que el token nuevo traiga el permiso).
  4. Correr: flyctl ssh console -a cehta-backend -C
     "python -m scripts.ensure_dropbox_folders"  → debe dar 154/154 OK.

---

# MEGAPROMPT OC-DISEÑO + RENDIMIENTO (2026-07-21)

## Frente A · OC con firmas amplias ✅ (commit 52cf35a)
Template `orden_compra_panimavida.html` (default de las 10 empresas):
- Espacio de firma **17mm** sobre cada línea (antes ~6mm apretado).
- 3 firmas por fila, 2 filas bien separadas (gap 10mm), nunca se parten
  entre páginas (`page-break-inside: avoid`).
- Firma electrónica estampada: "✓ Firmado electrónicamente" + timestamp+hash
  ARRIBA de la línea.
- **Verificado visualmente** contra la OC.docx de referencia con una OC real
  en producción (mismos 8 ítems Panimávida, $12.180.000/$2.314.200/$14.494.200
  exactos) — PDF de 3 páginas OK, OC de prueba borrada después.

## Frente B · Rendimiento (auditoría con evidencia + fixes aplicados)

### Backend
| Fix | Antes | Después |
|---|---|---|
| **Orden middleware GZip** (main.py) | GZip por DENTRO de Idempotency → el cache de replay parseaba bodies comprimidos, `json.loads` fallaba en silencio, NUNCA se poblaba y un retry legítimo recibía **409**; 3 round-trips BD/mutación pagados sin beneficio | GZip OUTERMOST (último `add_middleware`): Idempotency ve JSON plano, el replay-cache funciona |
| **Audit trail** (audit_middleware.py) | El comentario decía "fire-and-forget" pero el `await` estaba en el flujo crítico: **+40-60ms + 1 conexión del pool** en CADA mutación antes de responder | `asyncio.create_task` → el INSERT corre en background, la respuesta sale de inmediato |
| **Claudia Data** (ai_data_qa_service.py) | Retenía la conexión del pool (3+1) durante la llamada a Claude (hasta 90s×3 retries): 4 preguntas concurrentes congelaban TODA la API | `await db.close()` antes de llamar a Claude (patrón R152UUUUU) |
| **PUT /vouchers/{id}/lines** (prevouchers.py) | Hasta **4 queries por línea** (~40 round-trips a São Paulo con 10 líneas ≈ **2-3s** de guardado) + 1 INSERT por línea | **4 queries totales** (`= ANY()`) + **1 INSERT** con UNNEST ≈ **~0.3-0.5s**. Mismas reglas, mismos mensajes de error por línea, preserva campos fiscales (`_keep`) |

### Base de datos (aplicado directo con CONCURRENTLY, cero downtime)
- **+1 índice parcial** `ix_vouchers_draft_created` (cola de pre-vouchers:
  filtra DRAFT + ordena por created_at).
- **−7 índices redundantes eliminados** (duplicados EXACTOS verificados por
  definición + pg_stat antes de borrar): idx_mov_empresa_fecha,
  idx_voucher_attachments_voucher_uploaded, idx_voucher_lines_{area,cuenta,
  proyecto}, ix_vouchers_empresa_status_fecha (0 scans; su gemelo
  ix_vouchers_filter_list tenía 51), ix_plan_cuentas_codigo (duplicaba la
  PK). Cada uno costaba mantenimiento en CADA INSERT/UPDATE de esas tablas
  (voucher_lines tenía 3 índices dobles → cada guardado de imputación
  actualizaba 6 índices en vez de 3).

### Frontend
| Fix | Impacto |
|---|---|
| **PageTransition sin framer-motion** (CSS keyframes) | ~−38 kB gz del First Load de TODAS las rutas (vivía en el layout). Además elimina el doble delay exit+enter (280ms+280ms) al navegar |
| **useSession → store compartido** (useSyncExternalStore) | 269 componentes creaban CADA UNO su listener Supabase + getSession(); ahora hay 1 listener global. API idéntica, 0 cambios en consumidores |
| **LazyComparativoChart** en /ceo | recharts (~100-120 kB gz) fuera del First Load del dashboard CEO |
| **EmpresaLogo sin `unoptimized`** | Vercel sirve logos redimensionados WebP (originales hasta ~250 kB renderizados a 40px) |
| **RecentActivityFeed 30s→60s** | Mitad de tráfico del feed en la página más abierta |
| **SW cleanup one-shot** (providers.tsx) | Antes borraba TODOS los CacheStorage en CADA carga de página; ahora corre 1 vez por browser (flag localStorage) |

### Diferido (documentado, no en esta ronda)
Lista OC noload(items), triggers FOR EACH STATEMENT, notifications batch
insert, framer-motion en dashboard/vouchers (por-ruta), sidebar
cuotas-resumen merge, covering index libro_mayor.

---

## FIX CRÍTICO (2026-07-21, mismo día) — era IMPOSIBLE reconectar Dropbox

Al verificar el paso manual de Dropbox de Nicolás, la BD mostraba el token
viejo intacto (07-05-2026, sin `files.content.write`). Los logs de Fly dieron
la causa exacta:

```
21:46:07  GET /dropbox/connect   → 200  (máquina 784792dc672e58)
21:46:31  GET /dropbox/callback  → 400  (máquina e82d444c629de8)  ← OTRA máquina
```

`app/api/v1/dropbox.py` guardaba el CSRF token del flow OAuth en
`_oauth_session`, un **dict en memoria del proceso**. La app corre con **2
máquinas** en Fly, así que `/callback` casi siempre cae en una máquina que no
tiene ese token → `DropboxOAuth2Flow.finish()` aborta → 400. El comentario del
código decía "single-admin → dict OK", pero el problema nunca fue la cantidad
de admins sino la cantidad de máquinas.

**Impacto real**: desde que la app escaló a 2 máquinas era imposible completar
el OAuth. Por eso Dropbox seguía en solo-lectura y todas las escrituras
(fotos de boletas, adjuntos, carpetas, backups) fallaban en silencio.

**Fix**: el state pasa a Postgres (`core.oauth_states`, migración
`0069_oauth_states`), que las 2 máquinas sí comparten. Uso único (el callback
lo borra al leerlo) + vencimiento de 15 min → además protege contra replay.

**Verificado en producción** llamando `/connect` y luego `/callback` con un
code falso pero el state real: el CSRF valida OK cruzando máquinas y el error
pasa a venir de Dropbox por el code inválido (antes moría en el CSRF local).
El state se consume correctamente. Tests: 1127 passed.

⚠️ Pendiente de la misma familia (flagueado, NO arreglado): el rate limit TOTP
de `two_factor.py:50` también vive en memoria — con 2 máquinas el límite
efectivo es 10 intentos/5min en vez de 5.
