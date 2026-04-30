"use client";

/**
 * Suscripciones de acciones FIP CEHTA ESG — listado + edición.
 */
import { useState } from "react";
import { Inbox } from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { useMe } from "@/hooks/use-me";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { EditButton } from "@/components/shared/edit-button";
import { MonedaDisplay } from "@/components/shared/MonedaDisplay";
import { EmpresaLogo } from "@/components/empresa/EmpresaLogo";
import {
  SuscripcionEditDialog,
  type SuscripcionEditable,
} from "@/components/suscripciones/SuscripcionEditDialog";
import { toDate } from "@/lib/format";
import type { Page } from "@/lib/api/schema";

interface SuscripcionRead extends SuscripcionEditable {
  created_at: string;
}

export default function SuscripcionesPage() {
  const { data: me } = useMe();
  const canEdit = me?.allowed_actions?.includes("suscripcion:update") ?? false;

  const { data, isLoading, error, refetch } = useApiQuery<
    Page<SuscripcionRead>
  >(["suscripciones"], "/suscripciones?size=100");

  const [editing, setEditing] = useState<SuscripcionRead | null>(null);
  const items = data?.items ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-ink-900">
          Suscripciones FIP CEHTA ESG
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          {data
            ? `${data.total.toLocaleString("es-CL")} recibo${data.total !== 1 ? "s" : ""}`
            : "Recibos de suscripción de acciones."}
        </p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      )}

      {!isLoading && error && (
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            Error al cargar suscripciones
          </p>
        </Surface>
      )}

      {!isLoading && !error && items.length === 0 && (
        <Surface className="text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60 text-ink-500">
            <Inbox className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <p className="mt-3 text-base font-medium text-ink-900">
            Sin suscripciones registradas
          </p>
        </Surface>
      )}

      {!isLoading && !error && items.length > 0 && (
        <Surface padding="none" className="overflow-hidden">
          <table className="min-w-full divide-y divide-hairline text-sm">
            <thead className="bg-ink-100/40 text-xs uppercase tracking-wide text-ink-500">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Empresa</th>
                <th className="px-4 py-3 text-left font-medium">Recibo</th>
                <th className="px-4 py-3 text-right font-medium">Acciones</th>
                <th className="px-4 py-3 text-right font-medium">Monto CLP</th>
                <th className="px-4 py-3 text-left font-medium">Estado</th>
                <th className="px-4 py-3 text-right font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {items.map((s) => (
                <tr
                  key={s.suscripcion_id}
                  className="transition-colors duration-150 hover:bg-ink-100/30"
                >
                  <td className="px-4 py-3 font-medium text-ink-900">
                    <div className="flex items-center gap-2">
                      <EmpresaLogo empresaCodigo={s.empresa_codigo} size={24} />
                      <span>{s.empresa_codigo}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-ink-700">
                    {toDate(s.fecha_recibo)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-900">
                    {Number(s.acciones_pagadas).toLocaleString("es-CL", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 4,
                    })}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-900">
                    <MonedaDisplay
                      amount={Number(s.monto_clp)}
                      currency="CLP"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={s.firmado ? "success" : "warning"}>
                      {s.firmado ? "Firmado" : "Pendiente firma"}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canEdit && (
                      <EditButton
                        size="sm"
                        variant="soft"
                        label="Editar"
                        onClick={() => setEditing(s)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Surface>
      )}

      {editing && (
        <SuscripcionEditDialog
          open={editing !== null}
          onOpenChange={(o) => !o && setEditing(null)}
          suscripcion={editing}
          onSaved={() => refetch()}
        />
      )}
    </div>
  );
}
