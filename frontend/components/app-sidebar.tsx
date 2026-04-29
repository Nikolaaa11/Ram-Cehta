"use client";

import { useState, useEffect } from "react";
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
  LogOut,
  Sparkles,
  LineChart,
  CalendarDays,
  Target,
  Search,
  Scale,
  UserCog,
  Database,
  ShieldCheck,
  Building2,
  Bell,
  ChevronDown,
  ChevronRight,
  Plug,
  TrendingUp,
  Layers,
  ScrollText,
  Mail,
  Activity,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { useMe } from "@/hooks/use-me";
import { useCatalogoEmpresas } from "@/hooks/use-catalogos";
import { useUnreadCount } from "@/hooks/use-notifications";
import { useCriticalObligationsCount } from "@/hooks/use-obligations";
import { NotificationsBell } from "@/components/notifications/NotificationsBell";
import { cn } from "@/lib/utils";

/**
 * V3 Sidebar — 5 grupos jerárquicos según docs/V3_VISION.md §1.
 *
 * Visibilidad por `me.app_role` (UI hint puro, Disciplina 3):
 *  - admin → ve todo
 *  - ceo   → ve EJECUTIVO + OPERACIONES + ESTRATEGIA + DOCUMENTOS
 *           (NO existe en backend todavía — se trata igual que admin para
 *            esta fase mientras se agrega el rol al ROLE_SCOPES del backend)
 *  - resto → ve OPERACIONES + ESTRATEGIA + DOCUMENTOS
 *
 * El sidebar es UI rendering puro: el backend re-valida cada endpoint vía
 * `allowed_actions`. Mostrar/ocultar nav items es affordance, no autorización.
 */

type NavItem = {
  href: Route;
  label: string;
  icon: LucideIcon;
};

type NavGroup = {
  id: "ejecutivo" | "operaciones" | "estrategia" | "documentos" | "admin";
  label: string;
  items: NavItem[];
};

const GROUPS: NavGroup[] = [
  {
    id: "ejecutivo",
    label: "Ejecutivo",
    items: [
      { href: "/ceo" as Route, label: "Dashboard CEO", icon: LineChart },
      { href: "/calendario" as Route, label: "Calendario", icon: CalendarDays },
    ],
  },
  {
    id: "operaciones",
    label: "Operaciones",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/proveedores", label: "Proveedores", icon: Users },
      { href: "/ordenes-compra", label: "Órdenes de Compra", icon: FileText },
      { href: "/solicitudes-pago", label: "Solicitudes Pago", icon: Wallet },
      { href: "/movimientos", label: "Movimientos", icon: BarChart3 },
      { href: "/f29", label: "F29 / Tributario", icon: Receipt },
      { href: "/notificaciones" as Route, label: "Notificaciones", icon: Bell },
    ],
  },
  {
    id: "estrategia",
    label: "Estrategia",
    items: [
      { href: "/avance" as Route, label: "Avance Empresas", icon: Target },
      { href: "/fondos" as Route, label: "Búsqueda de Fondos", icon: Search },
      {
        href: "/suscripciones" as Route,
        label: "Suscripciones FIP",
        icon: TrendingUp,
      },
      { href: "/asistente" as Route, label: "AI Asistente", icon: Sparkles },
    ],
  },
  {
    id: "documentos",
    label: "Documentos",
    items: [
      { href: "/legal" as Route, label: "Legal", icon: Scale },
      { href: "/reportes" as Route, label: "Reportes", icon: FileBarChart },
    ],
  },
  {
    id: "admin",
    label: "Admin",
    items: [
      { href: "/admin/usuarios" as Route, label: "Usuarios", icon: UserCog },
      { href: "/admin/etl" as Route, label: "ETL Runs", icon: Database },
      {
        href: "/admin/audit" as Route,
        label: "Auditoría de cambios",
        icon: ScrollText,
      },
      {
        href: "/admin/data-quality" as Route,
        label: "Data Quality",
        icon: ShieldCheck,
      },
      {
        href: "/admin/integraciones" as Route,
        label: "Integraciones",
        icon: Plug,
      },
      {
        href: "/admin/digest" as Route,
        label: "Digest CEO",
        icon: Mail,
      },
      {
        href: "/admin/import" as Route,
        label: "Importar CSV",
        icon: Upload,
      },
      {
        href: "/admin/status" as Route,
        label: "Status del sistema",
        icon: Activity,
      },
    ],
  },
];

// Sub-items que aparecen al expandir cada empresa.
const EMPRESA_SUBSECTIONS = [
  { suffix: "", label: "Resumen", icon: Building2 },
  { suffix: "/flujo-mensual", label: "Flujo Mensual", icon: TrendingUp },
  { suffix: "/transacciones", label: "Transacciones", icon: Receipt },
  { suffix: "/categorias", label: "Categorías", icon: Layers },
  { suffix: "/trabajadores", label: "Trabajadores", icon: Users },
  { suffix: "/legal", label: "Legal", icon: Scale },
  { suffix: "/avance", label: "Avance", icon: Target },
  { suffix: "/asistente", label: "AI Asistente", icon: Sparkles },
] as const;

interface AppSidebarProps {
  email: string;
}

