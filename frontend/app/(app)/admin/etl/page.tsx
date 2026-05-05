import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft } from "lucide-react";
import { EtlRunsTable } from "@/components/admin/EtlRunsTable";
import { RunEtlButton } from "@/components/admin/RunEtlButton";
import { RegenerateAlertsButton } from "@/components/admin/RegenerateAlertsButton";
import { ImportPlanCuentasButton } from "@/components/admin/ImportPlanCuentasButton";
import { SeedVouchersDemoButton } from "@/components/admin/SeedVouchersDemoButton";

export default function AdminEtlPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link
            href={"/admin" as Route}
            className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            Panel admin
          </Link>
          <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
            ETL & Alertas
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            Sincronización Dropbox + EEFF cross-empresa + regenerado de
            alertas. Los crons corren cada hora — los botones fuerzan el
            refresh on-demand.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ImportPlanCuentasButton />
          <SeedVouchersDemoButton />
          <RegenerateAlertsButton />
          <RunEtlButton />
        </div>
      </div>

      {/* Hint editorial — qué hace cada botón */}
      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-hairline bg-ink-50/40 p-5 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Importar plan de cuentas
          </p>
          <p className="mt-1.5 text-xs text-ink-600">
            Subí el Plan_de_cuentas_v2.xlsx para cargar/actualizar las 469
            cuentas + habilitación por empresa. Idempotente: re-correr con el
            mismo archivo no duplica. Hay que correrlo una vez al inicio y
            luego cada vez que el contador externo actualice el plan.
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Refrescar alertas
          </p>
          <p className="mt-1.5 text-xs text-ink-600">
            Re-escanea F29 que vencen en ≤7d, contratos en ≤30d, OCs estancadas y
            entregables regulatorios. Idempotente: no spamea si lo ejecutás 2
            veces seguidas (dedup 24h).
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cehta-green">
            Ejecutar ETL
          </p>
          <p className="mt-1.5 text-xs text-ink-600">
            Pull de Data Madre.xlsx desde Dropbox + sync de Estados Financieros
            de las 9 empresas portfolio. Si Dropbox no cambió, termina en
            &ldquo;skipped&rdquo; sin tocar la DB.
          </p>
        </div>
      </div>

      <EtlRunsTable />
    </div>
  );
}
