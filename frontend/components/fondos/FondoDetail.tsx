"use client";

import { X, ExternalLink, Mail, Linkedin } from "lucide-react";
import { useApiQuery } from "@/hooks/use-api-query";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import type { FondoRead } from "@/lib/api/schema";

const ESTADO_LABEL: Record<string, string> = {
  no_contactado: "No contactado",
  contactado: "Contactado",
  en_negociacion: "En negociación",
  cerrado: "Cerrado",
  descartado: "Descartado",
};

interface Props {
  fondoId: number;
  onClose: () => void;
}

export function FondoDetail({ fondoId, onClose }: Props) {
  const { data, isLoading } = useApiQuery<FondoRead>(
    ["fondo", String(fondoId)],
    `/fondos/${fondoId}`,
  );

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-ink-900/40 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Cerrar"
      />
      <div className="relative z-10 flex h-full w-full max-w-md flex-col overflow-hidden bg-white shadow-card-hover">
        <div className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <h3 className="font-display text-base font-semibold text-ink-900">
            {data?.nombre ?? "Detalle de fondo"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-500 hover:bg-ink-100/40"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading || !data ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Badge variant="info">{data.tipo}</Badge>
                <Badge variant="neutral" className="ml-2">
                  {ESTADO_LABEL[data.estado_outreach] ?? data.estado_outreach}
                </Badge>
              </div>

              {data.descripcion && (
                <p className="text-sm text-ink-700">{data.descripcion}</p>
              )}

              <DefRow label="País / Región">
                {[data.pais, data.region].filter(Boolean).join(" · ") || "—"}
              </DefRow>

              <DefRow label="Ticket size">
                {data.ticket_min_usd != null && data.ticket_max_usd != null
                  ? `${data.ticket_min_usd} – ${data.ticket_max_usd} USD`
                  : data.ticket_min_usd != null
                    ? `≥ ${data.ticket_min_usd} USD`
                    : data.ticket_max_usd != null
                      ? `≤ ${data.ticket_max_usd} USD`
                      : "—"}
              </DefRow>

              <DefRow label="Sectores">
                <div className="flex flex-wrap gap-1">
                  {(data.sectores ?? []).map((s) => (
                    <Badge key={s} variant="neutral">
                      {s}
                    </Badge>
                  ))}
                  {!data.sectores?.length && <span className="text-sm">—</span>}
                </div>
              </DefRow>

              <DefRow label="Stage">
                <div className="flex flex-wrap gap-1">
                  {(data.stage ?? []).map((s) => (
                    <Badge key={s} variant="info">
                      {s}
                    </Badge>
                  ))}
                  {!data.stage?.length && <span className="text-sm">—</span>}
                </div>
              </DefRow>

              {data.thesis && (
                <DefRow label="Thesis">
                  <p className="text-sm text-ink-700">{data.thesis}</p>
                </DefRow>
              )}

              <DefRow label="Contacto">
                <div className="space-y-1 text-sm">
                  {data.contacto_nombre && <p>{data.contacto_nombre}</p>}
                  {data.contacto_email && (
                    <a
                      href={`mailto:${data.contacto_email}`}
                      className="inline-flex items-center gap-1 text-cehta-green hover:underline"
                    >
                      <Mail className="h-3 w-3" strokeWidth={1.5} />
                      {data.contacto_email}
                    </a>
                  )}
                  {data.contacto_linkedin && (
                    <a
                      href={data.contacto_linkedin}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sf-blue hover:underline"
                    >
                      <Linkedin className="h-3 w-3" strokeWidth={1.5} />
                      LinkedIn
                    </a>
                  )}
                  {!data.contacto_nombre &&
                    !data.contacto_email &&
                    !data.contacto_linkedin && <p className="text-ink-500">—</p>}
                </div>
              </DefRow>

              {data.website && (
                <DefRow label="Website">
                  <a
                    href={data.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-cehta-green hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" strokeWidth={1.5} />
                    {data.website}
                  </a>
                </DefRow>
              )}

              {data.notas && (
                <DefRow label="Notas">
                  <p className="text-sm text-ink-700 whitespace-pre-wrap">
                    {data.notas}
                  </p>
                </DefRow>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DefRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-ink-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-ink-900">{children}</dd>
    </div>
  );
}
