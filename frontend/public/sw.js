/**
 * Service Worker — DESACTIVADO temporalmente.
 *
 * V5++ HOTFIX: el SW estaba causando flash de pantalla negra cada ~3s
 * en producción por interceptación de page navigations. Hasta diagnosticar
 * el root cause exacto, este SW se auto-unregistera y limpia todos los
 * caches que tenía guardados.
 *
 * Los usuarios que tengan el SW viejo cacheado se actualizarán a este
 * en su próxima visita; al cargar, este SW limpia sus caches y se
 * unregistera. La siguiente carga ya no tendrá SW.
 */

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // 1. Borrar TODOS los caches (no importa la versión)
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (_) {
        // ignore
      }
      // 2. Tomar control de las pestañas abiertas
      await self.clients.claim();
      // 3. Auto-unregister
      try {
        await self.registration.unregister();
      } catch (_) {
        // ignore
      }
      // 4. Forzar reload de pestañas abiertas para que carguen sin SW
      try {
        const clientsList = await self.clients.matchAll({ type: "window" });
        for (const client of clientsList) {
          client.navigate(client.url);
        }
      } catch (_) {
        // ignore
      }
    })(),
  );
});

// NO interceptamos ningún fetch — todas las requests van directo al
// browser. Esto elimina cualquier posible problema de caching.
