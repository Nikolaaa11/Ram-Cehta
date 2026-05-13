import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        // V5++ ola CJ — default ahora verde Cehta (era gris hsl shadcn).
        // 40+ archivos antes lo sobreescribían con className="bg-cehta-green"
        // ad-hoc. Ahora viene por default y el branding queda coherente.
        default:
          "bg-cehta-green text-white shadow hover:bg-cehta-green-700 focus-visible:ring-cehta-green",
        destructive:
          "bg-negative text-white shadow-sm hover:bg-negative/90 focus-visible:ring-negative",
        outline:
          "border border-hairline bg-white text-ink-700 shadow-sm hover:bg-ink-50 hover:text-ink-900 focus-visible:ring-cehta-green",
        secondary:
          "bg-ink-100 text-ink-700 shadow-sm hover:bg-ink-200 focus-visible:ring-cehta-green",
        ghost: "hover:bg-cehta-green/10 hover:text-cehta-green",
        link: "text-cehta-green underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
