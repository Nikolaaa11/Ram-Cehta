/**
 * Service Worker mínimo Cehta Capital — V5++.
 *
 * Estrategia simple:
 *   - GET de assets estáticos (_next/static, /logos/) → cache-first
 *   - GET de pages → network-first con fallback a cache (offline read)
 *   - GET API /api/v1 → network-first sin cache (data fresh)
 *   - POST/PATCH/DELETE → siempre network (mutations no se cachean)
 *
 * NO intenta sync de mutations offline (queueing) — fuera de scope.
 * Sí permite navegar pages ya visitadas si la conexión cae.
 *
 * Versionado: bumpear CACHE_VERSION cuando se haga deploy con cambios
 * que necesiten invalidar el cache. El sw activate borra los caches
 * de versiones anteriores automáticamente.
 */

const CACHE_VERSION = "cehta-v1-2026-05";
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const STATIC_CACHE = `${CACHE_VERSION}-static`;

const STATIC_PATTERNS = [
  /\/_next\/static\//,
  /\/logos\//,
  /\.(?:png|jpg|jpeg|svg|webp|woff2?|ttf|otf)$/,
];

self.addEventListener("install", (event) => {
  // Activar nuevo SW inmediatamente sin esperar al refresh manual
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Borrar caches de versiones anteriores
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Solo cacheamos GET. Mutations van directo a network.
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // API: network-first, sin caching (data debe ser fresh)
  if (url.pathname.startsWith("/api/")) {
    return; // dejá que el browser maneje
  }

  // Estáticos: cache-first agresivo
  if (STATIC_PATTERNS.some((p) => p.test(url.pathname))) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // Pages (HTML, navegación): network-first, fallback cache
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    event.respondWith(networkFirstWithFallback(req, PAGE_CACHE));
    return;
  }

  // Resto: dejar que el browser maneje
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;

  try {
    const response = await fetch(req);
    if (response.ok) {
      cache.put(req, response.clone());
    }
    return response;
  } catch (err) {
    // Sin red y sin cache → 503
    return new Response("Offline", { status: 503 });
  }
}

async function networkFirstWithFallback(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(req);
    if (response.ok) {
      cache.put(req, response.clone());
    }
    return response;
  } catch (err) {
    // Sin red → intentar cache
    const cached = await cache.match(req);
    if (cached) return cached;
    // Sin cache → mostrar página offline mínima
    return new Response(
      '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Offline · Cehta</title>' +
        '<style>body{font-family:system-ui,-apple-system,sans-serif;padding:4rem;text-align:center;color:#1f2937}' +
        'h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#6b7280}</style></head>' +
        '<body><h1>Sin conexión</h1>' +
        '<p>Esta página no está cacheada. Conectá a internet y reintentá.</p>' +
        '<p style="margin-top:2rem"><a href="/dashboard">Volver al dashboard</a></p>' +
        '</body></html>',
      {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
    );
  }
}
