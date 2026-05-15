"use client";

/**
 * useProveedoresCache — Round 44 — catálogo completo en memoria.
 *
 * Hace UN fetch a `/api/v1/proveedores/cache` (devuelve los ~228
 * proveedores activos en formato mínimo: id + razon + rut) y lo cachea
 * en TanStack Query con staleTime 5min.
 *
 * Beneficios sobre el typeahead anterior (debounce 300ms + GET /search):
 *  - Búsqueda 100% client-side → instantánea (sin debounce, sin round-trip)
 *  - 1 fetch total al cargar la app vs N fetches por keystroke
 *  - Funciona offline una vez cargado (cache vive 5+ min)
 *  - Muestra los primeros 50 al hacer focus sin tipear (descubrimiento)
 *
 * Tamaño del payload: ~50KB compress'd (228 items × ~200 bytes plain).
 * Despreciable comparado con las pestañas Next.js que ya pesan MB.
 *
 * Si el operador crea un proveedor nuevo durante la sesión (auto-create
 * en /vouchers/nubox-form), invalidar manualmente:
 *
 *   queryClient.invalidateQueries({ queryKey: ["proveedores", "cache"] });
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";

export interface ProveedorCacheItem {
  proveedor_id: number;
  razon_social: string;
  rut: string | null;
  /** Round 47 — opcional, para desambiguar entre nombres parecidos. */
  direccion?: string | null;
}

const STALE_TIME_MS = 5 * 60_000; // 5 min — más corto que catálogos
                                  // empresas (30min) porque proveedores
                                  // se crean con más frecuencia.

export function useProveedoresCache() {
  const { session, loading } = useSession();
  return useQuery<ProveedorCacheItem[], Error>({
    queryKey: ["proveedores", "cache"],
    queryFn: () => apiClient.get<ProveedorCacheItem[]>(
      "/proveedores/cache",
      session,
    ),
    enabled: !loading && !!session,
    staleTime: STALE_TIME_MS,
    gcTime: STALE_TIME_MS * 2,
  });
}

/**
 * Filtra el cache client-side por query string. Match en razón social
 * o RUT (caso-insensitivo, sin diacríticos). Sirve para typeahead y
 * para listas en otros contextos.
 *
 * Si `query` está vacío devuelve los primeros `limit` items (alfabético
 * por razón_social — ya viene ordenado del backend).
 */
export function useFilterProveedores(query: string, limit = 8) {
  const { data: cache = [], isLoading } = useProveedoresCache();
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // Sin query — primeros N alfabético (descubrimiento al hacer focus).
      return cache.slice(0, limit);
    }
    // Normalización simple: pasar a lower y quitar puntos/guiones del RUT
    // para que "12345678" matchee "12.345.678-9".
    const qNorm = q.replace(/[.\-\s]/g, "");
    const out: ProveedorCacheItem[] = [];
    for (const p of cache) {
      const razonHit = p.razon_social.toLowerCase().includes(q);
      const rutHit = p.rut
        ? p.rut.toLowerCase().replace(/[.\-\s]/g, "").includes(qNorm)
        : false;
      if (razonHit || rutHit) {
        out.push(p);
        if (out.length >= limit) break;
      }
    }
    return out;
  }, [cache, query, limit]);
  return { results: filtered, isLoading, cacheSize: cache.length };
}
