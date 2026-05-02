import { redirect } from "next/navigation";

/**
 * Redirect — `/portafolio` legacy → `/reportes/portafolio` (la ubicación real).
 *
 * El sidebar antes apuntaba acá pero la página real vive en /reportes/portafolio.
 * Mantenemos el redirect para bookmarks/links viejos.
 */
export default function PortafolioRedirectPage(): never {
  redirect("/reportes/portafolio");
}
