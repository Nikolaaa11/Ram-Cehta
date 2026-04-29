import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { OcActions } from "@/components/ordenes-compra/OcActions";
import { EntityHistoryDrawer } from "@/components/audit/EntityHistoryDrawer";
import { serverApiGet } from "@/lib/api/server";
import { ApiError } from "@/lib/api/client";
import { toCLP, toDate } from "@/lib/format";
import type { OcRead } from "@/lib/api/schema";

type BadgeVariant = "success" | "danger" | "warning" | "neutral" | "info";

const ESTADO_VARIANT: Record<string, BadgeVariant> = {
  borrador: "neutral",
  emitida: "info",
  pagada: "success",
  parcial: "warning",
  pendiente: "warning",
  aprobada: "info",
  anulada: "danger",
  rechazada: "danger",
};

function EstadoBadge({ estado }: { estado: string }) {
  const variant = ESTADO_VARIANT[estado.toLowerCase()] ?? "neutral";
  return (
    <Badge variant={variant} className="capitalize">
      {estado}
    </Badge>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <dt className="text-xs uppercase tracking-wide text-ink-500 font-medium">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink-900">{children}</dd>
    </div>
  );
}

export default async function OcDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ocId = Number(id);
  if (!Number.isInteger(ocId) || ocId <= 0) notFound();

  let oc: OcRead | null = null;
  let fetchError: string | null = null;

  try {
    oc = await serverApiGet<OcRead>(`/ordenes-compra/${ocId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    fetchError = err instanceof Error ? err.message : "Error desconocido";
  }

  if (fetchError || !oc) {
    return (
      <div className="space-y-6">
        <Link
          href="/ordenes-compra"
          className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Volver a OCs
        </Link>
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            No se pudo cargar la OC
          </p>
          <p className="mt-1 text-xs text-negative/80">{fetchError}</p>
        </Surface>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/ordenes-compra"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        Volver a OCs
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            OC {oc.numero_oc}
          </h1>
          <p className="mt-1 text-sm text-ink-500 tabular-nums">
            {oc.empresa_codigo} · Emitida {toDate(oc.fecha_emision)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          <div className="flex items-center gap-3">
            <EstadoBadge estado={oc.estado} />
            {oc.pdf_url && (
              <a
                href={oc.pdf_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-cehta-green hover:underline"
              >
                Ver PDF
                <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
              </a>
            )}
          </div>
          <div className="flex items-center gap-2">
            <EntityHistoryDrawer
              entityType="orden_compra"
              entityId={String(oc.oc_id)}
            />
            <OcActions
              ocId={oc.oc_id}
              numeroOc={oc.numero_oc}
              allowedActions={oc.allowed_actions ?? []}
            />
          </div>
        </div>
      </header>

      {/* KPI cards */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Surface>
          <p className="text-xs uppercase tracking-wide text-ink-500 font-medium">
            Neto
          </p>
          <p className="mt-1.5 text-kpi-sm font-display text-ink-900 tabular-nums">
            {toCLP(oc.neto)}
          </p>
        </Surface>
        <Surface>
          <p className="text-xs uppercase tracking-wide text-ink-500 font-medium">
            IVA
          </p>
          <p className="mt-1.5 text-kpi-sm font-display text-ink-900 tabular-nums">
            {toCLP(oc.iva)}
          </p>
        </Surface>
        <Surface className="ring-cehta-green/20 bg-cehta-green/[0.04]">
          <p className="text-xs uppercase tracking-wide text-ink-500 font-medium">
            Total
          </p>
          <p className="mt-1.5 text-kpi-sm font-display text-cehta-green tabular-nums">
            {toCLP(oc.total)}
          </p>
        </Surface>
      </section>

      {/* Detalle */}
      <Surface>
        <Surface.Header divider>
          <Surface.Title>Detalle</Surface.Title>
        </Surface.Header>
        <Surface.Body>
          <dl className="grid grid-cols-1 gap-5 text-sm sm:grid-cols-2">
            <Field label="Proveedor">
              {oc.proveedor_id ? (
                <Link
                  href={`/proveedores/${oc.proveedor_id}`}
                  className="text-cehta-green hover:underline"
                >
                  Proveedor #{oc.proveedor_id}
                </Link>
              ) : (
                <span className="text-ink-300">—</span>
              )}
            </Field>
            <Field label="Moneda">{oc.moneda}</Field>
            <Field label="Validez">{oc.validez_dias} días</Field>
            <Field label="Forma de pago">
              {oc.forma_pago ?? <span className="text-ink-300">—</span>}
            </Field>
            <Field label="Plazo">
              {oc.plazo_pago ?? <span className="text-ink-300">—</span>}
            </Field>
            <Field label="Observaciones" className="sm:col-span-2">
              {oc.observaciones ? (
                <span className="whitespace-pre-wrap">{oc.observaciones}</span>
              ) : (
                <span className="text-ink-300">—</span>
              )}
            </Field>
          </dl>
        </Surface.Body>
      </Surface>

      {/* Items */}
      {oc.items && oc.items.length > 0 && (
        <Surface padding="none" className="overflow-hidden">
          <div className="border-b border-hairline px-6 py-4">
            <h2 className="text-base font-semibold tracking-tight text-ink-900">
              Ítems
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-hairline text-sm">
              <thead className="bg-ink-100/40">
                <tr>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-ink-500 font-medium">
                    #
                  </th>
                  <th className="px-4 py-3 text-left text-xs uppercase tracking-wide text-ink-500 font-medium">
                    Descripción
                  </th>
                  <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-ink-500 font-medium">
                    P. Unitario
                  </th>
                  <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-ink-500 font-medium">
                    Cantidad
                  </th>
                  <th className="px-4 py-3 text-right text-xs uppercase tracking-wide text-ink-500 font-medium">
                    Total línea
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {oc.items.map((it) => (
                  <tr
                    key={it.detalle_id}
                    className="transition-colors duration-150 hover:bg-ink-100/30"
                  >
                    <td className="px-4 py-3 text-ink-500 tabular-nums">
                      {it.item}
                    </td>
                    <td className="px-4 py-3 text-ink-900">
                      {it.descripcion}
                    </td>
                    <td className="px-4 py-3 text-right text-ink-900 tabular-nums">
                      {toCLP(it.precio_unitario)}
                    </td>
                    <td className="px-4 py-3 text-right text-ink-900 tabular-nums">
                      {it.cantidad}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-ink-900 tabular-nums">
                      {toCLP(it.total_linea)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}
    </div>
  );
}
