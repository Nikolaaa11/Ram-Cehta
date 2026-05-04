"use client";

/**
 * Bóveda Dropbox · vista por empresa.
 *
 * Lista archivos y carpetas de `/Cehta Capital/01-Empresas/{codigo}` en
 * Dropbox vía `GET /dropbox/files?path=...`. Click en folder navega adentro,
 * click en archivo abre el preview en dropbox.com.
 *
 * Apple-tier estético:
 *  - Hero editorial con eyebrow + display title
 *  - Breadcrumb tipo Finder
 *  - Tabla minimalista con iconos folder vs file
 */
import { use, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronRight,
  Cloud,
  ExternalLink,
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  Home,
  Image as ImageIcon,
  Inbox,
} from "lucide-react";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import { toDateTime } from "@/lib/format";

interface DropboxItem {
  name: string;
  path: string;
  type: "file" | "folder";
  size: number | null;
  modified: string | null;
}

interface DropboxListResponse {
  path: string;
  items: DropboxItem[];
}

const BASE_PATH_PREFIX = "/Cehta Capital/01-Empresas";

function formatBytes(size: number | null): string {
  if (size == null) return "—";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024)
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function iconFor(item: DropboxItem) {
  if (item.type === "folder") return Folder;
  const ext = item.name.split(".").pop()?.toLowerCase() ?? "";
  if (["xlsx", "xls", "csv", "tsv"].includes(ext)) return FileSpreadsheet;
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "heic"].includes(ext))
    return ImageIcon;
  if (["pdf", "doc", "docx", "txt", "md"].includes(ext)) return FileText;
  return File;
}

export default function EmpresaDocumentosPage({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const { codigo } = use(params);
  const empresaCodigo = codigo.toUpperCase();
  const { session } = useSession();

  const basePath = `${BASE_PATH_PREFIX}/${empresaCodigo}`;
  const [currentPath, setCurrentPath] = useState(basePath);

  const { data, isLoading, error } = useQuery<DropboxListResponse>({
    queryKey: ["dropbox", "files", currentPath],
    queryFn: () =>
      apiClient.get<DropboxListResponse>(
        `/dropbox/files?path=${encodeURIComponent(currentPath)}`,
        session,
      ),
    enabled: !!session,
  });

  // Breadcrumb derivado del currentPath relativo a basePath.
  const crumbs = useMemo(() => {
    const rel = currentPath.startsWith(basePath)
      ? currentPath.slice(basePath.length)
      : currentPath;
    const parts = rel.split("/").filter(Boolean);
    const acc: { label: string; path: string }[] = [];
    let running = basePath;
    for (const p of parts) {
      running = `${running}/${p}`;
      acc.push({ label: p, path: running });
    }
    return acc;
  }, [currentPath, basePath]);

  const items = data?.items ?? [];
  const sortedItems = useMemo(
    () =>
      [...items].sort((a, b) => {
        if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
        return a.name.localeCompare(b.name);
      }),
    [items],
  );

  const handleItemClick = (item: DropboxItem) => {
    if (item.type === "folder") {
      setCurrentPath(item.path);
    } else {
      const url = `https://www.dropbox.com/home${item.path}`;
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div className="space-y-6">
      {/* Hero editorial */}
      <header className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cehta-green">
          Bóveda Dropbox · {empresaCodigo}
        </p>
        <h2 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
          Documentos de la empresa
        </h2>
        <p className="max-w-2xl text-sm text-ink-500">
          Archivos y carpetas sincronizados desde{" "}
          <span className="font-mono text-xs text-ink-700">{basePath}</span> en
          Dropbox.
        </p>
      </header>

      {/* Breadcrumb tipo Finder */}
      <Surface padding="compact">
        <nav className="flex flex-wrap items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => setCurrentPath(basePath)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-ink-500 transition-colors hover:bg-ink-100/50 hover:text-ink-900"
          >
            <Home className="h-3.5 w-3.5" strokeWidth={1.75} />
            <span className="text-xs font-medium">{empresaCodigo}</span>
          </button>
          {crumbs.map((c, idx) => {
            const isLast = idx === crumbs.length - 1;
            return (
              <span key={c.path} className="inline-flex items-center gap-1">
                <ChevronRight
                  className="h-3.5 w-3.5 text-ink-300"
                  strokeWidth={1.75}
                />
                <button
                  type="button"
                  onClick={() => !isLast && setCurrentPath(c.path)}
                  disabled={isLast}
                  className={
                    isLast
                      ? "rounded-lg px-2 py-1 text-xs font-semibold text-ink-900"
                      : "rounded-lg px-2 py-1 text-xs font-medium text-ink-500 transition-colors hover:bg-ink-100/50 hover:text-ink-900"
                  }
                >
                  {c.label}
                </button>
              </span>
            );
          })}
        </nav>
      </Surface>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {!isLoading && error && (
        <Surface className="text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-negative/10 text-negative">
            <Cloud className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <p className="mt-3 text-base font-medium text-ink-900">
            No se pudo cargar la bóveda Dropbox
          </p>
          <p className="mt-1 text-sm text-ink-500">
            {error instanceof Error ? error.message : "Error desconocido"}
          </p>
        </Surface>
      )}

      {/* Empty */}
      {!isLoading && !error && sortedItems.length === 0 && (
        <Surface className="text-center">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100/60 text-ink-500">
            <Inbox className="h-6 w-6" strokeWidth={1.5} />
          </span>
          <p className="mt-3 text-base font-medium text-ink-900">
            Carpeta vacía
          </p>
          <p className="mt-1 text-sm text-ink-500">
            No hay archivos ni subcarpetas en este nivel.
          </p>
        </Surface>
      )}

      {/* Items list */}
      {!isLoading && !error && sortedItems.length > 0 && (
        <Surface padding="none">
          <ul className="divide-y divide-hairline">
            {sortedItems.map((item) => {
              const Icon = iconFor(item);
              const isFolder = item.type === "folder";
              return (
                <li key={item.path}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className="group flex w-full items-center gap-4 px-4 py-3 text-left transition-colors duration-150 hover:bg-ink-100/30 focus-visible:outline-none focus-visible:bg-ink-100/40"
                  >
                    <span
                      className={
                        isFolder
                          ? "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cehta-green/10 text-cehta-green"
                          : "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink-100/60 text-ink-500"
                      }
                    >
                      <Icon className="h-4 w-4" strokeWidth={1.75} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-900">
                        {item.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-ink-500">
                        {item.modified ? toDateTime(item.modified) : "—"}
                      </p>
                    </div>
                    <span className="hidden text-xs tabular-nums text-ink-500 sm:inline">
                      {isFolder ? "Carpeta" : formatBytes(item.size)}
                    </span>
                    {isFolder ? (
                      <ChevronRight
                        className="h-4 w-4 text-ink-300 transition-colors group-hover:text-ink-500"
                        strokeWidth={1.75}
                      />
                    ) : (
                      <ExternalLink
                        className="h-4 w-4 text-ink-300 transition-colors group-hover:text-cehta-green"
                        strokeWidth={1.75}
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Surface>
      )}
    </div>
  );
}
