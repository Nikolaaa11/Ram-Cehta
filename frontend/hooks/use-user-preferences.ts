"use client";

/**
 * V4 fase 4 — onboarding tour for first-time users.
 *
 * Hooks TanStack Query para leer/escribir preferencias per-user en
 * `app.user_preferences` (key-value genérico).
 *
 * Endpoints backend:
 *   - GET  /me/preferences/{key}  → 200 {key, value} | 404 si no existe
 *   - PUT  /me/preferences/{key}  → 200 (upsert via ON CONFLICT)
 *
 * Conventions:
 *   - 404 GET no es error: indica "primera vez" — devolvemos `defaultValue`.
 *   - PUT invalida la query con la misma key para que cualquier subscriber
 *     se entere del nuevo estado sin un round-trip extra.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/use-session";
import { ApiError, apiClient } from "@/lib/api/client";
import type { TourState, UserPreferenceRead } from "@/lib/api/schema";

const PREF_KEY_PREFIX = ["user-preferences"] as const;

export const TOUR_PREFERENCE_KEY = "onboarding_tour";
export const TOUR_TOTAL_STEPS = 5;

export function useUserPreference<T>(key: string, defaultValue: T) {
  const { session, loading } = useSession();
  return useQuery<T, Error>({
    queryKey: [...PREF_KEY_PREFIX, key],
    queryFn: async () => {
      try {
        const res = await apiClient.get<UserPreferenceRead>(
          `/me/preferences/${encodeURIComponent(key)}`,
          session,
        );
        return res.value as T;
      } catch (err) {
        // 404 ⇒ "primera vez": devolvemos defaultValue como si fuera el estado.
        if (err instanceof ApiError && err.status === 404) {
          return defaultValue;
        }
        throw err;
      }
    },
    enabled: !loading && !!session,
    staleTime: 60_000,
  });
}

export function useSetUserPreference<T = unknown>() {
  const { session } = useSession();
  const qc = useQueryClient();
  return useMutation<UserPreferenceRead, Error, { key: string; value: T }>({
    mutationFn: ({ key, value }) =>
      apiClient.put<UserPreferenceRead>(
        `/me/preferences/${encodeURIComponent(key)}`,
        { value },
        session,
      ),
    onSuccess: (_data, variables) => {
      // Invalidar la query de esa key para que `useUserPreference` re-fetch.
      qc.invalidateQueries({
        queryKey: [...PREF_KEY_PREFIX, variables.key],
      });
    },
  });
}

/**
 * Hook especializado para el onboarding tour. Wrapping de
 * `useUserPreference<TourState>` con default `{completed: false, current_step: 0}`.
 *
 * El componente `<OnboardingTour />` lee este estado para decidir si
 * renderizarse o no, y `<TourTrigger />` lo usa para auto-disparar el primer
 * step en first login.
 */
export function useTourState() {
  const DEFAULT: TourState = { completed: false, current_step: 0 };
  const query = useUserPreference<TourState>(TOUR_PREFERENCE_KEY, DEFAULT);
  const setMut = useSetUserPreference<TourState>();

  return {
    state: query.data ?? DEFAULT,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    setState: (next: TourState) =>
      setMut.mutateAsync({ key: TOUR_PREFERENCE_KEY, value: next }),
    isPending: setMut.isPending,
  };
}
