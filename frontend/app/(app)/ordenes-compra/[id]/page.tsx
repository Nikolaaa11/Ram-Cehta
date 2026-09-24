import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { OcActions } from "@/components/ordenes-compra/OcActions";
import { OcCuotasSection } from "@/components/ordenes-compra/OcCuotasSection";
import { OcFirmasSection } from "@/components/ordenes-compra/OcFirmasSection";
import { OcAnexosSection } from "@/components/ordenes-compra/OcAnexosSection";
import { OcDecimalesToggle } from "@/components/ordenes-compra/OcDecimalesToggle";
import { CrearVoucherDesdeOcButton } from "@/components/vouchers/VoucherDesdeOc";
import { EntityHistoryDrawer } from "@/components/audit/EntityHistoryDrawer";
import { MonedaDisplay } from "@/components/shared/MonedaDisplay";
import { FileLink } from "@/components/shared/FileLink";
import { limpiarCeros } from "@/lib/oc/pegar-items";
import { importeLinea, montoLinea, precioUnitario } from "@/lib/oc/itemizado";
import { serverApiGet } from "@/lib/api/server";
import { ApiError } from "@/lib/api/client";
import { toCLP, toDate, toDateTimeCL } from "@/lib/format";
import { ocStatusLabel } from "@/lib/voucher-status";
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

/**
 * Etiquetas en castellano de los 4 tipos del catálogo SII. El token crudo es
 * el fallback a propósito: antes esto era un ternario binario y una
 * FACTURA_EXENTA se imprimía como "Factura". Mejor mostrar el token feo que
 * mentir sobre el documento tributario.
 */
const TIPO_DOCUMENTO_LABEL: Record<string, string> = {
  FACTURA: "Factura",
  FACTURA_EXENTA: "Factura exenta",
  BOLETA: "Boleta",
  HONORARIOS: "Boleta de honorarios",
};

