"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";

interface ReportShellProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  filters?: ReactNode;
  children: ReactNode;
}

export function ReportShell({
  title,
  subtitle,
  actions,
  filters,
  children,
}: ReportShellProps) {
  return (
    <div className="mx-auto max-w-[1440px] px-6 lg:px-10 py-6 space-y-6">
      <Link
        href="/reportes"
        className="inline-flex items-center gap-1 text-xs text-ink-500 transition-colors hover:text-cehta-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green rounded-md"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
        Volver a Reportes
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
            {title}
          </h1>
          {subtitle ? (
            <p className="mt-1 text-sm text-ink-500">{subtitle}</p>
          ) : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>

      {filters ?? null}

      {children}
    </div>
  );
}
