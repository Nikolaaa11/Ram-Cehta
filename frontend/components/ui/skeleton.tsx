/**
 * Skeleton — placeholder animado con shimmer Apple-style.
 *
 * Variants:
 *   - pulse: opacity fade in/out (más sutil, default)
 *   - shimmer: gradient sweep horizontal (más impacto)
 *   - wave: combina ambos (premium feel)
 *
 * Compositions:
 *   - SkeletonText: líneas con anchos variables
 *   - SkeletonCard: card completa con header + body
 *   - SkeletonStat: número grande + label
 *   - SkeletonAvatar: círculo + texto al lado
 *   - SkeletonTable: tabla con N filas
 */
import * as React from "react";
import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "pulse" | "shimmer" | "wave";
}

export function Skeleton({
  className,
  variant = "shimmer",
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-md bg-ink-100/60",
        variant === "pulse" && "animate-pulse",
        variant === "shimmer" && "skeleton-shimmer",
        variant === "wave" && "skeleton-shimmer animate-pulse",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Múltiples líneas de texto skeleton con anchos variables (más realista).
 */
export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  // Anchos variables para parecer texto real (last line shorter)
  const widths = ["w-full", "w-11/12", "w-4/5", "w-3/4", "w-2/3"];
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(
            "h-3",
            i === lines - 1 ? widths[2] : widths[i % 2],
          )}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton de card completa — header (avatar + 2 lineas) + body.
 */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white p-6 ring-1 ring-hairline shadow-card",
        className,
      )}
    >
      <div className="flex items-center gap-3 mb-4">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}

/**
 * Skeleton de KPI — label + número grande + delta.
 */
export function SkeletonStat({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white p-6 ring-1 ring-hairline shadow-card grid h-[160px] grid-rows-[auto_1fr_20px]",
        className,
      )}
    >
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-9 w-9 rounded-xl" />
      </div>
      <div className="flex flex-col justify-end gap-1.5">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-3 w-3/4" />
      </div>
      <Skeleton className="h-4 w-1/3 rounded-full" />
    </div>
  );
}

/**
 * Skeleton de avatar + texto (perfil compacto).
 */
export function SkeletonAvatar({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const sizes = {
    sm: { avatar: "h-8 w-8", line1: "h-2.5", line2: "h-2" },
    md: { avatar: "h-10 w-10", line1: "h-3", line2: "h-2.5" },
    lg: { avatar: "h-12 w-12", line1: "h-3.5", line2: "h-3" },
  };
  const s = sizes[size];
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Skeleton className={cn(s.avatar, "rounded-full")} />
      <div className="flex-1 space-y-1.5">
        <Skeleton className={cn(s.line1, "w-2/3")} />
        <Skeleton className={cn(s.line2, "w-1/2")} />
      </div>
    </div>
  );
}

/**
 * Skeleton de tabla con N filas.
 */
export function SkeletonTable({
  rows = 5,
  columns = 4,
  className,
}: {
  rows?: number;
  columns?: number;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white ring-1 ring-hairline shadow-card overflow-hidden",
        className,
      )}
    >
      {/* Header */}
      <div className="flex gap-3 border-b border-hairline px-4 py-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Rows */}
      <div className="divide-y divide-hairline">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="flex gap-3 px-4 py-4"
            style={{ animationDelay: `${i * 50}ms` }}
          >
            {Array.from({ length: columns }).map((_, j) => (
              <Skeleton
                key={j}
                className={cn(
                  "h-4 flex-1",
                  j === 0 && "max-w-[20%]",
                  j === columns - 1 && "max-w-[15%]",
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Skeleton para listas verticales con stagger animation.
 */
export function SkeletonList({
  items = 4,
  className,
}: {
  items?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: items }).map((_, i) => (
        <div
          key={i}
          className="rounded-xl bg-white p-4 ring-1 ring-hairline shadow-card flex items-center gap-3"
          style={{ animationDelay: `${i * 60}ms` }}
        >
          <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-2.5 w-3/5" />
          </div>
          <Skeleton className="h-6 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}
