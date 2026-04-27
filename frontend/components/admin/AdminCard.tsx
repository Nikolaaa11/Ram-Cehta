/**
 * AdminCard — landing card del panel admin.
 *
 * Presentational. Server-component-friendly (no `"use client"`).
 */
import Link from "next/link";
import type { Route } from "next";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { Surface } from "@/components/ui/surface";

interface AdminCardProps {
  href: Route;
  title: string;
  description: string;
  icon: LucideIcon;
  metric?: string;
  metricLabel?: string;
  tone?: "default" | "warning" | "danger";
}

export function AdminCard({
  href,
  title,
  description,
  icon: Icon,
  metric,
  metricLabel,
  tone = "default",
}: AdminCardProps) {
  const iconWrapperTone =
    tone === "warning"
      ? "bg-warning/10 text-warning"
      : tone === "danger"
        ? "bg-negative/10 text-negative"
        : "bg-cehta-green/10 text-cehta-green";

  return (
    <Link href={href} className="group block focus:outline-none">
      <Surface
        variant="interactive"
        className="h-full focus-within:ring-2 focus-within:ring-cehta-green"
      >
        <div className="flex items-start justify-between">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-2xl ${iconWrapperTone}`}
          >
            <Icon className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <ArrowUpRight
            className="h-4 w-4 text-ink-300 transition-transform duration-200 ease-apple group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-cehta-green"
            strokeWidth={1.5}
          />
        </div>

        <div className="mt-5">
          <h3 className="text-base font-semibold tracking-tight text-ink-900">
            {title}
          </h3>
          <p className="mt-1 text-sm text-ink-500">{description}</p>
        </div>

        <div className="mt-6 flex items-baseline gap-2 border-t border-hairline pt-4">
          <span className="font-display text-2xl font-semibold tracking-tight text-ink-900 tabular-nums">
            {metric ?? "—"}
          </span>
          {metricLabel && (
            <span className="text-xs text-ink-500">{metricLabel}</span>
          )}
        </div>
      </Surface>
    </Link>
  );
}
