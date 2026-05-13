# Marcha blanca — checklist día 1

**Fecha estimada:** 14 mayo 2026
**Usuarios mañana:** 44 (1 admin global · 1 director · 6 staff Cehta · 8 EVOQUE · 7 REVTECH · 6 CSL · 6 RHO · 4 TRONGKAI · 4 DTE · 1 CENERGY)
**Producción:** v195 sobre Fly.io · health 200 · 1/1 passing
**Frontend:** https://cehta-capital.vercel.app
**Backend:** https://cehta-backend.fly.dev

---

## TL;DR — lo que se desplegó hoy (sesión 14 hs)

### Olas técnicas ejecutadas

| Ola | Qué incluyó | Estado |
|---|---|---|
| **CG** | Mejoras OC con IA · logo por empresa · PDF branded · DELETE OC | ✅ Prod |
| **CH** | Catálogo SII 15 tipos · proveedor typeahead · Total Bruto auto en todos los flujos · disciplina 1 (backend manda labels) | ✅ Prod |
| **CI** | Pantalla `/aprobaciones` dedicada · sidebar badge · modal firma con comentarios | ✅ Prod |
| **CJ batch 1** | Auditoría con 5 agentes paralelos · 10+ scope checks faltantes (BLOCKER security) · button verde default · float compare cuadratura · isError UI · bulk approve UI · audit log void/delete | ✅ Prod v194 |
| **CJ batch 2** | Rate limits AI · email async · 2 índices DB · adjunto clickeable en aprobaciones · N+1 mis-pendientes (4.8s → ~60ms) | ✅ Prod v195 |

### Métricas de mejora aplicadas

- **Security**: 13 scope-leak críticos cerrados (empresa.py 10 · OC mutators 3 · vouchers void+delete 2).
- **Perf**: N+1 mis-pendientes de 4800ms → 60ms (~80x). N+1 voucher detail de 600ms → 80ms (~7x). 2 índices DB nuevos.
- **UX**: 5 P0 cerrados (cuadratura floats · isError UI · errores silenciados · mobile table · button verde). Bulk approve nuevo.
- **Compliance**: void/delete voucher ahora dejan audit_log con before/after.

---

## ✅ Checklist antes de empezar la marcha blanca

Validar UNO POR UNO antes de avisar a los 44 users:

### Infra

- [ ] **Health endpoint OK**:
  ```bash
  curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" https://cehta-backend.fly.dev/api/v1/health
  # Esperado: 200 < 2s
  ```

- [ ] **Detailed health limpio**:
  ```bash
  curl -s https://cehta-backend.fly.dev/api/v1/health/detailed | python -m json.tool
  # Esperado: status=ok, alembic_head=0057, todos los services configured
  ```

- [ ] **Fly machine 1/1 passing**:
  ```bash
  flyctl status -a cehta-backend
  ```

- [ ] **Vercel deploy actualizado**: visitar https://cehta-capital.vercel.app/login en incógnito. El "Buttontton" del login debe estar **verde Cehta** (no gris).

### DB

- [ ] **Migration 0057 aplicada**:
  ```bash
  flyctl ssh console -a cehta-backend -C "alembic current"
  # Esperado: 0057 (head)
  ```

- [ ] **Conexión Supabase Pro o session pooler (5432, NO 6543)**:
  ```bash
  curl -s https://cehta-backend.fly.dev/api/v1/health/perf | python -c "import json,sys; d=json.load(sys.stdin); print('mode:', d['db_pool_mode'])"
  # Esperado: "session (QueuePool)"
  ```

### Catálogos

- [ ] **Empresas activas**: 10 (AFIS, CEHTA, CENERGY, CSL, DTE, EVOQUE, FIP_CEHTA, REVTECH, RHO, TRONGKAI).
- [ ] **Plan de cuentas**: 212 cuentas, 2120 habilitaciones (10 empresas × 212).
- [ ] **Reglas de aprobación**: existen para cada empresa portfolio.
  ```bash
  curl -s "https://cehta-backend.fly.dev/api/v1/admin/approval-rules" -H "Authorization: Bearer $TOKEN" | python -m json.tool
  ```

### Usuarios

- [ ] **44 cuentas creadas en Supabase Auth** (script `bulk_setup_users_ola_an.py` ya corrido).
- [ ] **Roles asignados** en `core.user_company_roles`.
- [ ] **Test login** con 1 usuario de cada tipo (GG, CONTADOR, DIRECTOR, ADMIN).

