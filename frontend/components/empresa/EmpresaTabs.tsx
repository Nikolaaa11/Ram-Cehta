"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import {
  Building2,
  Users,
  Scale,
  Target,
  FolderOpen,
  Sparkles,
  TrendingUp,
  Receipt,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Tabs sticky para sub-secciones dentro de una empresa.
 * Apple style: subrayado active con color cehta-green.
 */

interface TabDef {
  suffix: string;
  label: string;
  icon: LucideIcon;
}

const TABS: TabDef[] = [
  { suffix: "", label: "Resumen", icon: Building2 },
  { suffix: "/flujo-mensual", label: "Flujo Mensual", icon: TrendingUp },
  { suffix: "/transacciones", label: "Transacciones", icon: Receipt },
  { suffix: "/categorias", label: "Categorías", icon: Layers },
  { suffix: "/trabajadores", label: "Trabajadores", icon: Users },
  { suffix: "/legal", label: "Legal", icon: Scale },
  { suffix: "/avance", label: "Avance", icon: Target },
  { suffix: "/documentos", label: "Documentos", icon: FolderOpen },
  { suffix: "/asistente", label: "AI Asistente", icon: Sparkles },
];

export function EmpresaTabs({ codigo }: { codigo: string }) {
  const pathname = usePathname() ?? "";
  const base = `/empresa/${codigo}`;

  return (
    <nav className="-mx-6 lg:-mx-10 sticky top-0 z-20 border-b border-hairline bg-white/70 px-6 lg:px-10 backdrop-blur-xl">
      <ul className="flex flex-nowrap gap-1 overflow-x-auto pb-px">
        {TABS.map((t) => {
          const Icon = t.icon;
          const href = `${base}${t.suffix}` as Route;
          const isActive =
            t.suffix === ""
              ? pathname === href
              : pathname === href || pathname.startsWith(`${href}/`);

          return (
            <li key={t.suffix}>
              <Link
                href={href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition-colors duration-150 ease-apple",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                  isActive
                    ? "border-cehta-green text-cehta-green"
                    : "border-transparent text-ink-500 hover:text-ink-900",
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.5} />
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
