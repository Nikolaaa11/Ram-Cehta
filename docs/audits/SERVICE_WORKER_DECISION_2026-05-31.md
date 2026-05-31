# Decisión: Service Worker NO implementado — 2026-05-31

## TL;DR

**Skip Service Worker** por trade-off riesgo/beneficio negativo.

## Contexto histórico

Round 26 ("Fix parpadeo negro / FOUC dark mode") + R152e ("Fix definitivo
parpadeo negro") identificaron que la causa del parpadeo era un Service
Worker residual interceptando fetches y disparando flashes oscuros cada ~3s.

`components/providers.tsx` actualmente tiene un cleanup OBLIGATORIO que:

```typescript
// Capa 1+2+3: SW cleanup con reload-once
const swCleanup = async () => {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const r of registrations) {
    await r.unregister();
  }
  if ("caches" in window) {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  }
  // + reload-once para forzar que el SW se vaya de verdad
};
swCleanup();
```

## ¿Por qué agregar un SW sería riesgoso?

1. Si registramos un SW custom, este cleanup lo desregistraría
   inmediatamente — neutralizando el beneficio.
2. Si modificamos el cleanup para hacer whitelist (permitir nuestro SW),
   reintroducimos el riesgo de parpadeo si el SW custom tiene bugs.
3. El parpadeo era visible y disruptivo — un usuario REPORTÓ el bug.
   Cualquier regresión sería peor que perder offline support.

## Beneficio teórico de SW vs costo real

| Beneficio | Comentario |
|---|---|
| Offline support | Bajo valor: la app es operacional, casi todo requiere backend live |
| Cache de chunks JS/CSS | Ya está en Cache-Control del CDN (`max-age=31536000, immutable`) |
| Background sync | No hay caso de uso actual |
| Push notifications | NotificationsBell ya usa SSE/realtime |

## Alternativas implementadas que cubren los casos de uso

- **Cache CDN inmutable** (R152aaa): chunks JS/CSS ya cacheados 1 año
- **TanStack Query gcTime: 10min**: data en cache cliente sin SW
- **SSE realtime**: invalidación instant sin necesidad de background sync
- **Manifest.json** ya existe (PWA install funciona sin SW para básico)

## Decisión

**No implementar SW** hasta que:
1. Un usuario reporte caso de uso real de offline (vouchers en zona sin
   internet, p.ej.)
2. Se invierta tiempo dedicado para validar que SW no reintroduce parpadeo
   (testeo manual + automatizado en 3+ browsers × 2 OS)

## Si en el futuro se reactiva

Pasos:
1. Modificar `swCleanup` en `providers.tsx` para whitelist `/sw-v1.js`
2. Crear `public/sw-v1.js` con strategia "cache-first para /_next/static/, network-first para todo lo demás"
3. Registrar en `useEffect` del mismo provider DESPUÉS del cleanup
4. Test 48h en staging antes de prod
5. Validar visualmente que no hay parpadeo en Chrome/Firefox/Safari
