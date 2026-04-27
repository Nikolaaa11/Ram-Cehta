import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "pulse" | "shimmer";
}

export function Skeleton({
  className,
  variant = "pulse",
  ...props
}: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-md bg-ink-100/50",
        variant === "pulse" && "animate-pulse",
        variant === "shimmer" && "skeleton-shimmer",
        className,
      )}
      {...props}
    />
  );
}
