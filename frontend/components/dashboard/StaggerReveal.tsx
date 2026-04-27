"use client";

/**
 * StaggerReveal — wrapper de framer-motion para entrada en cascada.
 *
 * Pasa `index` cuando renderizás una lista de items y querés que aparezcan
 * uno después de otro con un offset (`delay * index`). Sin slide horizontal,
 * solo `y: 8 → 0` y fade — Apple-like restraint.
 *
 * Si el usuario tiene `prefers-reduced-motion: reduce`, el componente se
 * degrada a un `<div>` estático sin animar.
 */
import * as React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";

const APPLE_EASE = [0.16, 1, 0.3, 1] as const;

export interface StaggerRevealProps extends HTMLMotionProps<"div"> {
  /** Posición en la lista — multiplica el `delay` base. */
  index?: number;
  /** Delay base por item, en segundos. Default 0.06s. */
  delay?: number;
  children: React.ReactNode;
}

export function StaggerReveal({
  index = 0,
  delay = 0.06,
  children,
  ...rest
}: StaggerRevealProps) {
  const prefersReduced = useReducedMotion();
  if (prefersReduced) {
    return (
      <div {...(rest as React.HTMLAttributes<HTMLDivElement>)}>{children}</div>
    );
  }
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: APPLE_EASE, delay: index * delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
