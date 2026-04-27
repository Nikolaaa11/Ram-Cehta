"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import {
  LayoutDashboard,
  Users,
  FileText,
  BarChart3,
  Receipt,
  Wallet,
  FileBarChart,
  Shield,
  LogOut,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useMe } from "@/hooks/use-me";
import { cn } from "@/lib/utils";

type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
};

const NAV: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/proveedores", label: "Proveedores", icon: Users },
  { href: "/ordenes-compra", label: "Órdenes de Compra", icon: FileText },
  { href: "/movimientos", label: "Movimientos", icon: BarChart3 },
  { href: "/f29", label: "F29 / Tributario", icon: Receipt },
  { href: "/solicitudes-pago", label: "Solicitudes Pago", icon: Wallet },
  { href: "/reportes" as Route, label: "Reportes", icon: FileBarChart },
  // adminOnly: el sidebar es UI rendering puro (visibility/affordance) — no
  // gate de seguridad. Disciplina 3 prohíbe usar `app_role` para autorizar
  // acciones (que sí van por `allowed_actions` validado server-side), pero
  // mostrar/ocultar un nav item es un caso legítimo de UI hint. El backend
  // re-valida cada request. Ver also: dashboard/F29 que ya leen me.allowed_actions.
  { href: "/admin" as Route, label: "Admin", icon: Shield, adminOnly: true },
];

interface AppSidebarProps {
  email: string;
}

export function AppSidebar({ email }: AppSidebarProps) {
  const pathname = usePathname() ?? "";
  const { data: me } = useMe();
  const isAdmin = me?.app_role === "admin";

  const visibleItems = NAV.filter((item) => !item.adminOnly || isAdmin);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-hairline bg-white">
      {/* Brand */}
      <div className="border-b border-hairline px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cehta-green shadow-glass">
            <Sparkles className="h-4 w-4 text-white" strokeWidth={1.5} />
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight text-ink-900">Cehta Capital</p>
            <p className="text-xs text-ink-500">FIP CEHTA ESG</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 px-3 py-4">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 ease-apple",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                isActive
                  ? "bg-cehta-green/15 text-cehta-green"
                  : "text-ink-700 hover:bg-cehta-green/10 hover:text-cehta-green",
              )}
            >
              <Icon className="h-4 w-4" strokeWidth={1.5} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="space-y-2 border-t border-hairline px-4 py-4">
        <p
          className="truncate px-2 text-xs text-ink-500 tabular-nums"
          title={email}
        >
          {email}
        </p>
        <form action="/logout" method="POST">
          <button
            type="submit"
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-ink-700 transition-colors duration-150 ease-apple",
              "hover:bg-negative/10 hover:text-negative",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
            )}
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} />
            Cerrar sesión
          </button>
        </form>
      </div>
    </aside>
  );
}
