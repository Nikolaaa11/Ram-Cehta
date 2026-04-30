import { Surface } from "@/components/ui/surface";
import { Badge } from "@/components/ui/badge";
import type { EmpresaCatalogo } from "@/lib/api/schema";
import { EmpresaActions } from "./EmpresaActions";
import { EmpresaLogo } from "./EmpresaLogo";
import { PinEmpresaButton } from "./PinEmpresaButton";

/**
 * Header con identidad de la empresa: razón social grande, código + RUT badges.
 * A la derecha: EmpresaActions (Editar + Sync Dropbox) — client island.
 */
export function EmpresaHeader({ empresa }: { empresa: EmpresaCatalogo }) {
  return (
    <Surface variant="glass" padding="default" className="mb-6">
      <div className="flex items-start gap-4">
        <EmpresaLogo empresaCodigo={empresa.codigo} size={56} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-display font-semibold tracking-tight text-ink-900">
                  {empresa.razon_social}
                </h1>
                <Badge variant="info">{empresa.codigo}</Badge>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-500">
                {empresa.rut && (
                  <span className="font-mono tabular-nums">{empresa.rut}</span>
                )}
                {empresa.oc_prefix && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-ink-300" />
                    <span>OC prefix: {empresa.oc_prefix}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <PinEmpresaButton empresaCodigo={empresa.codigo} />
              <EmpresaActions codigo={empresa.codigo} />
            </div>
          </div>
        </div>
      </div>
    </Surface>
  );
}
