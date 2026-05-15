"use client";

/**
 * MobileBottomNav — V5++ ola Z.
 *
 * Tab bar fija al fondo en mobile (<md). 5 destinos primarios siempre
 * a un toque, evitando abrir el drawer del sidebar para navegar entre
 * páginas frecuentes.
 *
 * Incluye `safe-area-inset-bottom` para respetar el home bar de iPhone.
 * Auto-resalta el tab activo según `pathname`.
 *
 * Hidden en print + en desktop. La FAB (QuickActionsFab) sigue activa
 * y ofrece acciones secundarias; este nav cubre navegación entre las
 * 5 páginas más usadas.
 */
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FileSignature,
  Inbox,
  Receipt,
  Bell,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSidebarState } from "@/hooks/use-sidebar-state";

interface NavItem {
  href: Route;
  label: string;
  icon: typeof LayoutDashboard;
  /** Match prefix p.ej. /vouchers/123 → /vouchers activo. */
  matchPrefix: string;
  /** Si está presente, lee este campo del sidebar-state para badge */
  badgeKey?:
    | "voucher_pending_approvals"
    | "voucher_drafts_mine"
    | "mailbox_pending"
    | "voucher_total";
}

// Etapa L — 5 destinos optimizados para uso diario del modulo voucher:
// reemplazado F22 (uso anual) por Aprobaciones y Transferencias.
const NAV_ITEMS: NavItem[] = [
  {
    href: "/mis-pendientes" as Route,
    label: "Pendientes",
    icon: Bell,
    matchPrefix: "/mis-pendientes",
    badgeKey: "voucher_total", // drafts + pending
  },
  {
    href: "/aprobaciones" as Route,
    label: "Firmar",
    icon: FileSignature,
    matchPrefix: "/aprobaciones",
    badgeKey: "voucher_pending_approvals",
  },
  {
    href: "/vouchers" as Route,
    label: "Vouchers",
    icon: Receipt,
    matchPrefix: "/vouchers",
  },
  {
    href: "/transferencias" as Route,
    label: "Pagos",
    icon: Wallet,
    matchPrefix: "/transferencias",
  },
  {
    href: "/dashboard" as Route,
    label: "Inicio",
    icon: LayoutDashboard,
    matchPrefix: "/dashboard",
  },
];

export function MobileBottomNav() {
  const pathname = usePathname();
  const { data: state } = useSidebarState();

  const getBadge = (key?: NavItem["badgeKey"]): number => {
    if (!state || !key) return 0;
    if (key === "voucher_total") {
      return (
        (state.voucher_drafts_mine ?? 0) +
        (state.voucher_pending_approvals ?? 0)
      );
    }
    return (state[key] as number) ?? 0;
  };

  return (
    <nav
      aria-label="Navegación primaria"
      className={cn(
        "fixed bottom-0 left-0 right-0 z-30 border-t border-hairline bg-white/95 backdrop-blur-md",
        "dark:border-ink-800 dark:bg-ink-950/95",
        "md:hidden print:hidden",
        // iOS safe area inset bottom (home bar)
        "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <ul className="grid grid-cols-5">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active =
            pathname === item.matchPrefix ||
            pathname.startsWith(`${item.matchPrefix}/`);
          const badge = getBadge(item.badgeKey);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                  "min-h-[3rem]",  // touch target ≥48px
                  active
                    ? "text-cehta-green"
                    : "text-ink-500 active:text-ink-900 dark:active:text-ink-100",
                )}
                aria-current={active ? "page" : undefined}
              >
                <div className="relative">
                  <Icon
                    className="h-5 w-5"
                    strokeWidth={active ? 2.25 : 1.75}
                  />
                  {badge > 0 && (
                    <span
                      className="absolute -top-1.5 -right-2 inline-flex min-w-[16px] items-center justify-center rounded-full bg-cehta-green px-1 text-[9px] font-semibold text-white tabular-nums leading-tight"
                      aria-label={`${badge} pendientes`}
                    >
                      {badge > 99 ? "99+" : badge}
                    </span>
                  )}
                </div>
                <span className="tracking-tight">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
