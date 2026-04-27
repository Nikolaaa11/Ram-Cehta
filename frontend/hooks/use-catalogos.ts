"use client";

/**
 * Hooks de catálogos — única fuente de verdad para selects (Disciplina 1).
 *
 * Antes había arrays `EMPRESAS = ["TRONGKAI", ...]` hardcodeados en cada
 * página. Ahora todo viene de `core.empresas` (backend) vía `/catalogos/empresas`.
 */
import { useApiQuery } from "./use-api-query";
import type { EmpresaCatalogo } from "@/lib/api/schema";

export type { EmpresaCatalogo };

export const useCatalogoEmpresas = () =>
  useApiQuery<EmpresaCatalogo[]>(["catalogo", "empresas"], "/catalogos/empresas");
