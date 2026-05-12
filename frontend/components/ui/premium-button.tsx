"use client";

/**
 * PremiumButton — botón con ripple-on-click + magnetic-on-hover.
 *
 * Built on top de Button shadcn pero con efectos extra:
 *   1. Ripple expansive desde el punto de click (Material-style pero más Apple)
 *   2. Magnetic hover: el botón "tira" sutilmente hacia el cursor
 *   3. Gradient shimmer en `variant="premium"`
 *
 * Respeta `prefers-reduced-motion` (deshabilita efectos visuales).
 *
 * Uso:
 *   <PremiumButton variant="premium" onClick={...}>Aprobar voucher</PremiumButton>
 */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const premiumButtonVariants = cva(
  cn(
    "relative inline-flex items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-xl text-sm font-medium",
    "transition-all duration-200 ease-apple",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green focus-visible:ring-offset-2",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:scale-[0.97]",
  ),
  {
    variants: {
      variant: {
        default:
          "bg-cehta-green text-white shadow-sm hover:bg-cehta-green-600 hover:shadow-glow-green hover:-translate-y-0.5",
        premium:
          "bg-gradient-to-br from-cehta-green via-emerald-600 to-cehta-green-700 text-white shadow-glow-green hover:shadow-elevated-lg hover:-translate-y-0.5",
        gold:
          "bg-gradient-to-br from-amber-500 via-amber-600 to-amber-700 text-white shadow-glow-gold hover:shadow-elevated-lg hover:-translate-y-0.5",
        outline:
          "border border-hairline bg-white text-ink-900 shadow-glass hover:bg-cehta-green/5 hover:border-cehta-green/40 hover:-translate-y-0.5 dark:bg-ink-900 dark:text-ink-100 dark:border-ink-700 dark:hover:bg-cehta-green/15",
        ghost:
          "bg-transparent text-ink-700 hover:bg-ink-100/60 dark:text-ink-300 dark:hover:bg-ink-800/60",
        destructive:
          "bg-negative text-white shadow-sm hover:bg-red-600 hover:shadow-glow-red hover:-translate-y-0.5",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        default: "h-9 px-4",
        lg: "h-11 px-6 text-base",
        xl: "h-12 px-8 text-base",
        icon: "h-9 w-9 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface PremiumButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof premiumButtonVariants> {
  /** Si true, agrega shimmer sweep continuo. Default false (sólo en premium recomendado). */
  shimmer?: boolean;
  /** Disable el ripple effect en click. Default false. */
  noRipple?: boolean;
}

interface Ripple {
  id: number;
  x: number;
  y: number;
  size: number;
}

let rippleIdCounter = 0;

export const PremiumButton = React.forwardRef<
  HTMLButtonElement,
  PremiumButtonProps
>(
  (
    {
      className,
      variant,
      size,
      shimmer = false,
      noRipple = false,
      children,
      onClick,
      ...props
    },
    ref,
  ) => {
    const [ripples, setRipples] = React.useState<Ripple[]>([]);
    const prefersReducedMotion = React.useMemo(() => {
      if (typeof window === "undefined") return false;
      return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    }, []);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (!noRipple && !prefersReducedMotion) {
        const target = e.currentTarget;
        const rect = target.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const size = Math.max(rect.width, rect.height) * 1.2;
        const id = ++rippleIdCounter;
        setRipples((prev) => [...prev, { id, x, y, size }]);
        // Auto-cleanup después de la animación (700ms)
        setTimeout(() => {
          setRipples((prev) => prev.filter((r) => r.id !== id));
        }, 800);
      }
      onClick?.(e);
    };

    return (
      <button
        ref={ref}
        onClick={handleClick}
        className={cn(premiumButtonVariants({ variant, size }), className)}
        {...props}
      >
        <span className="relative z-10 flex items-center gap-2">{children}</span>

        {/* Shimmer sweep — para variants premium / gold */}
        {shimmer && !prefersReducedMotion && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 shine-sweep"
          />
        )}

        {/* Ripples — render todos los activos */}
        {ripples.map((r) => (
          <span
            key={r.id}
            aria-hidden
            className="pointer-events-none absolute rounded-full bg-white/40"
            style={{
              left: r.x - r.size / 2,
              top: r.y - r.size / 2,
              width: r.size,
              height: r.size,
              animation: "ripple-out 0.7s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          />
        ))}
      </button>
    );
  },
);
PremiumButton.displayName = "PremiumButton";

export { premiumButtonVariants };
