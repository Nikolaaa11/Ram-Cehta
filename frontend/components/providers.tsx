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

  // V5++ Service Worker — registro silencioso en producción para offline-read.
  // En dev no registra (evita conflictos con HMR). Soft-fail si el browser
  // no soporta SW o el script da 404.
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    const register = async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none", // siempre check del SW al revalidar
        });
      } catch {
        // SW falló — no rompe la app, solo no hay offline-read
      }
    };
    // Defer para no competir con la hidratación inicial
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
      <Toaster />
    </QueryClientProvider>
  );
}
