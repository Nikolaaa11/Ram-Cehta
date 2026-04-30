"use client";

import { useMemo, useState } from "react";
import {
  Book,
  Search,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Lock,
} from "lucide-react";
import { Surface } from "@/components/ui/surface";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useOpenApiSpec,
  type OpenApiOperation,
  type OpenApiPathItem,
} from "@/hooks/use-openapi-spec";

const METHOD_COLORS: Record<string, { bg: string; text: string }> = {
  GET: { bg: "bg-info/10", text: "text-info" },
  POST: { bg: "bg-cehta-green/10", text: "text-cehta-green" },
  PATCH: { bg: "bg-warning/10", text: "text-warning" },
  PUT: { bg: "bg-warning/10", text: "text-warning" },
  DELETE: { bg: "bg-negative/10", text: "text-negative" },
};

const METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;
type Method = (typeof METHODS)[number];

interface FlatEndpoint {
  path: string;
  method: Method;
  operation: OpenApiOperation;
  tag: string;
}

function flatten(
  paths: Record<string, OpenApiPathItem>,
): FlatEndpoint[] {
  const out: FlatEndpoint[] = [];
  for (const [path, item] of Object.entries(paths)) {
    for (const method of METHODS) {
      const op = item[method.toLowerCase() as keyof OpenApiPathItem];
      if (!op) continue;
      const tag = op.tags?.[0] ?? "default";
      out.push({ path, method, operation: op, tag });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

function MethodBadge({ method }: { method: string }) {
  const cfg = METHOD_COLORS[method] ?? {
    bg: "bg-ink-100",
    text: "text-ink-600",
  };
  return (
    <span
      className={`inline-flex h-5 min-w-[3.5rem] items-center justify-center rounded-md ${cfg.bg} px-2 font-mono text-[10px] font-bold ${cfg.text}`}
    >
      {method}
    </span>
  );
}

function EndpointRow({ endpoint }: { endpoint: FlatEndpoint }) {
  const [expanded, setExpanded] = useState(false);
  const op = endpoint.operation;
  const requiresAuth =
    (op.security?.length ?? 0) > 0 || true; // todos requieren auth en Cehta

  return (
    <div className="rounded-xl border border-hairline bg-white transition-all duration-150 ease-apple">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-ink-50/40"
      >
        <MethodBadge method={endpoint.method} />
        <code className="flex-1 truncate font-mono text-xs text-ink-900">
          {endpoint.path}
        </code>
        {requiresAuth && (
          <Lock className="h-3 w-3 shrink-0 text-ink-400" strokeWidth={1.75} />
        )}
        {op.deprecated && (
          <span className="rounded bg-negative/10 px-1.5 py-0.5 text-[10px] font-medium text-negative">
            DEPRECATED
          </span>
        )}
        {op.summary && (
          <span className="hidden truncate text-xs text-ink-500 sm:inline">
            {op.summary}
          </span>
        )}
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" strokeWidth={1.75} />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" strokeWidth={1.75} />
        )}
      </button>
      {expanded && (
        <div className="border-t border-hairline bg-ink-50/30 px-4 py-3 text-xs text-ink-700">
          {op.description && (
            <p className="mb-3 whitespace-pre-wrap">{op.description}</p>
          )}
          {op.parameters && op.parameters.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
                Parámetros
              </p>
              <ul className="space-y-1">
                {op.parameters.map((p) => (
                  <li
                    key={`${p.in}-${p.name}`}
                    className="flex items-center gap-2 rounded bg-white px-2 py-1"
                  >
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 font-mono text-[10px] text-ink-600">
                      {p.in}
                    </span>
                    <code className="font-mono text-[11px] font-medium">
                      {p.name}
                    </code>
                    {p.schema?.type && (
                      <span className="text-[10px] text-ink-400">
                        {p.schema.type}
                      </span>
                    )}
                    {p.required && (
                      <span className="text-[10px] font-medium text-negative">
                        required
                      </span>
                    )}
                    {p.description && (
                      <span className="ml-auto text-[10px] text-ink-500">
                        {p.description}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-400">
              Ejemplo (curl con API token)
            </p>
            <pre className="overflow-x-auto rounded-lg bg-ink-900 p-2 font-mono text-[10px] text-cehta-green/90">
              {`curl -H "Authorization: Bearer cak_xxx..." \\
  -X ${endpoint.method} \\
  https://cehta-backend.fly.dev${endpoint.path.replace(/\{[^}]+\}/g, "REPLACE_ME")}`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ApiDocsPage() {
  const { data, isLoading, error } = useOpenApiSpec();
  const [filter, setFilter] = useState("");

  const flat = useMemo(() => {
    if (!data) return [];
    return flatten(data.paths);
  }, [data]);

  const filtered = useMemo(() => {
    if (!filter) return flat;
    const q = filter.toLowerCase();
    return flat.filter(
      (e) =>
        e.path.toLowerCase().includes(q) ||
        e.method.toLowerCase().includes(q) ||
        e.operation.summary?.toLowerCase().includes(q) ||
        e.tag.toLowerCase().includes(q),
    );
  }, [flat, filter]);

  // Agrupar por tag
  const grouped = useMemo(() => {
    const m: Record<string, FlatEndpoint[]> = {};
    for (const e of filtered) {
      if (!m[e.tag]) m[e.tag] = [];
      m[e.tag]!.push(e);
    }
    // Ordenar tags alfabéticamente, "auth" primero, "health" último
    const keys = Object.keys(m).sort((a, b) => {
      if (a === "auth") return -1;
      if (b === "auth") return 1;
      if (a === "health") return 1;
      if (b === "health") return -1;
      return a.localeCompare(b);
    });
    return keys.map((k) => ({ tag: k, items: m[k]! }));
  }, [filtered]);

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-900">
            API Documentation
          </h1>
          <p className="text-sm text-ink-500">
            Endpoints REST de Cehta Capital · auth via Bearer JWT (Supabase)
            o API tokens{" "}
            <code className="rounded bg-ink-100/60 px-1 py-0.5 text-xs">
              cak_…
            </code>
            . Los tokens se gestionan en{" "}
            <a
              href="/admin/api-tokens"
              className="text-cehta-green underline hover:text-cehta-green-700"
            >
              /admin/api-tokens
            </a>
            .
          </p>
        </div>
        <a
          href={`${process.env.NEXT_PUBLIC_API_URL?.replace(/\/api\/v1\/?$/, "") ?? ""}/docs`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-hairline bg-white px-3 py-1.5 text-sm font-medium text-ink-700 transition-colors duration-150 ease-apple hover:bg-ink-50"
        >
          <Book className="h-4 w-4" strokeWidth={1.75} />
          Swagger UI
          <ExternalLink className="h-3 w-3" strokeWidth={1.75} />
        </a>
      </div>

      {/* Filter */}
      {data && (
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400"
            strokeWidth={1.75}
          />
          <input
            type="search"
            placeholder="Filtrar endpoints (path, método, tag)…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full rounded-xl border-0 bg-white py-2.5 pl-9 pr-3 text-sm ring-1 ring-hairline focus:outline-none focus:ring-2 focus:ring-cehta-green"
          />
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-2xl" />
          ))}
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <Surface className="border border-negative/20 bg-negative/5 ring-1 ring-negative/20">
          <Surface.Title className="text-negative">
            No se pudo cargar el OpenAPI spec
          </Surface.Title>
          <Surface.Subtitle>{error.message}</Surface.Subtitle>
        </Surface>
      )}

      {/* Stats summary */}
      {data && !isLoading && !error && (
        <Surface padding="compact">
          <div className="flex items-center justify-around text-center">
            <div>
              <p className="text-2xl font-semibold tabular-nums text-ink-900">
                {flat.length}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-ink-400">
                endpoints
              </p>
            </div>
            <div className="h-8 w-px bg-hairline" />
            <div>
              <p className="text-2xl font-semibold tabular-nums text-ink-900">
                {grouped.length}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-ink-400">
                tags
              </p>
            </div>
            <div className="h-8 w-px bg-hairline" />
            <div>
              <p className="text-2xl font-semibold tabular-nums text-ink-900">
                {data.info.version}
              </p>
              <p className="text-[10px] uppercase tracking-wider text-ink-400">
                version
              </p>
            </div>
          </div>
        </Surface>
      )}

      {/* Grouped endpoints */}
      {data && !isLoading && !error && (
        <div className="space-y-6">
          {grouped.length === 0 ? (
            <Surface className="py-12 text-center">
              <p className="text-sm text-ink-400">
                Sin endpoints que coincidan con &ldquo;{filter}&rdquo;
              </p>
            </Surface>
          ) : (
            grouped.map(({ tag, items }) => (
              <Surface key={tag} padding="none">
                <Surface.Header className="border-b border-hairline px-5 py-3">
                  <div className="flex items-center gap-2">
                    <Surface.Title className="capitalize">{tag}</Surface.Title>
                    <span className="rounded-md bg-ink-100/60 px-1.5 py-0.5 text-[10px] font-medium text-ink-600">
                      {items.length}
                    </span>
                  </div>
                </Surface.Header>
                <div className="space-y-1.5 p-2">
                  {items.map((endpoint) => (
                    <EndpointRow
                      key={`${endpoint.method}-${endpoint.path}`}
                      endpoint={endpoint}
                    />
                  ))}
                </div>
              </Surface>
            ))
          )}
        </div>
      )}
    </div>
  );
}
