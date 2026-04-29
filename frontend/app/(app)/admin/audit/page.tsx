"use client";

/**
 * Admin → Auditoría.
 *
 * Tabs:
 *   * Cambios (V3 fase 8) — per-action audit trail con diff viewer.
 *   * ETL Runs — histórico de cargas (link al detalle existente en /admin/etl).
 *
 * Solo admin (`audit:read`). El backend rechaza con 403 si no.
 */
import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, ListChecks, Database } from "lucide-react";
import { cn } from "@/lib/utils";
import { AuditActionsTable } from "@/components/audit/AuditActionsTable";
import { EtlRunsTable } from "@/components/admin/EtlRunsTable";

type Tab = "cambios" | "etl";

export default function AdminAuditPage() {
  const [tab, setTab] = useState<Tab>("cambios");

  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div>
        <Link
          href={"/admin" as Route}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Panel admin
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
          Auditoría
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Trazabilidad completa: cada cambio queda registrado con quién, qué,
          cuándo y el diff antes/después. Las corridas de ETL se listan acá
          también.
        </p>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Vistas de auditoría"
        className="inline-flex h-10 items-center rounded-xl bg-ink-100/60 p-1 ring-1 ring-hairline"
      >
        <TabButton
          active={tab === "cambios"}
          onClick={() => setTab("cambios")}
          icon={<ListChecks className="h-3.5 w-3.5" strokeWidth={1.5} />}
          label="Cambios"
        />
        <TabButton
          active={tab === "etl"}
          onClick={() => setTab("etl")}
          icon={<Database className="h-3.5 w-3.5" strokeWidth={1.5} />}
          label="ETL Runs"
        />
      </div>

      {tab === "cambios" && <AuditActionsTable />}
      {tab === "etl" && <EtlRunsTable />}
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function TabButton({ active, onClick, icon, label }: TabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-medium transition-colors duration-150 ease-apple",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
        active
          ? "bg-white text-ink-900 shadow-glass"
          : "text-ink-500 hover:text-ink-900",
      )}
    >
      {icon}
      {label}
    </button>
  );
}
