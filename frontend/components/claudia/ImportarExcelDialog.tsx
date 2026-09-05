"use client";

/**
 * ImportarExcelDialog — sube `CC Bancos_Revtech.xlsx` / `Cuenta
 * Bancos_trongkai.xlsx` y carga la hoja `Registro de Egresos`.
 *
 * Primero "Probar primero" (dry run): el backend parsea y devuelve cuántas
 * filas leyó, cuántas crearía, cuántas ya existían (import idempotente) y
 * cuáles saltaría con su motivo. Recién con ese resumen a la vista se
 * habilita "Importar de verdad". Así Claudia ve qué va a pasar ANTES de que
 * pase, y re-importar el mismo archivo no duplica nada.
 */
import { useEffect, useRef, useState } from "react";
import { FileSpreadsheet, Loader2, Upload, X } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/toast";
import { apiClient, ApiError } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { CORFO_EMPRESAS, type CorfoEmpresa, type ImportarResponse } from "@/lib/claudia/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Empresa seleccionada en la pantalla (se puede cambiar acá). */
  empresa: CorfoEmpresa;
  onImportado: (resumen: ImportarResponse) => void;
}

export function ImportarExcelDialog({ open, onOpenChange, empresa, onImportado }: Props) {
  const { session } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [empresaSel, setEmpresaSel] = useState<CorfoEmpresa>(empresa);
  const [arrastrando, setArrastrando] = useState(false);
  const [cargando, setCargando] = useState<"dry" | "real" | null>(null);
  const [resultado, setResultado] = useState<ImportarResponse | null>(null);

  // Limpiar al cerrar: el resumen del archivo anterior no puede quedar
  // "aprobando" el siguiente.
  useEffect(() => {
    if (!open) {
      setArchivo(null);
      setResultado(null);
      setCargando(null);
      setArrastrando(false);
    } else {
      setEmpresaSel(empresa);
    }
  }, [open, empresa]);

  function elegir(f: File | null | undefined) {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      toast.error("El archivo tiene que ser un .xlsx (el Excel de Claudia)");
      return;
    }
    setArchivo(f);
    setResultado(null);
  }

  async function enviar(dryRun: boolean) {
    if (!archivo || !session) return;
    setCargando(dryRun ? "dry" : "real");
    try {
      const fd = new FormData();
      fd.append("archivo", archivo);
      fd.append("empresa_codigo", empresaSel);
      fd.append("dry_run", dryRun ? "true" : "false");
      const r = await apiClient.postForm<ImportarResponse>("/claudia/egresos/importar", fd, session);
      setResultado(r);
      if (!dryRun) {
        toast.success(
          `${r.creadas} ${r.creadas === 1 ? "gasto importado" : "gastos importados"} a ${r.empresa_codigo}`,
          {
            description:
              r.omitidas_existentes > 0
                ? `${r.omitidas_existentes} ya existían y no se duplicaron.`
                : undefined,
          },
        );
        onImportado(r);
        onOpenChange(false);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.detail : "No se pudo importar el archivo");
    } finally {
      setCargando(null);
    }
  }

  const probado = resultado !== null && resultado.dry_run;

  return (
    <Dialog open={open} onOpenChange={(o) => !cargando && onOpenChange(o)}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Importar Excel</DialogTitle>
          <DialogDescription>
            La hoja <span className="font-medium text-ink-700">Registro de Egresos</span> de tu
            planilla, tal cual. Las filas que ya estén cargadas no se duplican.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wide text-ink-500">Empresa</span>
            <div className="inline-flex rounded-xl bg-surface-muted p-0.5" role="radiogroup" aria-label="Empresa">
              {CORFO_EMPRESAS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="radio"
                  aria-checked={empresaSel === e}
                  onClick={() => {
                    setEmpresaSel(e);
                    setResultado(null);
                  }}
                  disabled={cargando !== null}
                  className={cn(
                    "rounded-[10px] px-3 py-1 text-sm font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
                    empresaSel === e ? "bg-white text-ink-900 shadow-card" : "text-ink-500 hover:text-ink-900",
                  )}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-label="Elegir archivo .xlsx"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setArrastrando(true);
            }}
            onDragLeave={() => setArrastrando(false)}
            onDrop={(e) => {
              e.preventDefault();
              setArrastrando(false);
              elegir(e.dataTransfer.files[0]);
            }}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cehta-green",
              arrastrando ? "border-cehta-green bg-cehta-green/5" : "border-ink-100 hover:border-ink-300",
            )}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="sr-only"
              onChange={(e) => elegir(e.target.files?.[0])}
            />
            {archivo ? (
              <>
                <FileSpreadsheet className="size-8 text-cehta-green" strokeWidth={1.5} />
                <p className="text-sm font-medium text-ink-900">{archivo.name}</p>
                <p className="text-xs text-ink-500">{(archivo.size / 1024).toFixed(0)} KB</p>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setArchivo(null);
                    setResultado(null);
                  }}
                  className="mt-1 inline-flex items-center gap-1 text-xs text-ink-500 hover:text-ink-900"
                >
                  <X className="size-3" strokeWidth={2} />
                  Cambiar archivo
                </button>
              </>
            ) : (
              <>
                <Upload className="size-8 text-ink-300" strokeWidth={1.5} />
                <p className="text-sm font-medium text-ink-900">Arrastrá el .xlsx acá o hacé click</p>
                <p className="text-xs text-ink-500">CC Bancos_Revtech.xlsx · Cuenta Bancos_trongkai.xlsx</p>
              </>
            )}
          </div>

          {resultado && (
            <div className="rounded-2xl bg-surface-muted p-4 text-sm">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">
                {resultado.dry_run ? "Qué pasaría" : "Qué pasó"} · {resultado.empresa_codigo}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                <Dato label="Leídas" valor={resultado.leidas} />
                <Dato label={resultado.dry_run ? "Se crearían" : "Creadas"} valor={resultado.creadas} tono="positivo" />
                <Dato label="Ya existían" valor={resultado.omitidas_existentes} />
                <Dato label="Duplicadas en el Excel" valor={resultado.duplicadas_en_excel} />
                <Dato label="Descuadradas" valor={resultado.descuadradas} tono={resultado.descuadradas > 0 ? "aviso" : undefined} />
                <Dato label="Sin clasificar" valor={resultado.sin_clasificar} tono={resultado.sin_clasificar > 0 ? "aviso" : undefined} />
              </dl>
              {resultado.saltadas.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-warning">
                    {resultado.saltadas.length} {resultado.saltadas.length === 1 ? "fila saltada" : "filas saltadas"}
                  </p>
                  <ul className="mt-1 max-h-28 space-y-0.5 overflow-auto text-xs text-ink-700">
                    {resultado.saltadas.map((s) => (
                      <li key={`${s.fila_excel}-${s.motivo}`}>
                        <span className="tabular-nums text-ink-500">Fila {s.fila_excel}</span> · {s.motivo}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {(resultado.descuadradas > 0 || resultado.sin_clasificar > 0) && (
                <p className="mt-3 text-xs text-ink-500">
                  Las descuadradas y sin clasificar se importan tal cual y quedan marcadas en ámbar
                  para resolverlas desde la grilla. Inventar el reparto sería mentirle a CORFO.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => void enviar(true)}
            disabled={!archivo || cargando !== null}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 disabled:opacity-50"
          >
            {cargando === "dry" && <Loader2 className="size-4 animate-spin" strokeWidth={2} />}
            Probar primero
          </button>
          <button
            type="button"
            onClick={() => void enviar(false)}
            disabled={!archivo || !probado || cargando !== null}
            title={!probado ? "Primero probá el archivo para ver qué pasaría" : undefined}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-50"
          >
            {cargando === "real" && <Loader2 className="size-4 animate-spin" strokeWidth={2} />}
            Importar de verdad
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Dato({ label, valor, tono }: { label: string; valor: number; tono?: "positivo" | "aviso" }) {
  return (
    <div>
      <dt className="text-[11px] text-ink-500">{label}</dt>
      <dd
        className={cn(
          "font-display text-lg font-semibold tabular-nums",
          tono === "positivo" ? "text-cehta-green" : tono === "aviso" ? "text-warning" : "text-ink-900",
        )}
      >
        {valor}
      </dd>
    </div>
  );
}
