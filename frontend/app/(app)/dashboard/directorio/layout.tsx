"use client";

/**
 * Layout shared para /dashboard/directorio/*
 * Round 152 — Tab bar institucional estilo Blackstone/KKR.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Route } from "next";
import {
  Briefcase,
  CheckSquare,
  LayoutDashboard,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";

const TABS = [
  { href: "/dashboard/directorio", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/directorio/capital", label: "Capital", icon: Wallet },
  { href: "/dashboard/directorio/companies", label: "Companies", icon: Briefcase },
  { href: "/dashboard/directorio/impact", label: "Impact", icon: Sparkles },
  { href: "/dashboard/directorio/compliance", label: "Compliance", icon: CheckSquare },
];

export default function DirectorioLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div>
      {/* TAB BAR */}
      <div className="sticky top-14 z-30 bg-gradient-to-b from-app via-app to-app/80 backdrop-blur-sm border-b border-hairline">
        <div className="mx-auto max-w-[1440px] px-6">
          <nav className="flex items-center gap-1 overflow-x-auto -mb-px">
            {TABS.map((t) => {
              const Icon = t.icon;
              const isActive = pathname === t.href;
              return (
                <Link
                  key={t.href}
                  href={t.href as Route}
                  className={`inline-flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? "border-cehta-green text-cehta-green"
                      : "border-transparent text-ink-500 hover:text-ink-900 hover:border-hairline"
                  }`}
                >
                  <Icon className="size-4" />
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {children}
    </div>
  );
}