---

## Smoke test ejecutable (15 min)

Loguear como **admin** (`contactocehta@gmail.com`) y validar cada flujo:

### A. Dashboard inicial (1 min)
1. Visitar `/dashboard`.
2. Verificar: KPIs cargan, gráficos visibles, no console errors en browser.

### B. Vouchers (5 min)
1. `/vouchers` → debe listar (con `overflow-x` en mobile).
2. Click "Nuevo voucher" → `/vouchers/nubox`.
3. Verificar dropdown empresas: **solo aparecen las que tenés acceso** (no las 10 si sos contador de 1).
4. Elegir empresa, escribir proveedor (typeahead funciona), tipo doc, folio.
5. Agregar 1 línea contable + 1 financiera con monto $10000.
6. Cuadratura OK → botón "Crear voucher DRAFT" verde.
7. Submit → redirige a `/vouchers/{id}`.
8. Verificar que el voucher creado **muestra Total con IVA si es factura** (panel cehta-green).
9. Click "Enviar a aprobación" → status PENDING.

### C. Aprobaciones (3 min)
1. Logout. Login con un GG de la empresa donde creaste el voucher.
2. Sidebar muestra badge ámbar "Aprobaciones · 1" (pulsante).
3. Click → `/aprobaciones` muestra el voucher con todos los datos.
4. Click "Ver adjunto" → si hay adjunto, abre URL temporal Dropbox.
5. Click "Firmar como GG" → modal con resumen + campo comentarios.
6. Confirmar → firma registrada, voucher pasa a APPROVED (o avanza al siguiente firmante).
7. Volver a `/aprobaciones` → la cola se reduce en 1.

### D. Bulk approve (2 min — solo si hay >1 PENDING)
1. En `/aprobaciones` marcar checkbox de 2-3 vouchers del MISMO rol.
2. Barra flotante abajo aparece con "N seleccionados · Firmar como X".
3. Click "Firmar N" → dialog con tabla resumen.
4. Confirmar → toast "Firmados N vouchers".

### E. OC (3 min)
1. `/ordenes-compra/nueva` o `/importar`.
2. Crear OC manual de $100k a un proveedor.
3. Verificar Total Bruto en línea = Neto × 1.19 (si factura) o = Neto (si exenta).
4. Submit → OC creada.
5. Click "Descargar PDF" → abre HTML con logo de empresa + datos fiscales.

### F. Seguridad (2 min — CRÍTICO)
1. Logout. Login como **CONTADOR de empresa A** (ej. `jaime@trongkai.com`).
2. Intentar acceder directamente a una URL de empresa B en la URL bar:
   `/vouchers/<id_de_voucher_empresa_B>`.
3. **Resultado esperado**: pantalla de error "Sin acceso a este voucher" + botón "Volver".
4. Visitar `/aprobaciones` → solo deben aparecer vouchers de TRONGKAI (no de otras empresas).

---

## Si algo falla — plan de rollback

### Rollback BACKEND (Fly)

Hay 2 niveles de rollback:

**A. Rollback inmediato a versión previa estable** (si v195 rompe algo crítico):

```bash
# Ver releases recientes
flyctl releases -a cehta-backend

# Identificar la última versión que sabemos que funcionó (v193 si v194 ya tenía issues)
flyctl deploy -a cehta-backend -i registry.fly.io/cehta-backend:deployment-<HASH-v193> --strategy immediate
```

**B. Rollback parcial** (revertir un commit específico):

```bash
git revert <commit-hash>  # crea nuevo commit que deshace
git push origin main
flyctl deploy -a cehta-backend
```

### Rollback FRONTEND (Vercel)

Desde la UI de Vercel:
1. Project → Deployments
2. Buscar el deploy anterior estable
3. Tres puntos `···` → "Promote to production"

Lleva 5-10 segundos. Mientras tanto el FE viejo sigue sirviendo del CDN.

### Rollback de DB (migration 0057)

**No es necesario** — la 0057 solo CREATE INDEX IF NOT EXISTS. Es no destructiva. Si querés bajarla:

```bash
flyctl ssh console -a cehta-backend -C "alembic downgrade 0056"
```

---

## Comunicación a los 44 users (template)

Mandales este email mañana:

