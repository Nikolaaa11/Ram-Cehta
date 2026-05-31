/**
 * SectionDivider — separador visual con label centrado.
 *
 * Server-safe. Reemplaza el típico `<hr>` con algo más Apple:
 * línea horizontal con gradient fade + label flotante centrado + opcional
 * icono.
 *
 * Variants:
 *   - default: línea + label
 *   - gradient: línea con gradient cehta-green sutil
 *   - solid: sin label, sólo línea (compact)
 *
 * Uso:
 *   <SectionDivider label="Información contable" icon={Receipt} />
 *   <SectionDivider variant="solid" />
 */
import * as React from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SectionDividerProps {
  label?: string;
  icon?: LucideIcon;
  variant?: "default" | "gradient" | "solid";
  className?: string;
}

export function SectionDivider({
  label,
  icon: Icon,
  variant = "default",
  className,
}: SectionDividerProps) {
  if (variant === "solid" || !label) {
    return (
      <hr
        className={cn(
          "my-6 border-t border-hairline",
          variant === "gradient" &&
            "border-0 h-px bg-gradient-to-r from-transparent via-cehta-green/30 to-transparent",
          className,
        )}
      />
    );
  }

  return (
    <div
      role="separator"
      className={cn("relative my-6 flex items-center", className)}
    >
      <div
        className={cn(
          "flex-1 border-t",
          variant === "gradient"
            ? "border-0 h-px bg-gradient-to-r from-transparent to-cehta-green/30"
            : "border-hairline",
        )}
      />
      <div className="mx-3 flex items-center gap-2 rounded-full bg-white/80 backdrop-blur px-3 py-1 ring-1 ring-hairline shadow-glass">
        {Icon && (
          <Icon
            className="h-3.5 w-3.5 text-cehta-green"
            strokeWidth={1.75}
          />
        )}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-700">
          {label}
        </span>
      </div>
      <div
        className={cn(
          "flex-1 border-t",
          variant === "gradient"
            ? "border-0 h-px bg-gradient-to-l from-transparent to-cehta-green/30"
            : "border-hairline",
        )}
      />
    </div>
  );
}
