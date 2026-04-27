# Sentry — Setup paso-a-paso (Cehta Capital)

> Audiencia: Nicolas. Tiempo estimado: 15 min.
> Resultado: errores del backend (Fly.io) y del frontend (Vercel) llegan a Sentry con alertas por email.

El código ya está listo. Sin `SENTRY_DSN` seteado, Sentry queda silenciosamente apagado y nada se rompe — este documento explica cómo activarlo.

---

## 1. Crear cuenta y organización

1. Ir a <https://sentry.io/signup/> y crear cuenta con el correo corporativo.
2. Crear una organización: `cehta-capital` (o el nombre que prefieras).
3. Plan recomendado para empezar: **Developer (free)** — 5k errores / mes / proyecto. Suficiente para arrancar; si Cehta crece, upgrade a Team.

## 2. Crear los dos proyectos

Sentry separa los errores por proyecto. Necesitamos uno para backend y uno para frontend.

### 2.1 Proyecto backend (FastAPI)

1. **Projects → Create Project**.
2. Platform: **Python → FastAPI**.
3. Alert frequency: **Alert me on every new issue**.
4. Project name: `cehta-backend`.
5. Team: la que tengas por defecto.
6. Click **Create Project**.
7. **Anota el DSN** que te muestra. Tiene el formato:
   `https://abcdef123@o000000.ingest.us.sentry.io/0000000`

### 2.2 Proyecto frontend (Next.js)

1. **Projects → Create Project**.
2. Platform: **JavaScript → Next.js**.
3. Project name: `cehta-frontend`.
4. Click **Create Project**.
5. **Anota el DSN** del frontend (es distinto al del backend).

## 3. Configurar alertas

Por defecto Sentry alerta en cada nuevo issue. Sumar una regla agregada:

1. En cada proyecto: **Alerts → Create Alert → Issues**.
2. **When**: `An event is seen`.
3. **If**: `The issue is older than 1 minute AND the issue has happened more than 5 times in 1 minute`.
4. **Then**: `Send a notification to email: <tu-correo>`.
5. **Save Rule**.

## 4. Configurar secrets

### 4.1 Backend (Fly.io)

```bash
flyctl secrets set SENTRY_DSN="https://abcdef@o000000.ingest.us.sentry.io/0000000" --app cehta-backend
```

Esto reinicia la app automáticamente. Verificar en logs:

```bash
flyctl logs --app cehta-backend | grep sentry
# Esperado: "sentry active=true"
```

### 4.2 Frontend (Vercel)

1. Vercel Dashboard → proyecto `cehta-frontend` → **Settings → Environment Variables**.
2. Agregar `NEXT_PUBLIC_SENTRY_DSN` con el DSN del frontend.
3. **Importante**: marcar las tres scopes — `Production`, `Preview`, `Development`.
4. Trigger redeploy: `Deployments → ... → Redeploy` o push un commit.

### 4.3 Local (opcional)

Si querés capturar errores en desarrollo, agregar al `.env` / `.env.local`:

```env
# backend/.env
SENTRY_DSN=https://...

# frontend/.env.local
NEXT_PUBLIC_SENTRY_DSN=https://...
```

Recomendación: **mantenerlo apagado en local** para no contaminar el dashboard con ruido.

## 5. Verificar el wiring (test de captura)

### 5.1 Backend

Agregar temporalmente un endpoint que tira excepción:

```python
# backend/app/api/v1/__init__.py (o donde tengas el router)
@api_router.get("/_sentry-debug")
async def sentry_debug() -> None:
    raise ValueError("test sentry from backend")
```

Deploy, hacer `curl https://cehta-backend.fly.dev/api/v1/_sentry-debug`, verificar que el error aparece en `cehta-backend` en Sentry. **Borrar el endpoint** después.

### 5.2 Frontend

En cualquier página, agregar temporalmente un botón:

```tsx
<button onClick={() => { throw new Error("test sentry from frontend"); }}>
  Trigger Sentry
</button>
```

Click, verificar que aparece en `cehta-frontend`. Borrar el botón.

## 6. (Opcional) Source map upload — frontend

Para ver stack traces legibles del frontend en producción Sentry necesita los source maps. Pasos:

1. Sentry → **Settings → Auth Tokens → Create New Token**. Scopes: `project:releases`.
2. Vercel env: agregar `SENTRY_AUTH_TOKEN` (sin prefijo `NEXT_PUBLIC_`, sólo en build).
3. En `frontend/next.config.mjs` envolver el config con `withSentryConfig`:

   ```js
   import { withSentryConfig } from "@sentry/nextjs";
   // ...
   export default withSentryConfig(nextConfig, {
     org: "cehta-capital",
     project: "cehta-frontend",
     silent: true,
     widenClientFileUpload: true,
   });
   ```

4. Redeploy. Sentry uploadeará source maps automáticamente en cada build.

> No incluido en el commit `feat(observability): sentry SDK integration` — requiere token de Sentry. Activar cuando Nicolas tenga el dashboard arriba.

## 7. PII — qué se redacta y qué no

El código tiene un `before_send` hook (backend: `app/core/observability.py`, frontend: `lib/sentry-redact.ts`) que redacta automáticamente los siguientes campos antes de mandar el evento:

- `rut`, `numero_cuenta`, `account_number`
- `password`, `secret`, `token`, `access_token`, `refresh_token`
- `authorization`, `cookie`, `set-cookie`, `api_key`, `x-api-key`

`send_default_pii` está en `false` y session replay está deshabilitado en frontend (privacy-first). Si necesitás agregar más campos, editar `SENSITIVE_KEYS` en ambos archivos.

## 8. Costos

- Free tier: 5k errors / mes / proyecto. Con `tracesSampleRate=0.1` en producción, alcanza para Cehta en estado inicial.
- Si pasamos del límite, Sentry corta el ingest pero no cobra. Upgrade manual.
- Profiling está desactivado (`profiles_sample_rate=0.0`) — activar sólo si hace falta diagnosticar performance.

## 9. Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| Backend logs `sentry active=false` | `SENTRY_DSN` no seteado | `flyctl secrets list` y setearlo |
| Frontend no reporta nada | DSN sin `NEXT_PUBLIC_` | Revisar nombre exacto en Vercel |
| Errores de build en frontend | `@sentry/nextjs` no instalado | `cd frontend && npm install` |
| Stack trace ininteligible | Source maps no subidos | Configurar paso 6 |
| Aparecen RUTs en Sentry | Hook de redacción no ejecutó | Revisar `lib/sentry-redact.ts` y agregar la key |
