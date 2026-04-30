"use client";

import { useQuery } from "@tanstack/react-query";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api/v1";
const OPENAPI_URL = API_BASE.replace(/\/api\/v1\/?$/, "/openapi.json");

// Tipos mínimos de OpenAPI 3 — solo lo que renderiza la UI.
export interface OpenApiOperation {
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: Array<{
    name: string;
    in: string;
    required?: boolean;
    description?: string;
    schema?: { type?: string; format?: string };
  }>;
  requestBody?: {
    content?: Record<string, { schema?: unknown }>;
  };
  responses?: Record<string, { description?: string }>;
  security?: Array<Record<string, unknown>>;
  deprecated?: boolean;
}

export interface OpenApiPathItem {
  get?: OpenApiOperation;
  post?: OpenApiOperation;
  patch?: OpenApiOperation;
  put?: OpenApiOperation;
  delete?: OpenApiOperation;
}

export interface OpenApiSpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths: Record<string, OpenApiPathItem>;
}

/**
 * Fetch del OpenAPI JSON sin auth — la API surface es pública. La fetch va
 * directo a `/openapi.json` (no `/api/v1/openapi.json`) porque FastAPI lo
 * sirve a nivel raíz.
 */
export function useOpenApiSpec() {
  return useQuery<OpenApiSpec, Error>({
    queryKey: ["openapi-spec"],
    queryFn: async () => {
      const res = await fetch(OPENAPI_URL);
      if (!res.ok) {
        throw new Error(`No se pudo cargar OpenAPI spec: HTTP ${res.status}`);
      }
      return res.json() as Promise<OpenApiSpec>;
    },
    staleTime: 60 * 60 * 1000, // 1h — el schema casi nunca cambia entre deploys
  });
}
