"use client";

/**
 * EditButton — botón consistente "Editar" reusable a lo largo de la app.
 *
 * Variantes:
 * - "ghost" (default): bg-white + ring-hairline (estilo header de detalle).
 * - "soft":  pill compacto para acciones por fila en tablas.
 *
 * Uso:
 *   <EditButton onClick={() => setOpen(true)} />
 *   <EditButton variant="soft" size="sm" label="Editar OC" />
 */
import * as React from "react";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "ghost" | "soft";
type Size = "sm" | "md";

interface EditButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  label?: string;
  iconOnly?: boolean;
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  ghost:
    "bg-white text-ink-700 ring-1 ring-hairline hover:bg-ink-100/40 focus-visible:ring-cehta-green",
  soft: "bg-cehta-green/10 text-cehta-green hover:bg-cehta-green/15 focus-visible:ring-cehta-green",
};

const SIZES: Record<Size, string> = {
  sm: "h-7 px-2.5 text-xs gap-1",
  md: "px-3.5 py-2 text-sm gap-2",
};

export function EditButton({
  label = "Editar",
  iconOnly = false,
  variant = "ghost",
  size = "md",
  className,
  ...rest
}: EditButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        "inline-flex items-center justify-center rounded-xl font-medium transition-colors duration-150 ease-apple",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
        "disabled:opacity-60 disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        iconOnly ? "aspect-square px-0" : "",
        className,
      )}
      aria-label={iconOnly ? label : undefined}
    >
      <Pencil
        className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"}
        strokeWidth={1.5}
      />
      {!iconOnly && <span>{label}</span>}
    </button>
  );
}
