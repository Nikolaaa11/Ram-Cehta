/**
 * /vouchers — Server Component (V5++ perf refactor).
 *
 * SSR fetch del catálogo de empresas + lista de vouchers (sin filtros)
 * para que el primer paint muestre la tabla completa sin loading.
 *
 * Si el user aplica filtros, el queryKey cambia y la query refetchea
 * normalmente desde el client.
 */
import { serverApiGet } from "@/lib/api/server";
import { VouchersClientView } from "./VouchersClientView";
import type { VoucherListItem } from "@/lib/api/schema";

interface Empresa {
  codigo: string;
  razon_social: string;
}

async function safeGet<T>(path: string): Promise<T | undefined> {
  try {
    return await serverApiGet<T>(path);
  } catch {
    return undefined;
  }
}

export default async function VouchersListPage() {
  // Promise.all paraleliza ambos fetchs en el server
  const [empresas, vouchers] = await Promise.all([
    safeGet<Empresa[]>("/empresa"),
    safeGet<VoucherListItem[]>("/vouchers?limit=200"),
  ]);

  return (
    <VouchersClientView
      initialEmpresas={empresas}
      initialVouchers={vouchers}
    />
  );
}
