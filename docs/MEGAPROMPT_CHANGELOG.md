# CHANGELOG — Megaprompt OC/Voucher/Usuarios (2026-07-09)

Mapa completo de las 5 fases (5 agentes en paralelo sobre el repo + verificación
contra la BD viva). Lo verificado contra producción manda sobre lo que dedujeron
los agentes de las migraciones.

## ✅ HECHO en esta sesión

### FASE 2.1 · Usuaria Caterin Escobar
- Creada `cescobar@cenergy.cl`, `app_role=finance` + **GG en las 10 empresas**
  (clon de Victoria = acceso total operativo). Clave temporal `Cehta-Cescob-4429`.
  `app_metadata.app_role` seteado. Ver [SUPUESTOS](MEGAPROMPT_SUPUESTOS.md).

### FASE 1a · Borrado/revocación de usuarios (FIX)
- `backend/app/api/v1/admin_users.py`: `DELETE /admin/users/{id}` ("Revocar acceso")
  solo borraba `core.user_roles` → la cuenta de Supabase seguía activa (login) y los
  roles por empresa intactos. Ahora corta el acceso de verdad: (1) banea la cuenta en
  Supabase Auth (`ban_duration`, reversible), (2) desactiva roles por empresa
  (`active=false`), (3) revoca API tokens, (4) baja el rol global. Preserva historial.
  Protegido: uno mismo, nrietta, último admin. _Deploy en curso._

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