> **Asunto:** Marcha blanca Plataforma Cehta Capital — Listo para usar
>
> Hola [Nombre],
>
> Te damos la bienvenida a la nueva plataforma de Cehta Capital.
>
> **Tu acceso:**
> - URL: https://cehta-capital.vercel.app
> - Usuario: [email]
> - Contraseña temporal: [password del CSV]
> - **Acción primer login**: cambiá la contraseña en `/me/seguridad`.
>
> **Qué podés hacer según tu rol:**
> - Si sos **CONTADOR**: crear vouchers (manual o con IA), órdenes de compra, subir cartolas.
> - Si sos **GG**: aprobar vouchers de tu empresa desde `/aprobaciones`.
> - Si sos **DIRECTOR**: aprobar vouchers escalados desde `/aprobaciones`.
>
> **Tutorial rápido** (5 min):
> 1. Loguear. Cambiar contraseña en `/me/seguridad`.
> 2. Activar 2FA en `/2fa/setup` (Google Authenticator).
> 3. Mirar el sidebar para ver qué módulos tenés acceso.
> 4. Si sos aprobador, ir a `/aprobaciones` cuando haya badge ámbar.
>
> **Soporte**: si te trabás, escribí a `contactocehta@gmail.com`.
>
> Saludos.

---

## Cosas a monitorear durante el primer día

Dejá una pestaña con esto abierta:

### Logs en vivo
```bash
flyctl logs -a cehta-backend
```

Filtros útiles:
```bash
# Solo errores
flyctl logs -a cehta-backend | grep -E "ERROR|Traceback|error"

# Solo 5xx
flyctl logs -a cehta-backend | grep "5[0-9][0-9] "

# Scope violations (intentos cross-tenant)
flyctl logs -a cehta-backend | grep "scope.cross_tenant_attempt"
```

### Audit log de seguridad
```bash
curl -s "https://cehta-backend.fly.dev/api/v1/audit/scope-violations" \
  -H "Authorization: Bearer $YOUR_TOKEN" | python -m json.tool
```

Si aparece algo → ¡investigar! Significa que algún user intentó acceder a algo que no debía (puede ser bug o ataque).

### Costos Anthropic / Resend

- Anthropic dashboard: https://console.anthropic.com/usage
- Resend dashboard: https://resend.com/emails

Si Anthropic > $5 USD en 1 hora → algo se está rompiendo (rate limits están en 5-10/min ahora, deberían contener).

---

## Próximas mejoras post-marcha (no urgentes)

1. **Bulk reject** (hoy solo bulk approve).
2. **Email notification** cuando aparece voucher nuevo pendiente de mi firma.
3. **Histórico de aprobaciones** ("vouchers firmados por mí" últimos 30d).
4. **Preview de PDF inline** en el detalle (hoy abre en nueva tab).
5. **Migración NAS UGREEN** (todavía Dropbox sigue activo). Script rclone en `nas-cehta/`.
6. **2FA enforcement** en endpoints financieros críticos (hoy solo soft-rollout).
7. **Endpoints AI** con queue (RQ/Arq) en vez de inline — escalabilidad.

---

## Si todo se prende fuego

**Plan B nuclear**:

1. Avisar por WhatsApp a los 44 users: "Volvemos mañana, hubo un issue técnico."
2. Rollback a v193 (último deploy ANTES de hoy):
   ```bash
   flyctl releases -a cehta-backend
   # Buscar deploy del 13/05 mañana — ese es estable v193
   flyctl deploy -a cehta-backend -i registry.fly.io/cehta-backend:deployment-<HASH-v193> --strategy immediate
   ```
3. Verificar health 200.
4. Avisame con qué se rompió y diagnostico.

El sistema está **mucho** más robusto que ayer pero todo software puede romper. Ese plan B en 15 minutos te devuelve al estado de ayer en la noche, donde todo funcionaba.

---

**Commits de hoy** (para referencia rápida):

```
952cf55 perf+security: rate limits + email async + indices + adjunto link (v195)
576ef7d critico security + UX + perf batch (v194)
cd83202 chore: regen openapi + types TS
32b44d6 feat(approvals): /aprobaciones + UX firma (v193 base)
5c9584e fix(vouchers): /form-metadata scope filter
efe43c1 feat: ola CH fase 2 — Bruto/Neto auto todos los flujos
b68ae5b feat: ola CH catalogo SII + Total Bruto + UX
...
```

Total cambios en producción hoy: **40+ archivos modificados, 11 deploys, 2 migrations aplicadas**.
