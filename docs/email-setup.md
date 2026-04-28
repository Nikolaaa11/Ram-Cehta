# Email Setup (Resend)

> Plataforma usa **Resend** (https://resend.com) como proveedor SMTP para todas las notificaciones (alertas legales, recordatorios F29, welcome, reportes mensuales).

Soft-fail: si `RESEND_API_KEY` no está seteada, el código loguea `email.disabled` y sigue. Configurar es **opcional** pero altamente recomendado para que las alertas lleguen al equipo.

## 1. Crear cuenta Resend

1. Andá a https://resend.com → **Sign up**.
2. Free tier: **3.000 emails/mes** + 100/día. Suficiente para Cehta hoy.

## 2. Verificar dominio (recomendado)

Si querés enviar desde `noreply@cehta.cl`:

1. En el dashboard de Resend → **Domains** → **Add Domain** → `cehta.cl`.
2. Resend te muestra registros DNS (SPF, DKIM, DMARC). Copiarlos al panel del registrador (Hostinger en este caso).
3. Esperar verificación (~10 min).

Mientras se verifica el dominio, podés usar el remitente sandbox:

```
EMAIL_FROM=onboarding@resend.dev
```

## 3. Generar API Key

1. **API Keys** → **Create API Key** → name: `cehta-backend-prod`.
2. Permisos: **Sending access** (no necesitás full access).
3. Copiar la key (`re_xxx`) — sólo se ve una vez.

## 4. Setear secrets en Fly.io

```bash
flyctl secrets set RESEND_API_KEY=re_xxx EMAIL_FROM=noreply@cehta.cl --app cehta-backend
flyctl secrets set EMAIL_ADMIN_RECIPIENTS=nicolas@cehta.cl,otro@cehta.cl --app cehta-backend
```

`EMAIL_ADMIN_RECIPIENTS` es opcional; se usa como destinatario por defecto en `/notifications/test` y en alertas globales.

## 5. Probar

```bash
TOKEN=$(curl -s ... | jq -r .access_token)  # tu JWT de Supabase

curl -X POST https://cehta-backend.fly.dev/api/v1/notifications/test \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"to":"nicolas@cehta.cl"}'
```

Respuesta esperada:

```json
{ "sent": true, "to": "nicolas@cehta.cl", "provider_response": { "id": "..." } }
```

## 6. Verificar status

```bash
curl https://cehta-backend.fly.dev/api/v1/notifications/status \
  -H "Authorization: Bearer $TOKEN"
```

Debería devolver `{ "enabled": true, ... }`.

## Troubleshooting

- **`{ "enabled": false }`** → la env var no está seteada. Verificar `flyctl secrets list --app cehta-backend`.
- **`401 Invalid API key`** → la key se rotó/borró. Generar una nueva.
- **El email llega a SPAM** → verificar dominio en Resend (DKIM + SPF + DMARC).
- **`from` rechazado** → si el dominio no está verificado, sólo `onboarding@resend.dev` funciona.

## Templates

Los HTML viven en `backend/app/services/email_templates/`:

- `legal_alert.html` — alerta de vencimiento próximo de un documento legal.
- `f29_reminder.html` — recordatorio F29 (3 días antes).
- `welcome_user.html` — bienvenida al crear nuevo usuario.
- `monthly_report.html` — resumen mensual del CEO Dashboard.

Los placeholders `{{ var }}` se reemplazan en `email_service.render_template`.
