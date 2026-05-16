/**
 * /validacion — alias permanente a /transferencias.
 *
 * Round 64 — el operador buscaba la "pestaña de validación de pagos"
 * pero estaba bajo /transferencias. En vez de mover la página, creamos
 * este alias por server-side redirect: si alguien escribe /validacion
 * en la URL o tiene un link viejo, llega al mismo lugar.
 *
 * Página real: app/(app)/transferencias/page.tsx
 */
import { redirect } from "next/navigation";
import type { Route } from "next";

export default function ValidacionRedirectPage() {
  redirect("/transferencias" as Route);
}