function EstadoBadge({ estado }: { estado: string }) {
  // R152CCCCCC — Localizar via ocStatusLabel. Antes mostraba el estado
  // crudo capitalizado, lo que con valores backend en uppercase inglés
  // (DRAFT/PENDING/APPROVED) confundía al user. Ahora siempre vemos:
  // "Borrador" / "Pendiente firma" / "Pagada" / etc.
  const variant = ESTADO_VARIANT[estado.toLowerCase()] ?? "neutral";
  return (
    <Badge variant={variant}>
      {ocStatusLabel(estado)}
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

  // §3.1 del megaprompt de honorarios: `total` es el VALOR DEL CONTRATO
  // (neto + IVA) y `total_a_pagar` es la PLATA QUE SALE. Sólo difieren cuando
  // hay retención. Los `??` son defensivos: entre el deploy del frontend y la
  // migración, el backend todavía no manda los campos nuevos.
  const totalContrato = Number(oc.total ?? 0);
  const retencionMonto = Number(oc.retencion_monto ?? 0);
  const totalAPagar = Number(oc.total_a_pagar ?? totalContrato);
  const esHonorarios = oc.tipo_documento === "HONORARIOS";
  const esExenta = oc.tipo_documento === "FACTURA_EXENTA";
  const monedaKpi =
    oc.moneda === "UF" || oc.moneda === "USD" ? oc.moneda : "CLP";
  // Interruptor de la OC (`mostrar_decimales`): si el precio unitario se
  // muestra como es ($67.142,86) o redondeado a peso ($67.143). `!== false`
  // y no `?? true`: en la ventana entre el deploy del frontend y el del
  // backend el campo no viene, y el default es con decimales.
  const conDecimales = oc.mostrar_decimales !== false;

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
              <FileLink
                url={oc.pdf_url}
                label="Ver PDF"
                variant="inline"
                showDomain
              />
            )}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <EntityHistoryDrawer
              entityType="orden_compra"
              entityId={String(oc.oc_id)}
            />
            {/* Va fuera de OcActions a propósito: no depende de
                `allowed_actions` (que es sobre la OC) sino de si esta OC ya
                generó voucher. Si lo tiene, el botón lleva AL QUE EXISTE —
                un voucher duplicado sobre la misma OC es un pago duplicado
                esperando. Cliente, porque tiene que consultar los hitos. */}
            <CrearVoucherDesdeOcButton
              ocId={oc.oc_id}
              numeroOc={oc.numero_oc}
              estado={oc.estado}
            />
            <OcActions
              ocId={oc.oc_id}
              numeroOc={oc.numero_oc}
              estado={oc.estado}
              allowedActions={oc.allowed_actions ?? []}
            />
          </div>
        </div>
      </header>

      {/* Constancia de "pagada sin todas las firmas" (2026-09-21). Se guarda
          en la misma transacción que el cambio de estado; acá se muestra
          para que nadie crea que la OC se firmó completa. */}
      <PagoSinFirmasAviso constancia={oc.pago_sin_firmas} />

      {/* KPI cards — el bloque cambia según el tipo de documento, no son
          filas escondidas. La card verde es SIEMPRE la plata que se gira:
          con honorarios eso es el líquido, no el bruto. */}
      <section
        className={`grid grid-cols-1 gap-4 ${
          esExenta ? "sm:grid-cols-2" : "sm:grid-cols-3"
        }`}
      >
        <Surface>
          <p className="text-xs uppercase tracking-wide text-ink-500 font-medium">
            {esHonorarios
              ? "Honorarios brutos"
              : esExenta
                ? "Neto exento"
                : "Neto"}
          </p>
          <p className="mt-1.5 text-kpi-sm font-display text-ink-900 tabular-nums">
            {toCLP(oc.neto)}
          </p>
        </Surface>
        {esHonorarios ? (
          <Surface>
            <p className="text-xs uppercase tracking-wide text-ink-500 font-medium">
              Retención{" "}
              {oc.retencion_porcentaje != null
                ? `${oc.retencion_porcentaje}%`
                : ""}
            </p>
            <p className="mt-1.5 text-kpi-sm font-display text-negative tabular-nums">
              − {toCLP(retencionMonto)}
            </p>
            <p className="mt-1 text-[11px] text-ink-400">
              La entera la empresa al SII
            </p>
          </Surface>
        ) : (
          !esExenta && (
            <Surface>
              <p className="text-xs uppercase tracking-wide text-ink-500 font-medium">
                IVA {oc.iva_porcentaje != null ? `${oc.iva_porcentaje}%` : ""}
              </p>
              <p className="mt-1.5 text-kpi-sm font-display text-ink-900 tabular-nums">
                {toCLP(oc.iva)}
              </p>
            </Surface>
          )
        )}
        <Surface className="ring-cehta-green/20 bg-cehta-green/[0.04]">
          <p className="text-xs uppercase tracking-wide text-ink-500 font-medium">
            {esHonorarios ? "Líquido a pagar" : "Total"}
          </p>
          <p className="mt-1.5 text-kpi-sm font-display text-cehta-green tabular-nums">
            <MonedaDisplay amount={totalAPagar} currency={monedaKpi} />
          </p>
          {esHonorarios && (
            <p className="mt-1 text-[11px] text-ink-400">
              Sobre un bruto contratado de {toCLP(totalContrato)}
            </p>
          )}
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
            <Field label="Tipo de documento">
              {TIPO_DOCUMENTO_LABEL[oc.tipo_documento] ?? oc.tipo_documento}
            </Field>
            <Field label="Dirigido a">
              {oc.atte_nombre ? (
                <>
                  {oc.atte_nombre}
                  {oc.atte_cargo ? ` — ${oc.atte_cargo}` : ""}
                </>
              ) : (
                <span className="text-ink-300">—</span>
              )}
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
          <div className="flex flex-col gap-3 border-b border-hairline px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
            <h2 className="text-base font-semibold tracking-tight text-ink-900">
              Ítems
            </h2>
            {/* Con decimales / sin decimales en el precio unitario. Cliente:
                el server component no puede mutar. Se renderiza a sí mismo
                como null en UF/USD, en OC anuladas y sin permiso. */}
            <OcDecimalesToggle
              ocId={ocId}
              numeroOc={oc.numero_oc}
              moneda={oc.moneda}
              estado={oc.estado}
              mostrarDecimales={conDecimales}
            />
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
                      {/* Con decimales si los tiene: un precio neto sacado de
                          un total con IVA es $67.142,86, y redondeado no
                          cuadra al multiplicarlo por la cantidad. */}
                      {precioUnitario(
                        it.precio_unitario,
                        oc.moneda,
                        conDecimales,
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-ink-900 tabular-nums">
                      {/* `cantidad` es NUMERIC(18,4) en BD y la API la manda
                          como "50.0000". Impresa cruda, una cantidad entera
                          se veía con cuatro decimales que nadie escribió.
                          El PDF ya lo resolvía con "%g"; la pantalla no. */}
                      {limpiarCeros(String(it.cantidad))}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-ink-900 tabular-nums">
                      {/* Fallback calculado: hasta el 2026-09-22 el backend
                          nunca guardaba `total_linea`, y las OC de antes
                          siguen con la columna en NULL. Sin esto la ficha
                          imprime "$0" en cada línea con el total correcto
                          abajo — el "no suman" que reportó Nicolás. */}
                      {montoLinea(importeLinea(it, oc.moneda), oc.moneda)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>
      )}

      {/* Anexos (2026-09-21) — van antes de Firmas: salen al final del PDF,
          así que son parte de lo que se firma. Cliente. */}
      <OcAnexosSection ocId={ocId} estado={oc.estado} />

      {/* OC-FIRMANTES-EXTERNOS — picker de firmantes (equipo + externos).
          Va antes de Cuotas porque en el flujo real primero se firma la OC y
          recién con la factura se arman las cuotas. Cliente. */}
      <Surface>
        <OcFirmasSection ocId={ocId} empresaCodigo={oc.empresa_codigo} />
      </Surface>

      {/* R152yyy — Sección Cuotas + generar vouchers DRAFT. Cliente.
          Los hitos se reparten sobre `total_a_pagar`, no sobre `total`: son
          transferencias, y con honorarios el bruto incluye plata que nunca
          sale de la empresa (se entera al SII). Regla §3.1. */}
      <Surface>
        <OcCuotasSection ocId={ocId} totalOc={totalAPagar} />
      </Surface>
    </div>
  );
}


