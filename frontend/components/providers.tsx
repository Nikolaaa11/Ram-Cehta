"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toast";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // V5++ perf: aumentado de 60s → 2min. La mayoría de la data
            // (vouchers, F22, empresas, catálogos) cambia rara vez. Los
            // cambios reales se inyectan via SSE (mailbox.received,
            // notification.created, etc.) que invalidan queries específicas.
            staleTime: 2 * 60 * 1000,
            // gcTime: mantener data en cache 10min después de unmount.
            // Usuario navega vouchers→empresas→vouchers, y vuelve con cache.
            gcTime: 10 * 60 * 1000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  // V5++ HOTFIX: SW deshabilitado (estaba causando flash de pantalla negra
  // cada ~3s en producción). En vez de registrar, UNREGISTRA cualquier SW
  // existente y limpia caches. Cuando esté arreglado el bug, se re-habilita.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const cleanup = async () => {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const r of registrations) {
          await r.unregister();
        }
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch {
        // ignore
      }
    };
    cleanup();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
      <Toaster />
    </QueryClientProvider>
  );
}