export function AppSidebar({ email }: AppSidebarProps) {
  const pathname = usePathname() ?? "";
  const { data: me } = useMe();
  const role = me?.app_role;
  const isAdmin = role === "admin";
  // `ceo` aún no existe en backend (ROLE_SCOPES). Mientras tanto lo tratamos
  // como nivel ejecutivo: ve EJECUTIVO pero NO ve ADMIN.
  const isExecutive = isAdmin || role === "ceo";

  const visibleGroups = GROUPS.filter((g) => {
    if (g.id === "ejecutivo") return isExecutive;
    if (g.id === "admin") return isAdmin;
    return true; // operaciones, estrategia, documentos → todos
  });

  const { data: unread } = useUnreadCount();
  const unreadCount = unread?.unread ?? 0;
  const criticalObligationsCount = useCriticalObligationsCount();

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-hairline bg-white">
      {/* Brand */}
      <div className="border-b border-hairline px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-cehta-green shadow-glass">
            <Sparkles className="h-4 w-4 text-white" strokeWidth={1.5} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold tracking-tight text-ink-900">
              Cehta Capital
            </p>
            <p className="text-xs text-ink-500">FIP CEHTA ESG</p>
          </div>
          <NotificationsBell />
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-2">
        {visibleGroups.map((group) => (
          <div key={group.id}>
            <h3 className="mb-1.5 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
              {group.label}
            </h3>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive =
                  pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
                const showUnreadBadge =
                  String(item.href) === "/notificaciones" &&
                  unreadCount > 0;
                const showCriticalBadge =
                  String(item.href) === "/calendario" &&
                  criticalObligationsCount > 0;
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
                    <span className="flex-1">{item.label}</span>
                    {showUnreadBadge && (
                      <span
                        aria-label={`${unreadCount} sin leer`}
                        className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-negative px-1.5 text-[10px] font-semibold text-white tabular-nums"
                      >
                        {unreadCount > 99 ? "99+" : unreadCount}
                      </span>
                    )}
                    {showCriticalBadge && (
                      <span
                        aria-label={`${criticalObligationsCount} obligaciones vencidas`}
                        title={`${criticalObligationsCount} obligaciones vencidas`}
                        className="inline-flex min-w-[20px] items-center justify-center rounded-full bg-negative px-1.5 text-[10px] font-semibold text-white tabular-nums"
                      >
                        {criticalObligationsCount > 99
                          ? "99+"
                          : criticalObligationsCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
            {/* Empresas list — solo dentro del grupo "operaciones" */}
            {group.id === "operaciones" && <EmpresasNav pathname={pathname} />}
          </div>
        ))}
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

/**
 * EmpresasNav — sub-grupo dinámico que lista las 9 empresas del portfolio.
 * Cada empresa es expandible con sus 5 sub-secciones.
 */
function EmpresasNav({ pathname }: { pathname: string }) {
  const { data: empresas, isLoading } = useCatalogoEmpresas();
  const [expanded, setExpanded] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("sidebar-empresa-expanded");
  });

  // Auto-expand si el pathname coincide con alguna empresa
  useEffect(() => {
    const match = /^\/empresa\/([^/]+)/.exec(pathname);
    if (match && match[1] && expanded !== match[1]) {
      setExpanded(match[1]);
    }
  }, [pathname, expanded]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (expanded) {
      localStorage.setItem("sidebar-empresa-expanded", expanded);
    } else {
      localStorage.removeItem("sidebar-empresa-expanded");
    }
  }, [expanded]);

  if (isLoading) {
    return (
      <>
        <h3 className="mb-1.5 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
          Empresas
        </h3>
        <div className="space-y-0.5">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="mx-3 my-1 h-7 animate-pulse rounded-xl bg-ink-100/40"
            />
          ))}
        </div>
      </>
    );
  }

  if (!empresas || empresas.length === 0) return null;

  return (
    <>
      <h3 className="mb-1.5 mt-4 px-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-300">
        Empresas
      </h3>
      <div className="space-y-0.5">
        {empresas.map((emp) => {
          const isExpanded = expanded === emp.codigo;
          const isActive = pathname.startsWith(`/empresa/${emp.codigo}`);
          const Chevron = isExpanded ? ChevronDown : ChevronRight;
          return (
            <div key={emp.codigo}>
              <button
                type="button"
                onClick={() =>
                  setExpanded(isExpanded ? null : emp.codigo)
                }
                aria-expanded={isExpanded}
                title={emp.razon_social}
                className={cn(
                  "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors duration-150 ease-apple",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                  isActive
                    ? "bg-cehta-green/10 text-cehta-green"
                    : "text-ink-700 hover:bg-cehta-green/5 hover:text-cehta-green",
                )}
              >
                <Chevron
                  className="h-3.5 w-3.5 shrink-0 text-ink-300"
                  strokeWidth={2}
                />
                <Building2 className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                <span className="flex-1 truncate text-left">{emp.codigo}</span>
              </button>
              {isExpanded && (
                <div className="ml-2 mt-0.5 space-y-0.5 border-l border-hairline pl-3">
                  {EMPRESA_SUBSECTIONS.map((sec) => {
                    const Icon = sec.icon;
                    const href = `/empresa/${emp.codigo}${sec.suffix}` as Route;
                    const subActive =
                      pathname === href ||
                      (sec.suffix !== "" && pathname.startsWith(`${href}/`));
                    return (
                      <Link
                        key={sec.suffix}
                        href={href}
                        aria-current={subActive ? "page" : undefined}
                        className={cn(
                          "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors duration-150 ease-apple",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                          subActive
                            ? "bg-cehta-green/15 text-cehta-green font-medium"
                            : "text-ink-500 hover:bg-cehta-green/5 hover:text-cehta-green",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" strokeWidth={1.5} />
                        {sec.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

