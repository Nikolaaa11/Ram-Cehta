"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
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

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
      <Toaster />
    </QueryClientProvider>
  );
}
