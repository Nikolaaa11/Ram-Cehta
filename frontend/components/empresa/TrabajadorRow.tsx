"use client";

import Link from "next/link";
import { ChevronRight, FileText, UserMinus } from "lucide-react";
import { useState } from "react";
import { useMe } from "@/hooks/use-me";
import { Badge } from "@/components/ui/badge";

type BadgeVariant = "success" | "danger" | "warning" | "neutral" | "info";
import { MarkInactiveDialog } from "./MarkInactiveDialog";
import { UploadDocumentoDialog } from "./UploadDocumentoDialog";

interface Props {
  trabajador: {
    trabajador_id: number;
    empresa_codigo: string;
    nombre_completo: string;
    rut: string;
    cargo: string | null;
    fecha_ingreso: string;
    fecha_egreso: string | null;
    tipo_contrato: string | null;
    estado: string;
  };
  empresaCodigo: string;
  onChanged: () => void;
}

const ESTADO_VARIANT: Record<string, BadgeVariant> = {
  activo: "success",
  inactivo: "neutral",
  licencia: "warning",
};

export function TrabajadorRow({ trabajador, empresaCodigo, onChanged }: Props) {
  const { data: me } = useMe();
  const canUpdate = me?.allowed_actions?.includes("trabajador:update") ?? false;
  const [markInactiveOpen, setMarkInactiveOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  return (
    <>
      <tr className="transition-colors duration-150 hover:bg-ink-100/30">
        <td className="px-4 py-3 font-medium text-ink-900">
          <Link
            href={`/empresa/${empresaCodigo}/trabajadores/${trabajador.trabajador_id}` as never}
            className="hover:text-cehta-green"
          >
            {trabajador.nombre_completo}
          </Link>
        </td>
        <td className="px-4 py-3 font-mono text-xs text-ink-700 tabular-nums">
          {trabajador.rut}
        </td>
        <td className="px-4 py-3 text-ink-700">{trabajador.cargo ?? "—"}</td>
        <td className="px-4 py-3 text-ink-500 tabular-nums">
          {trabajador.fecha_ingreso}
        </td>
        <td className="px-4 py-3 text-ink-500">
          {trabajador.tipo_contrato ?? "—"}
        </td>
        <td className="px-4 py-3">
          <Badge variant={ESTADO_VARIANT[trabajador.estado] ?? "neutral"}>
            {trabajador.estado}
          </Badge>
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-1">
            {canUpdate && (
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                title="Subir documento"
                className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-cehta-green/10 hover:text-cehta-green"
              >
                <FileText className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
            {canUpdate && trabajador.estado === "activo" && (
              <button
                type="button"
                onClick={() => setMarkInactiveOpen(true)}
                title="Marcar inactivo"
                className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-warning/10 hover:text-warning"
              >
                <UserMinus className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
            <Link
              href={`/empresa/${empresaCodigo}/trabajadores/${trabajador.trabajador_id}` as never}
              title="Ver detalle"
              className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-ink-100/60"
            >
              <ChevronRight className="h-4 w-4" strokeWidth={1.5} />
            </Link>
          </div>
        </td>
      </tr>

      <MarkInactiveDialog
        open={markInactiveOpen}
        onOpenChange={setMarkInactiveOpen}
        trabajador={trabajador}
        onSuccess={onChanged}
      />
      <UploadDocumentoDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        trabajadorId={trabajador.trabajador_id}
        trabajadorNombre={trabajador.nombre_completo}
        onSuccess={onChanged}
      />
    </>
  );
}
