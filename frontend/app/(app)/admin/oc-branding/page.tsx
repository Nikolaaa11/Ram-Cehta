/**
 * R152RRRR — Redirect permanente.
 *
 * La pantalla de "Branding + emails OC" se consolidó adentro del módulo
 * Operaciones → Órdenes de Compra (tab "Configuración"). El link viejo
 * del sidebar fue removido; cualquier bookmark queda apuntando acá y
 * salta a la nueva ubicación sin que el usuario se pierda.
 */
import { redirect } from "next/navigation";

export default function OcBrandingLegacyRedirect() {
  redirect("/ordenes-compra?tab=config");
}
