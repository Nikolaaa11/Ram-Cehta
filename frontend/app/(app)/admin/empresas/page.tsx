/**
 * /admin/empresas — Server Component (V5++ perf refactor).
 *
 * Patrón híbrido SSR+CSR:
 *   1. Server Component fetcha el catálogo de empresas en el primer render
 *      (durante el HTTP response, antes de mandar el HTML al browser).
 *   2. Pasa la lista como prop al EmpresasClientView (Client Component).
 *   3. EmpresasClientView usa la lista como `initialData` de useQuery.
 *   4. Resultado: el user ve la tabla de empresas inmediatamente al cargar
 *      la página, sin un spinner intermedio.
 *
 * Si el fetch del server falla (sin sesión, backend down), pasamos
 * `undefined` y el client hace su fetch normal con el loading.tsx
 * skeleton de fallback.
 *
 * Esta es la PRIMERA page convertida a RSC. Si funciona bien sin
 * regresiones, se replica el patrón en /vouchers, /admin/mailbox, /f22.
 */
import { serverApiGet } from "@/lib/api/server";
import { EmpresasClientView } from "./EmpresasClientView";

interface EmpresaCatalogo {
  codigo: string;
  razon_social: string;
  oc_prefix: string | null;
  rut: string | null;
}

async function safeGetEmpresas(): Promise<EmpresaCatalogo[] | undefined> {
  try {
    return await serverApiGet<EmpresaCatalogo[]>("/catalogos/empresas");
  } catch {
    // Sin sesión válida en SSR (ej: cookie no propagada) o backend down.
    // El client component hace su propio fetch con loading skeleton.
    return undefined;
  }
}

export default async function AdminEmpresasPage() {
  const initialEmpresas = await safeGetEmpresas();
  return <EmpresasClientView initialEmpresas={initialEmpresas} />;
}
