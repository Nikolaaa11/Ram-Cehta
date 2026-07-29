"use client";

/**
 * OC-FIRMANTES-EXTERNOS — alta del firmante que NO es del equipo emisor:
 * el representante del proveedor (o del cliente) que firma la OC.
 *
 * Las OC reales de referencia llevan SIEMPRE 6 firmas: 1 del proveedor +
 * las 5 del equipo. El proveedor casi nunca tiene cuenta en la plataforma,
 * así que el email es opcional a propósito — sin email la persona firma a
 * mano el PDF impreso y el sistema no le manda absolutamente nada.
 *
 * Es un diálogo "tonto": no habla con la API. Junta los datos, valida lo
 * mínimo y se los pasa al padre (OcFirmasSection), que es el único dueño del
 * set de firmantes y del PUT. Así agregar un externo pasa por exactamente el
 * mismo guardado optimista que un click en un chip del equipo.
 */
import { useState, type ReactNode } from "react";
import { UserPlus } from "lucide-react";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export interface ExternoNuevo {
  nombre: string;
  cargo: string | null;
  /** Razón social que se imprime bajo el cargo en el PDF. */
  empresa_firmante: string | null;
  /** Sin email → firma manuscrita, no recibe invitación. */
  email: string | null;
}

interface Props {
  trigger: ReactNode;
  /** Razón social del proveedor de la OC, si la conocemos: precarga el campo. */
  empresaSugerida?: string | null;
  /**
   * Suma el externo al set. Si la promesa rechaza, el diálogo queda abierto
   * con los datos tipeados para que el usuario reintente sin recargarlos.
   */
  onAgregar: (externo: ExternoNuevo) => Promise<unknown> | void;
}

// El cargo que aparece en prácticamente todas las OC firmadas por proveedor.
const CARGO_DEFAULT = "Representante Legal";

const CARGOS_FRECUENTES = [
  "Representante Legal",
  "Representante Comercial",
  "Gerente General",
  "Administrador de Contrato",
  "Jefe de Proyecto",
];

const inputCls =
  "mt-1 block w-full rounded-xl border border-hairline bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-300 focus:outline-none focus:ring-2 focus:ring-cehta-green";
const labelCls = "block text-xs font-medium text-ink-700";

export function AgregarExternoDialog({
  trigger,
  empresaSugerida,
  onAgregar,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [nombre, setNombre] = useState("");
  const [cargo, setCargo] = useState(CARGO_DEFAULT);
  const [empresa, setEmpresa] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setNombre("");
    setCargo(CARGO_DEFAULT);
    setEmpresa("");
    setEmail("");
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (pending) return;
    if (!next) reset();
    setOpen(next);
  }

  async function handleSubmit() {
    const n = nombre.trim();
    const e = email.trim().toLowerCase();
    if (n.length < 2) {
      setError("Escribí el nombre completo de quien firma (mínimo 2 letras).");
      return;
    }
    // Validamos acá para no gastar un round-trip contra el 422 de EmailStr.
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setError(
        "Ese correo no parece válido. Corregilo o dejalo vacío " +
          "(sin correo, la persona firma a mano).",
      );
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onAgregar({
        nombre: n,
        cargo: cargo.trim() || null,
        empresa_firmante: (empresa.trim() || empresaSugerida || "").trim() || null,
        email: e || null,
      });
      reset();
      setOpen(false);
    } catch {
      // El padre ya mostró el toast con el detalle del backend; nos quedamos
      // abiertos para que el usuario corrija y reintente.
      setError("No se pudo agregar. Revisá los datos y probá de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <div className="flex gap-4">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cehta-green/10 text-cehta-green"
            aria-hidden="true"
          >
            <UserPlus className="h-5 w-5" strokeWidth={1.5} />
          </span>
          <div className="flex-1">
            <DialogTitle>Agregar firmante externo</DialogTitle>
            <DialogDescription className="mt-1.5">
              La persona del proveedor o del cliente que firma esta OC. Va
              primera en el PDF, arriba de las firmas del equipo.
            </DialogDescription>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending) void handleSubmit();
          }}
          className="mt-5 space-y-4"
        >
          <div>
            <label htmlFor="ext-nombre" className={labelCls}>
              Nombre completo *
            </label>
            <input
              id="ext-nombre"
              required
              autoFocus
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Ej: Juan Pérez González"
              maxLength={200}
              className={inputCls}
            />
          </div>

          <div>
            <label htmlFor="ext-cargo" className={labelCls}>
              Cargo
            </label>
            <input
              id="ext-cargo"
              value={cargo}
              onChange={(e) => setCargo(e.target.value)}
              list="ext-cargos-frecuentes"
              placeholder={CARGO_DEFAULT}
              maxLength={120}
              className={inputCls}
            />
            <datalist id="ext-cargos-frecuentes">
              {CARGOS_FRECUENTES.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <p className="mt-1 text-xs text-ink-500">
              Es lo que se imprime abajo de la línea de firma.
            </p>
          </div>

          <div>
            <label htmlFor="ext-empresa" className={labelCls}>
              Empresa <span className="text-ink-500">(razón social a imprimir)</span>
            </label>
            <input
              id="ext-empresa"
              value={empresa}
              onChange={(e) => setEmpresa(e.target.value)}
              placeholder={empresaSugerida ?? "Ej: Constructora Los Andes SpA"}
              maxLength={200}
              className={inputCls}
            />
            {empresaSugerida && !empresa.trim() && (
              <p className="mt-1 text-xs text-ink-500">
                Si lo dejás vacío se imprime{" "}
                <span className="font-medium text-ink-700">
                  {empresaSugerida}
                </span>
                .
              </p>
            )}
          </div>

          <div>
            <label htmlFor="ext-email" className={labelCls}>
              Correo <span className="text-ink-500">(opcional)</span>
            </label>
            <input
              id="ext-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="juan.perez@proveedor.cl"
              maxLength={200}
              className={inputCls}
            />
            <p className="mt-1 text-xs text-ink-500">
              Sin correo, esta persona firma a mano sobre el PDF impreso y no
              recibe ningún email de la plataforma.
            </p>
          </div>

          {error && (
            <p
              role="alert"
              className="rounded-xl bg-negative/5 px-3 py-2 text-xs text-negative ring-1 ring-negative/20"
            >
              {error}
            </p>
          )}

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end sm:gap-3">
            <DialogClose asChild>
              <button
                type="button"
                disabled={pending}
                className="inline-flex items-center justify-center rounded-xl bg-white px-4 py-2 text-sm font-medium text-ink-700 ring-1 ring-hairline transition-colors hover:bg-ink-100/40 disabled:opacity-60"
              >
                Cancelar
              </button>
            </DialogClose>
            <button
              type="submit"
              disabled={pending || nombre.trim().length < 2}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-cehta-green px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cehta-green-700 disabled:opacity-60"
            >
              <UserPlus className="h-4 w-4" strokeWidth={1.5} />
              {pending ? "Agregando…" : "Agregar firmante"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
