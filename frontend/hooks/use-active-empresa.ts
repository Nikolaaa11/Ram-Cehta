"use client";

/**
 * useActiveEmpresa — V5++ ola BR.
 *
 * Estado global compartido de "empresa activa" para que el brand del
 * sidebar (logo + nombre) se sincronice con la empresa que el user
 * está mirando en el sidebar empresas-nav (expandida) o navegando
 * por URL /empresa/{codigo}.
 *
 * Fuentes de verdad (en orden):
 *   1. URL /empresa/{codigo}/* → si está, gana
 *   2. URL ?empresa_codigo={codigo} → si está, gana
 *   3. localStorage 'sidebar-empresa-expanded' → última empresa expandida
 *   4. null → default (Cehta Capital)
 *
 * Setear el valor:
 *   const { setActive } = useActiveEmpresa();
 *   setActive("EVOQUE");   // dispara update en todos los componentes
 *   setActive(null);       // limpia
 *
 * NO usa Context para evitar re-mount complejidades — usa custom event
 * + storage event para cross-tab sync.
 */
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const STORAGE_KEY = "sidebar-empresa-expanded";
const CHANGE_EVENT = "cehta:active-empresa-change";

function readFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function readFromUrl(pathname: string): string | null {
  // /empresa/{codigo}/* o /empresa/{codigo}
  const m = pathname.match(/^\/empresa\/([A-Z_][A-Z0-9_]*)/);
  if (m && m[1]) return m[1];

  // ?empresa_codigo={codigo} en query
  if (typeof window !== "undefined") {
    const sp = new URLSearchParams(window.location.search);
    const v = sp.get("empresa_codigo");
    if (v && /^[A-Z_][A-Z0-9_]*$/i.test(v)) return v.toUpperCase();
  }
  return null;
}

export function useActiveEmpresa() {
  const pathname = usePathname() ?? "";
  const urlEmpresa = readFromUrl(pathname);

  // El "valor stored" lo lee y mantiene en sync con localStorage / custom events
  const [stored, setStored] = useState<string | null>(() => readFromStorage());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setStored(e.newValue);
      }
    };
    const onCustom = (e: Event) => {
      const ce = e as CustomEvent<{ codigo: string | null }>;
      setStored(ce.detail?.codigo ?? null);
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, onCustom);
    };
  }, []);

  // Prioridad: URL > stored
  const active = urlEmpresa ?? stored;

  const setActive = (codigo: string | null) => {
    try {
      if (codigo) {
        localStorage.setItem(STORAGE_KEY, codigo);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // ignore
    }
    setStored(codigo);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(CHANGE_EVENT, { detail: { codigo } }),
      );
    }
  };

  return { active, setActive };
}
