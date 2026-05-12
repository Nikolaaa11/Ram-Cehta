"use client";

/**
 * AnimatedRow — wrapper para filas de tablas con entrada en cascada.
 *
 * Usa CSS animations (no framer-motion) para keep payload chico en tablas
 * grandes (100+ rows). Aplica delay basado en `index` con cap a 12 items
 * para evitar que filas tarde aparezcan muy lentas.
 *
 * Uso:
 *   {items.map((item, i) => (
 *     <AnimatedRow key={item.id} index={i}>
 *       <td>...</td>
 *     </AnimatedRow>
 *   ))}
 *
 * Para listas <ul>:
 *   <AnimatedRow as="li" index={i}>...</AnimatedRow>
 *
 * Para divs:
 *   <AnimatedRow as="div" index={i} className="card">...</AnimatedRow>
 */
import * as React from "react";
import { cn } from "@/lib/utils";

export interface AnimatedRowProps {
  /** Posición en la lista, 0-indexed. */
  index: number;
  /** Delay base por item en ms. Default 30. */
  delayMs?: number;
  /** Cap del delay total — items pasados este index usan el mismo delay. Default 12. */
  cap?: number;
  /** Tag a renderizar. Default 'tr'. */
  as?: "tr" | "li" | "div";
  className?: string;
  children: React.ReactNode;
}

export function AnimatedRow({
  index,
  delayMs = 30,
  cap = 12,
  as = "tr",
  className,
  children,
  ...props
}: AnimatedRowProps & React.HTMLAttributes<HTMLElement>) {
  const Component = as as React.ElementType;
  const effectiveIndex = Math.min(index, cap);
  const style: React.CSSProperties = {
    animationDelay: `${effectiveIndex * delayMs}ms`,
    animationFillMode: "both",
  };

  return (
    <Component
      style={style}
      className={cn("animate-slide-up-fade", className)}
      {...props}
    >
      {children}
    </Component>
  );
}
