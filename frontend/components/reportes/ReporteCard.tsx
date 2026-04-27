import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { cn } from "@/lib/utils";

interface ReporteCardProps {
  icon: ReactNode;
  title: string;
  description: string;
  href: Route | string;
  /** Color de acento del icon container. Default: cehta-green. */
  accent?: "cehta-green" | "sf-blue" | "sf-purple" | "sf-teal";
}

const ACCENT_MAP: Record<NonNullable<ReporteCardProps["accent"]>, string> = {
  "cehta-green": "bg-cehta-green/10 text-cehta-green ring-cehta-green/20",
  "sf-blue": "bg-sf-blue/10 text-sf-blue ring-sf-blue/20",
  "sf-purple": "bg-sf-purple/10 text-sf-purple ring-sf-purple/20",
  "sf-teal": "bg-sf-teal/10 text-sf-teal ring-sf-teal/20",
};

export function ReporteCard({
  icon,
  title,
  description,
  href,
  accent = "cehta-green",
}: ReporteCardProps) {
  return (
    <Surface
      as={Link}
      // typedRoutes: usar `as Route` está OK incluso si una ruta aún no existe;
      // permite que este componente coexista con páginas en construcción.
      href={href as Route}
      variant="interactive"
      className="group flex h-full flex-col gap-4 p-6"
    >
      <div className="flex items-start justify-between">
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-2xl ring-1 ring-inset transition-transform duration-200 ease-apple group-hover:scale-105",
            ACCENT_MAP[accent],
          )}
        >
          {icon}
        </div>
        <ArrowUpRight
          className="h-5 w-5 text-ink-300 transition-all duration-200 ease-apple group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-cehta-green"
          strokeWidth={1.5}
        />
      </div>
      <div className="space-y-1">
        <h3 className="text-base font-semibold tracking-tight text-ink-900">
          {title}
        </h3>
        <p className="text-sm leading-relaxed text-ink-500">{description}</p>
      </div>
    </Surface>
  );
}
