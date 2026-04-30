"use client";

/**
 * V4 fase 5 — Empresas pinneadas por user.
 *
 * Reusa `app.user_preferences` con key `pinned_empresas`.
 * Value es un array de empresa codigos: `["CENERGY", "RHO", "TRONGKAI"]`.
 *
 * Caso de uso: el operativo marca sus 2-3 empresas más usadas y aparecen
 * en una sección "FAVORITOS" al tope del sidebar. Cap defensivo de 5 pins.
 */

import { useUserPreference, useSetUserPreference } from "@/hooks/use-user-preferences";

export const PINNED_EMPRESAS_KEY = "pinned_empresas";
export const MAX_PINNED = 5;

type PinnedState = string[];

export function usePinnedEmpresas() {
  const query = useUserPreference<PinnedState>(PINNED_EMPRESAS_KEY, []);
  const setMut = useSetUserPreference<PinnedState>();

  const pinned = query.data ?? [];

  const isPinned = (codigo: string) => pinned.includes(codigo);

  const togglePin = async (codigo: string) => {
    let next: PinnedState;
    if (pinned.includes(codigo)) {
      next = pinned.filter((c) => c !== codigo);
    } else {
      if (pinned.length >= MAX_PINNED) {
        // Drop oldest, add new — FIFO behavior con cap defensivo
        next = [...pinned.slice(1), codigo];
      } else {
        next = [...pinned, codigo];
      }
    }
    await setMut.mutateAsync({ key: PINNED_EMPRESAS_KEY, value: next });
    return next;
  };

  return {
    pinned,
    isPinned,
    togglePin,
    isLoading: query.isLoading,
    isPending: setMut.isPending,
    isFull: pinned.length >= MAX_PINNED,
  };
}
