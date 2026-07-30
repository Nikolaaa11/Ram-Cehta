import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, Landmark, MessageCircle } from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import { ProveedorActions } from "@/components/proveedores/ProveedorActions";
import { ProveedorContactosPanel } from "@/components/proveedores/ProveedorContactosPanel";
import { serverApiGet } from "@/lib/api/server";
import { ApiError } from "@/lib/api/client";
import { toDateTime } from "@/lib/format";
import { buildWaLink, waMessages } from "@/lib/whatsapp";
import type { ProveedorRead } from "@/lib/api/schema";

function Field({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-ink-500 font-medium">
        {label}
      </dt>
      <dd
        className={`mt-1 text-sm text-ink-900 ${mono ? "font-mono tabular-nums" : ""}`}
      >
        {value || <span className="text-ink-300">—</span>}
      </dd>
    </div>
  );
}

export default async function ProveedorDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const proveedorId = Number(id);
  if (!Number.isInteger(proveedorId) || proveedorId <= 0) notFound();

  let proveedor: ProveedorRead | null = null;
  let fetchError: string | null = null;

  try {
    proveedor = await serverApiGet<ProveedorRead>(`/proveedores/${proveedorId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    fetchError = err instanceof Error ? err.message : "Error desconocido";
  }

  if (fetchError || !proveedor) {
    return (
      <div className="space-y-6">
        <Link
          href="/proveedores"
          className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-900"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
          Volver a proveedores
        </Link>
        <Surface className="bg-negative/5 ring-negative/20">
          <p className="text-sm font-medium text-negative">
            No se pudo cargar el proveedor
          </p>
          <p className="mt-1 text-xs text-negative/80">{fetchError}</p>
        </Surface>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href="/proveedores"
        className="inline-flex items-center gap-1.5 text-sm text-ink-500 transition-colors hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.5} />
        Volver a proveedores
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-ink-900">
            {proveedor.razon_social}
          </h1>
          <p className="mt-1 text-sm text-ink-500">
            {proveedor.rut ? "Proveedor registrado" : "Sin RUT registrado"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {proveedor.rut && (
            <Badge variant="neutral" className="font-mono tabular-nums">
              RUT {proveedor.rut}
            </Badge>
          )}
          <ProveedorActions
            proveedorId={proveedor.proveedor_id}
            razonSocial={proveedor.razon_social}
          />
        </div>
      </header>

      <Surface>
        <Surface.Header divider>
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-ink-500" strokeWidth={1.5} />
            <Surface.Title>Datos generales</Surface.Title>
          </div>
        </Surface.Header>
        <Surface.Body>
          <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Field label="Giro" value={proveedor.giro} />
            <Field label="Dirección" value={proveedor.direccion} />
            <Field label="Ciudad" value={proveedor.ciudad} />
            <Field label="Contacto" value={proveedor.contacto} />
            <Field label="Teléfono" value={proveedor.telefono} mono />
            <Field label="Email" value={proveedor.email} />
          </dl>
          {/* Round 8 QA — botón WhatsApp si hay telefono valido. wa.me
              link abre WhatsApp con saludo prearmado. Funciona en mobile
              + desktop con WhatsApp Web. */}
          {(() => {
            const wa = buildWaLink(
              proveedor.telefono,
              waMessages.contactarProveedor({
                contacto: proveedor.contacto,
                asunto: `el proveedor "${proveedor.razon_social}"`,
              }),
            );
            if (!wa) return null;
            return (
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-[#25D366] px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-[#1FB453]"
                title="Abre WhatsApp con mensaje pre-llenado para el contacto"
              >
                <MessageCircle className="size-3.5" strokeWidth={2.5} />
                Enviar WhatsApp
              </a>
            );
          })()}
        </Surface.Body>
      </Surface>

      <ProveedorContactosPanel
        proveedorId={proveedor.proveedor_id}
        razonSocial={proveedor.razon_social}
      />

      <Surface>
        <Surface.Header divider>
          <div className="flex items-center gap-2">
            <Landmark className="h-4 w-4 text-ink-500" strokeWidth={1.5} />
            <Surface.Title>Datos bancarios</Surface.Title>
          </div>
        </Surface.Header>
        <Surface.Body>
          <dl className="grid grid-cols-1 gap-5 sm:grid-cols-3">
            <Field label="Banco" value={proveedor.banco} />
            <Field label="Tipo de cuenta" value={proveedor.tipo_cuenta} />
            <Field
              label="Número de cuenta"
              value={proveedor.numero_cuenta}
              mono
            />
          </dl>
        </Surface.Body>
      </Surface>

      <p className="text-xs text-ink-300 tabular-nums">
        Creado: {toDateTime(proveedor.created_at)}
        {" · "}
        Actualizado: {toDateTime(proveedor.updated_at)}
      </p>
    </div>
  );
}