function PagoSinFirmasAviso({
  constancia,
}: {
  constancia?: { [key: string]: unknown } | null;
}) {
  if (!constancia) return null;
  const texto = (k: string) =>
    typeof constancia[k] === "string" ? (constancia[k] as string) : "";
  const pendientes = Array.isArray(constancia.firmas_pendientes)
    ? (constancia.firmas_pendientes as unknown[]).map(String)
    : [];
  const cuando = texto("el");
  return (
    <div
      role="note"
      className="rounded-2xl bg-warning/10 p-4 text-sm text-ink-800 ring-1 ring-warning/30"
    >
      <p className="font-medium text-ink-900">
        Marcada {texto("estado_nuevo") || "pagada"} sin todas las firmas
      </p>
      {pendientes.length > 0 && (
        <p className="mt-1">
          No firmaron: <span className="font-medium">{pendientes.join(", ")}</span>.
        </p>
      )}
      {texto("motivo") && (
        <p className="mt-1">
          Motivo: <span className="italic">«{texto("motivo")}»</span>
        </p>
      )}
      <p className="mt-1 text-xs text-ink-500">
        {texto("por_email") ? `Registrado por ${texto("por_email")}` : "Registrado"}
        {cuando ? ` el ${toDateTimeCL(cuando)} (hora de Chile)` : ""}.
      </p>
    </div>
  );
}
