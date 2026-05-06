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
import { LayoutDashboard, FileText, Inbox, ShoppingCart, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: Route;
  label: string;
  icon: typeof LayoutDashboard;
  /** Match prefix p.ej. /vouchers/123 → /vouchers activo. */
  matchPrefix: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard" as Route,
    label: "Dashboard",
    icon: LayoutDashboard,
    matchPrefix: "/dashboard",
  },
  {
    href: "/vouchers" as Route,
    label: "Vouchers",
    icon: Receipt,
    matchPrefix: "/vouchers",
  },
  {
    href: "/admin/mailbox" as Route,
    label: "Mailbox",
    icon: Inbox,
    matchPrefix: "/admin/mailbox",
  },
  {
    href: "/ordenes-compra" as Route,
    label: "OC",
    icon: ShoppingCart,
    matchPrefix: "/ordenes-compra",
  },
  {
    href: "/f22" as Route,
    label: "F22",
    icon: FileText,
    matchPrefix: "/f22",
  },
];

export function MobileBottomNav() {
  const pathname = usePathname();

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
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors",
                  "min-h-[3rem]",  // touch target ≥48px
                  active
                    ? "text-cehta-green"
                    : "text-ink-500 active:text-ink-900 dark:active:text-ink-100",
                )}
                aria-current={active ? "page" : undefined}
              >
                <Icon
                  className="h-5 w-5"
                  strokeWidth={active ? 2.25 : 1.75}
                />
                <span className="tracking-tight">{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
