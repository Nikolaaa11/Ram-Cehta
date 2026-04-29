"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { useSession } from "@/hooks/use-session";
import type { SearchResponse } from "@/lib/api/schema";

/**
 * Hook que pegue a `GET /search?q=...` con debounce.
 *
 * Devuelve `{ query, setQuery, results, isLoading }`. La query se debounce
 * 180ms (sweet spot entre responsiveness y no-spam). Bajo 2 chars devuelve
 * `null` sin pegarle al backend (el endpoint también short-circuit, pero
 * evitamos el round-trip).
 */
export function useSearch() {
  const { session, loading: sessionLoading } = useSession();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 180);
    return () => clearTimeout(t);
  }, [query]);

  const enabled = !sessionLoading && debounced.length >= 2;

  const { data, isLoading, isFetching } = useQuery<SearchResponse, Error>({
    queryKey: ["search", debounced],
    queryFn: () =>
      apiClient.get<SearchResponse>(
        `/search?q=${encodeURIComponent(debounced)}`,
        session,
      ),
    enabled,
    staleTime: 30_000, // 30s — los hits cambian poco mientras tipeás
  });

  return {
    query,
    setQuery,
    results: enabled ? data ?? null : null,
    isLoading: enabled && (isLoading || isFetching),
  };
}
