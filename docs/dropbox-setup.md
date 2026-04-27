# Setup Dropbox Integration (V3 fase 1)

> Audiencia: Nicolas. Esta guia es paso-a-paso para conectar la cuenta de
> Cehta Capital a la plataforma. Tras estos pasos, el endpoint
> `/api/v1/dropbox/data-madre` puede leer `Inteligencia de Negocios/` y
> servir como base para el ETL real (V3 fase 2).

## 1. Configurar la app de Dropbox

Tu app: <https://www.dropbox.com/developers/apps/info/uj21ugdbgb3ao3p>

### Permissions tab — verificar scopes habilitados

- `files.metadata.read`
- `files.content.read`
- `account_info.read`

Despues de cambiar scopes hay que **Submit** y **Apply** en la pestana
Permissions; la conexion existente queda invalida y hay que re-correr OAuth.

### Settings tab → Redirect URIs

Agregar EXACTAMENTE:

```
https://cehta-backend.fly.dev/api/v1/dropbox/callback
```

Para desarrollo local agregar tambien:

```
http://localhost:8000/api/v1/dropbox/callback
```

## 2. Setear secrets en Fly

`DROPBOX_REFRESH_TOKEN` (legacy) ya no se usa: el backend ahora obtiene
y persiste tokens via OAuth flow.

```powershell
flyctl secrets set `
  DROPBOX_CLIENT_ID="uj21ugdbgb3ao3p" `
  DROPBOX_CLIENT_SECRET="ignq3m6a9ry72kq" `
  DROPBOX_REDIRECT_URI="https://cehta-backend.fly.dev/api/v1/dropbox/callback" `
  FRONTEND_URL="https://cehta-capital.vercel.app" `
  --app cehta-backend
```

## 3. Aplicar migracion 0005

El deploy aplica `alembic upgrade head` automaticamente (`fly.toml` →
`release_command`). Verificar que la migracion `0005_integrations` corrio:

```bash
flyctl ssh console --app cehta-backend -C "alembic current"
```

## 4. Conectar (single-admin, manual una vez)

Como admin autenticado en la plataforma:

1. Llamar `GET /api/v1/dropbox/connect` con tu Bearer token.
2. La respuesta trae `authorize_url` — abrirla en el browser.
3. Dropbox pide consentimiento → autorizar.
4. Dropbox redirige a `/api/v1/dropbox/callback?code=...&state=...`.
5. El backend intercambia `code` por `access_token` + `refresh_token`,
   obtiene metadata de la cuenta, y persiste todo en `core.integrations`.
6. Vos terminas en `${FRONTEND_URL}/admin?dropbox_connected=1`.

Comando de ejemplo para arrancar el flow:

```bash
TOKEN="..."  # tu JWT admin
curl -s -H "Authorization: Bearer $TOKEN" \
  https://cehta-backend.fly.dev/api/v1/dropbox/connect
# {"authorize_url":"https://www.dropbox.com/oauth2/authorize?..."}
```

## 5. Verificar conexion

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://cehta-backend.fly.dev/api/v1/dropbox/status
# {"connected":true,"account":{...},"connected_at":"..."}
```

## 6. Encontrar Data Madre

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  https://cehta-backend.fly.dev/api/v1/dropbox/data-madre
```

Si responde `found_inteligencia_negocios: false`, revisar:

- Que la carpeta exista en `Cehta Capital/Inteligencia de Negocios/`.
- Que el scope de la app permita ver esa carpeta (apps tipo "App folder"
  solo ven su carpeta dedicada; para el flujo Cehta hay que usar app
  con scope **Full Dropbox**).

## 7. Browseo libre

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://cehta-backend.fly.dev/api/v1/dropbox/files?path=/Cehta%20Capital"
```

## 8. Desconectar

```bash
curl -X POST -s -H "Authorization: Bearer $TOKEN" \
  https://cehta-backend.fly.dev/api/v1/dropbox/disconnect
```

Esto borra `core.integrations` para `provider='dropbox'`. La revocacion
remota del token queda pendiente (V4).
