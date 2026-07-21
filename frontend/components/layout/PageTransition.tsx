"use client";

/**
 * PageTransition — wrapper que aplica fade+slide en el cambio de ruta.
 *
 * MEGAPROMPT PERF: reescrito de framer-motion a CSS keyframes puros.
 * framer-motion agregaba ~38 kB gz al First Load de TODAS las rutas
 * (este wrapper vive en MobileLayoutShell) solo para un fade de 280ms.
 * La animación de salida se elimina a propósito: `mode="wait"` duplicaba
 * la duración percibida de cada navegación (exit 280ms + enter 280ms);
 * ahora la página nueva entra de inmediato con el mismo easing Apple.
 *
 * `prefers-reduced-motion` se respeta vía media query en el CSS
 * (ver .page-enter en globals.css) — sin JS.
 *
 * IMPORTANTE: este wrapper NO debe envolver el sidebar/header — sólo el
 * contenido del main. De lo contrario el sidebar parpadea cada navegación.
 */
import * as React from "react";
import { usePathname } from "next/navigation";

export interface PageTransitionProps {
  children: React.ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();

  // key={pathname} fuerza remount del div al navegar → la animación CSS
  // de entrada se re-dispara. Cero JS de animación, cero re-renders extra.
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
