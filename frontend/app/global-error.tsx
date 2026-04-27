"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Captura errores que escapan a las Suspense / error boundaries del App Router.
 * Reemplaza el layout root cuando algo falla muy temprano en el render.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es">
      <body>
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="text-center">
            <h1 className="text-2xl font-semibold">Algo falló</h1>
            <p className="mt-2 text-sm text-gray-500">
              El equipo ya fue notificado. Intenta recargar la página.
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
