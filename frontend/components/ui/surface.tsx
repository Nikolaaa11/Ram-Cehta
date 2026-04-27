/**
 * Surface — primitive de tarjeta Apple-style.
 *
 * Usar en lugar de `Card` (shadcn) para todas las superficies del dashboard.
 * Mantiene `Card` shadcn intacta para componentes legacy/forms.
 *
 * Variants:
 *  - default     bg-white rounded-2xl ring-hairline shadow-card
 *  - elevated    + shadow-card-hover
 *  - interactive + transición + hover lift
 *  - glass       bg-white/70 backdrop-blur-xl
 */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const surfaceVariants = cva(
  "rounded-2xl bg-white ring-1 ring-hairline shadow-card",
  {
    variants: {
      variant: {
        default: "",
        elevated: "shadow-card-hover",
        interactive:
          "transition-all duration-200 ease-apple hover:shadow-card-hover hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
        glass:
          "bg-white/70 backdrop-blur-xl shadow-glass ring-1 ring-hairline",
      },
      padding: {
        none: "",
        default: "p-6",
        compact: "p-4",
      },
    },
    defaultVariants: {
      variant: "default",
      padding: "default",
    },
  },
);

type AsProp<T extends React.ElementType> = { as?: T };

type PolymorphicProps<T extends React.ElementType> = AsProp<T> &
  Omit<React.ComponentPropsWithoutRef<T>, "as"> &
  VariantProps<typeof surfaceVariants>;

function SurfaceRoot<T extends React.ElementType = "div">({
  as,
  className,
  variant,
  padding,
  ...props
}: PolymorphicProps<T>) {
  const Component = (as ?? "div") as React.ElementType;
  return (
    <Component
      className={cn(surfaceVariants({ variant, padding }), className)}
      {...props}
    />
  );
}

const SurfaceHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { divider?: boolean }
>(({ className, divider, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex flex-col gap-1",
      divider && "border-b border-hairline pb-4 mb-4",
      className,
    )}
    {...props}
  />
));
SurfaceHeader.displayName = "Surface.Header";

const SurfaceTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h3
    ref={ref}
    className={cn(
      "text-base font-semibold tracking-tight text-ink-900",
      className,
    )}
    {...props}
  />
));
SurfaceTitle.displayName = "Surface.Title";

const SurfaceSubtitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn("text-sm text-ink-500", className)} {...props} />
));
SurfaceSubtitle.displayName = "Surface.Subtitle";

const SurfaceBody = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("", className)} {...props} />
));
SurfaceBody.displayName = "Surface.Body";

const SurfaceFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "mt-4 pt-4 border-t border-hairline flex items-center",
      className,
    )}
    {...props}
  />
));
SurfaceFooter.displayName = "Surface.Footer";

export const Surface = Object.assign(SurfaceRoot, {
  Header: SurfaceHeader,
  Title: SurfaceTitle,
  Subtitle: SurfaceSubtitle,
  Body: SurfaceBody,
  Footer: SurfaceFooter,
});

export { surfaceVariants };
