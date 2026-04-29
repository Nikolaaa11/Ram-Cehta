"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import type { ExportEntityType } from "@/lib/api/schema";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";

interface Props {
  entity: ExportEntityType;
  empresaCodigo?: string | null;
  estado?: string | null;
  /** Texto override; default "Exportar Excel". */
  label?: string;
  /** "soft" = botón claro neutral, "ghost" = sólo icono + label. */
  variant?: "soft" | "ghost";
  className?: string;
}

/**
 * Botón reusable que dispara `GET /exports/{entity}.xlsx?empresa=...&estado=...`
 * y fuerza el download via blob → object URL → click sintético.
 *
 * Dado que el endpoint requiere auth, usamos `fetch` con bearer token (no
 * podemos usar `<a download>` directo). Mostramos toast en error.
 */
export function ExportExcelButton({
  entity,
  empresaCodigo,
  estado,
  label = "Exportar Excel",
  variant = "soft",
  className = "",
}: Props) {
  const { session } = useSession();
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (!session) {
      toast.error("Sesión expirada");
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (empresaCodigo) params.set("empresa_codigo", empresaCodigo);
      if (estado) params.set("estado", estado);
      const qs = params.toString();
      const url = `${API_BASE}/exports/${entity}.xlsx${qs ? `?${qs}` : ""}`;

      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try {
          const body = await res.json();
          msg = body?.detail ?? msg;
        } catch {
          // ignored
        }
        throw new Error(msg);
      }

      // Filename viene en Content-Disposition; si no, fallback razonable
      const cd = res.headers.get("content-disposition") ?? "";
      const m = /filename="([^"]+)"/.exec(cd);
      const fallback = `${entity}_${empresaCodigo ?? "all"}.xlsx`;
      const filename = m?.[1] ?? fallback;

      const totalRows = res.headers.get("x-total-rows");
      const truncated = res.headers.get("x-truncated") === "true";

      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(objectUrl);

      const rowsLabel = totalRows ? ` (${totalRows} filas)` : "";
      toast.success(
        truncated
          ? `Exportadas 10.000 filas (truncado). Refiná filtros para ver más.`
          : `Excel descargado${rowsLabel}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Error desconocido";
      toast.error(`No se pudo exportar: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const styles =
    variant === "ghost"
      ? "text-ink-700 hover:bg-ink-100/40"
      : "border border-hairline bg-white text-ink-800 hover:bg-ink-50 shadow-card/40";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className={`inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm font-medium transition-colors duration-150 ease-apple disabled:opacity-50 ${styles} ${className}`}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
      ) : (
        <Download className="h-4 w-4" strokeWidth={2} />
      )}
      {label}
    </button>
  );
}
