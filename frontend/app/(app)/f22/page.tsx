/**
 * /f22 — Server Component (V5++ perf refactor).
 *
 * SSR fetch del catálogo de empresas + primera página de F22 con filtros
 * vacíos. El cliente recibe ambos como `initialData` de useQuery →
 * tabla + selector visibles instantáneamente sin loading skeleton.
 *
 * Si los fetchs del server fallan (sin sesión, backend down), passing
 * `undefined` deja al cliente fetchear con su skeleton de fallback.
 */
import { serverApiGet } from "@/lib/api/server";
import { F22ClientView } from "./F22ClientView";

interface Empresa {
  codigo: string;
  razon_social: string;
}

interface F22Item {
  f22_id: number;
  empresa_codigo: string;
  ano_tributario: number;
  fecha_vencimiento: string;
  monto_a_pagar: string | number | null;
  fecha_pago: string | null;
  estado: string;
  comprobante_url: string | null;
  dropbox_path: string | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
}

interface PageF22 {
  items: F22Item[];
  total: number;
  page: number;
  size: number;
}

async function safeGet<T>(path: string): Promise<T | undefined> {
  try {
    return await serverApiGet<T>(path);
  } catch {
    return undefined;
  }
}

export default async function F22Page() {
  // Paralelizamos los 2 fetchs server-side (Promise.all)
  const [empresas, f22Page] = await Promise.all([
    safeGet<Empresa[]>("/empresa"),
    safeGet<PageF22>("/f22?size=50&page=1"),
  ]);

  return (
    <F22ClientView
      initialEmpresas={empresas}
      initialF22Page={f22Page}
    />
  );
}
