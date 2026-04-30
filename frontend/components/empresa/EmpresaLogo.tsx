"use client";

import Image from "next/image";
import { Building2 } from "lucide-react";

/**
 * Mapeo código de empresa → archivo de logo en `/public/logos/`.
 *
 * Las que no tienen logo (CENERGY al momento de hoy) caen al fallback
 * con icono Building2 + iniciales.
 */
const LOGO_MAP: Record<string, string> = {
  AFIS: "/logos/afis.jpg",
  CSL: "/logos/csl.png",
  DTE: "/logos/dte.png",
  EVOQUE: "/logos/evoque.png",
  REVTECH: "/logos/revtech.png",
  RHO: "/logos/rho.png",
  TRONGKAI: "/logos/trongkai.png",
  FIP_CEHTA: "/logos/cehta.png",
  CEHTA: "/logos/cehta.png",
};

interface Props {
  empresaCodigo: string;
  size?: number;
  className?: string;
  /** Forzar fallback (icono) ignorando el logo. Útil si el logo no carga. */
  forceFallback?: boolean;
  /** Mostrar el logo dentro de un círculo con borde. Default true. */
  rounded?: boolean;
}

/**
 * Renderea el logo de una empresa por código. Si no hay logo registrado,
 * cae a un fallback con `Building2` + las primeras 2 letras del código.
 */
export function EmpresaLogo({
  empresaCodigo,
  size = 40,
  className = "",
  forceFallback = false,
  rounded = true,
}: Props) {
  const upper = empresaCodigo.toUpperCase();
  const logo = forceFallback ? null : LOGO_MAP[upper];
  const initials = upper.slice(0, 2);

  const containerClass = `inline-flex shrink-0 items-center justify-center overflow-hidden bg-white ${
    rounded ? "rounded-2xl ring-1 ring-hairline" : ""
  } ${className}`;

  if (logo) {
    return (
      <span
        className={containerClass}
        style={{ width: size, height: size }}
        title={empresaCodigo}
      >
        <Image
          src={logo}
          alt={`Logo ${empresaCodigo}`}
          width={size}
          height={size}
          className="h-full w-full object-contain p-1"
          unoptimized
        />
      </span>
    );
  }

  // Fallback: icono + iniciales
  return (
    <span
      className={`${containerClass} bg-cehta-green/10 text-cehta-green`}
      style={{ width: size, height: size }}
      title={empresaCodigo}
    >
      {size >= 32 ? (
        <span className="font-display text-sm font-semibold tracking-tight">
          {initials}
        </span>
      ) : (
        <Building2
          className="text-cehta-green"
          style={{ width: size * 0.5, height: size * 0.5 }}
          strokeWidth={1.75}
        />
      )}
    </span>
  );
}
