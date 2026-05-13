"use client";

/**
 * EmpresaLogoButton — V5++ ola CG
 *
 * Botón compacto en /admin/empresas para subir el logo de la empresa.
 * Acepta PNG, JPG, JPEG, SVG, WebP (max 2MB) y los sube a Dropbox bajo
 * /Cehta Capital/01-Empresas/{COD}/00-Branding/logo.<ext>
 *
 * Despues del upload, el logo aparece automaticamente en los PDFs de
 * OC (GET /ordenes-compra/{id}.html).
 */
import { useRef, useState } from "react";
import { Image as ImageIcon, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/use-session";
import { apiClient, ApiError } from "@/lib/api/client";

interface Props {
  empresaCodigo: string;
  hasLogo?: boolean;
  onUploaded?: (logoPath: string) => void;
}

export function EmpresaLogoButton({ empresaCodigo, hasLogo, onUploaded }: Props) {
  const { session } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  async function handleFile(file: File) {
    if (!session) {
      toast.error("Sesión expirada");
      return;
    }
    const allowed = ["png", "jpg", "jpeg", "svg", "webp"];
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!allowed.includes(ext)) {
      toast.error(`Formato '.${ext}' no soportado (use PNG/JPG/SVG/WebP)`);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error(`Archivo muy grande (${(file.size / 1024).toFixed(0)} KB). Max 2 MB.`);
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const resp = await apiClient.postForm<{
        logo_dropbox_path: string;
        size_bytes: number;
      }>(`/empresa/${empresaCodigo}/logo`, fd, session);
      toast.success(
        `Logo de ${empresaCodigo} cargado · ${(resp.size_bytes / 1024).toFixed(0)} KB`,
      );
      onUploaded?.(resp.logo_dropbox_path);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.detail : "Error al subir logo",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
        className="hidden"
      />
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          inputRef.current?.click();
        }}
        disabled={loading}
        title={
          hasLogo
            ? `Reemplazar logo de ${empresaCodigo}`
            : `Subir logo de ${empresaCodigo} (PNG/JPG/SVG, máx 2MB)`
        }
        className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-50 ${
          hasLogo
            ? "bg-cehta-green/10 text-cehta-green hover:bg-cehta-green hover:text-white"
            : "bg-ink-100/60 text-ink-600 hover:bg-cehta-green/10 hover:text-cehta-green"
        }`}
      >
        {loading ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : hasLogo ? (
          <ImageIcon className="h-3 w-3" strokeWidth={2} />
        ) : (
          <Upload className="h-3 w-3" strokeWidth={2} />
        )}
        {hasLogo ? "Logo" : "Subir logo"}
      </button>
    </>
  );
}
