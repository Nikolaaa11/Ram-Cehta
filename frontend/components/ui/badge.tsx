import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium tracking-tight",
  {
    variants: {
      variant: {
        success: "bg-positive/10 text-positive",
        danger: "bg-negative/10 text-negative",
        warning: "bg-warning/10 text-warning",
        neutral: "bg-ink-100/60 text-ink-700",
        info: "bg-sf-blue/10 text-sf-blue",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { badgeVariants };
