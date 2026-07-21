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

  // R152e: Fix definitivo parpadeo negro. Combina:
  //   1) Unregister cualquier SW residual (la causa raíz histórica del flash)
  //   2) FORZAR un reload si encontramos SW activo — porque unregister NO
  //      detiene el controller actual hasta la próxima navegación. Sin reload,
  //      el SW sigue interceptando fetches y flashea negro cada ~3s.
  //   3) Marca sessionStorage para evitar reload-loop infinito.
  //   4) MutationObserver elimina cualquier `.dark` que aparezca dinámicamente.
  useEffect(() => {
    if (typeof window === "undefined") return;

    // Capa 1+2+3: SW cleanup con reload-once.
    // MEGAPROMPT PERF: one-shot con localStorage — antes esto corría en
    // CADA carga de página (getRegistrations + caches.keys + borrar TODOS
    // los CacheStorage), penalizando cada arranque para limpiar un SW que
    // ya no existe. Ahora corre una sola vez por browser; si alguna vez se
    // reintroduce un SW legítimo, subir la versión del flag.
    const SW_CLEANUP_FLAG = "sw-cleanup-v1-done";
    const swCleanup = async () => {
      if (!("serviceWorker" in navigator)) return;
      if (localStorage.getItem(SW_CLEANUP_FLAG)) return;
      try {
        const hasController = !!navigator.serviceWorker.controller;
        const registrations = await navigator.serviceWorker.getRegistrations();
        const foundAny = registrations.length > 0;
        for (const r of registrations) {
          await r.unregister();
        }
        if ("caches" in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
        localStorage.setItem(SW_CLEANUP_FLAG, "1");
        const alreadyReloaded = sessionStorage.getItem("sw-cleanup-done");
        if ((hasController || foundAny) && !alreadyReloaded) {
          sessionStorage.setItem("sw-cleanup-done", "1");
          window.location.reload();
        }
      } catch {
        // ignore
      }
    };
    swCleanup();

    // Capa 4: Watch html.classList y remover `.dark` si aparece
    const root = document.documentElement;
    if (root.classList.contains("dark")) root.classList.remove("dark");
    const observer = new MutationObserver(() => {
      if (root.classList.contains("dark")) root.classList.remove("dark");
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
      <Toaster />
    </QueryClientProvider>
  );
}
