"use client";

/**
 * FileLink — V4 fase 7.
 *
 * Componente unificado para mostrar y abrir adjuntos. Detecta:
 *   - URLs de Dropbox (los normaliza a `?dl=0` para preview, no descarga)
 *   - URLs de Google Drive
 *   - URLs http(s) genéricas (link externo con icon)
 *   - Rutas internas (path / abrir en visor)
 *   - Tipo de archivo (PDF, imagen, Excel, Word) por extensión
 *
 * Variantes:
 *   - `chip` (default): pill compacto con icon + nombre truncado
 *   - `inline`: solo el link con icon a la izquierda
 *   - `card`: tile más grande con tipo de archivo y dominio
 *
 * Si el adjunto es null/empty, renderiza un placeholder "Sin adjunto"
 * en lugar de nada — evita confusión con cards vacíos.
 */
import { useMemo } from "react";
import {
  ExternalLink,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  Link2,
  Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  /** URL absoluta o ruta interna. Si es null/vacío muestra placeholder. */
  url?: string | null;
  /** Etiqueta visible. Si no se pasa se infiere del último segmento. */
  label?: string;
  variant?: "chip" | "inline" | "card";
  /** Si true muestra el dominio entre paréntesis al lado de la etiqueta. */
  showDomain?: boolean;
  className?: string;
}

interface FileMeta {
  kind: "pdf" | "image" | "spreadsheet" | "doc" | "folder" | "link";
  Icon: typeof FileText;
  domain: string | null;
  /** URL ya normalizada para abrir (Dropbox `?dl=0` etc). */
  href: string;
  /** Etiqueta inferida si no se pasó. */
  inferredLabel: string;
}

const EXT_KIND: Record<string, FileMeta["kind"]> = {
  pdf: "pdf",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  xlsx: "spreadsheet",
  xls: "spreadsheet",
  csv: "spreadsheet",
  ods: "spreadsheet",
  docx: "doc",
  doc: "doc",
  odt: "doc",
};

const KIND_ICON: Record<FileMeta["kind"], typeof FileText> = {
  pdf: FileText,
  image: FileImage,
  spreadsheet: FileSpreadsheet,
  doc: FileText,
  folder: Folder,
  link: Link2,
};

function analyze(url: string): FileMeta {
  // Normalización Dropbox: dl=1 → dl=0 (preview en navegador, no forzar descarga)
  let href = url.trim();
  let domain: string | null = null;

  try {
    const u = new URL(href);
    domain = u.hostname.replace(/^www\./, "");
    if (domain.includes("dropbox.com")) {
      // Forzar preview (no descarga)
      u.searchParams.set("dl", "0");
      href = u.toString();
    }
  } catch {
    // No es URL válida — asumimos path interno
    domain = null;
  }

  // Última parte del path como nombre inferido
  const lastSeg =
    href.split(/[?#]/)[0]?.split("/").filter(Boolean).pop() ?? "Adjunto";
  const decoded = (() => {
    try {
      return decodeURIComponent(lastSeg);
    } catch {
      return lastSeg;
    }
  })();

  // Detectar carpeta (sin extensión final)
  const ext = decoded.includes(".")
    ? decoded.split(".").pop()!.toLowerCase()
    : "";

  let kind: FileMeta["kind"];
  if (!ext && (href.includes("/folder/") || href.endsWith("/"))) {
    kind = "folder";
  } else if (EXT_KIND[ext]) {
    kind = EXT_KIND[ext];
  } else if (domain) {
    kind = "link";
  } else {
    kind = "link";
  }

  return {
    kind,
    Icon: KIND_ICON[kind],
    domain,
    href,
    inferredLabel: decoded,
  };
}

export function FileLink({
  url,
  label,
  variant = "chip",
  showDomain = false,
  className,
}: Props) {
  const meta = useMemo(() => (url ? analyze(url) : null), [url]);

  if (!url || !meta) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-[11px] italic text-ink-400",
          className,
        )}
      >
        <Paperclip className="h-3 w-3" strokeWidth={1.75} />
        Sin adjunto
      </span>
    );
  }

  const visibleLabel = label ?? meta.inferredLabel;
  const Icon = meta.Icon;

  if (variant === "inline") {
    return (
      <a
        href={meta.href}
        target="_blank"
        rel="noreferrer"
        title={meta.href}
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium text-cehta-green hover:underline",
          className,
        )}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        <span className="truncate">{visibleLabel}</span>
        {showDomain && meta.domain && (
          <span className="text-[10px] text-ink-400">({meta.domain})</span>
        )}
      </a>
    );
  }

  if (variant === "card") {
    return (
      <a
        href={meta.href}
        target="_blank"
        rel="noreferrer"
        title={meta.href}
        className={cn(
          "group flex items-start gap-3 rounded-xl border border-hairline bg-white p-3 transition-colors hover:border-cehta-green/40 hover:bg-cehta-green/5",
          className,
        )}
      >
        <span
          className={cn(
            "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
            meta.kind === "pdf" && "bg-red-50 text-red-700",
            meta.kind === "image" && "bg-purple-50 text-purple-700",
            meta.kind === "spreadsheet" && "bg-emerald-50 text-emerald-700",
            meta.kind === "doc" && "bg-blue-50 text-blue-700",
            meta.kind === "folder" && "bg-amber-50 text-amber-700",
            meta.kind === "link" && "bg-ink-100 text-ink-700",
          )}
        >
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink-900">
            {visibleLabel}
          </p>
          <p className="truncate text-[11px] text-ink-500">
            {meta.domain ?? "Ruta interna"} ·{" "}
            <span className="uppercase">{meta.kind}</span>
          </p>
        </div>
        <ExternalLink
          className="h-3.5 w-3.5 shrink-0 text-ink-400 transition-colors group-hover:text-cehta-green"
          strokeWidth={1.75}
        />
      </a>
    );
  }

  // chip (default)
  return (
    <a
      href={meta.href}
      target="_blank"
      rel="noreferrer"
      title={meta.href}
      className={cn(
        "inline-flex max-w-[280px] items-center gap-1.5 rounded-lg border border-hairline bg-white px-2 py-1 text-[11px] font-medium text-ink-700 transition-colors hover:border-cehta-green/40 hover:bg-cehta-green/5 hover:text-cehta-green",
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" strokeWidth={1.75} />
      <span className="truncate">{visibleLabel}</span>
      {showDomain && meta.domain && (
        <span className="shrink-0 text-[10px] text-ink-400">
          {meta.domain}
        </span>
      )}
      <ExternalLink className="h-2.5 w-2.5 shrink-0 text-ink-400" />
    </a>
  );
}
