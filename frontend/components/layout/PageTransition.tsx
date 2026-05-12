"use client";

/**
 * PageTransition — wrapper que aplica fade+slide en el cambio de ruta.
 *
 * Usa el pathname como key, así Framer Motion detecta el cambio de página
 * y dispara la animación de salida + entrada.
 *
 * Si el user tiene `prefers-reduced-motion`, se degrada a `<div>` estático.
 *
 * IMPORTANTE: este wrapper NO debe envolver el sidebar/header — sólo el
 * contenido del main. De lo contrario el sidebar parpadea cada navegación.
 */
import * as React from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

const APPLE_EASE = [0.16, 1, 0.3, 1] as const;

export interface PageTransitionProps {
  children: React.ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();
  const prefersReduced = useReducedMotion();

  if (prefersReduced) {
    return <>{children}</>;
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.28, ease: APPLE_EASE }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
