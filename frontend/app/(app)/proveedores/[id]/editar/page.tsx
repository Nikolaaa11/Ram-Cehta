import { notFound } from "next/navigation";
import { serverApiGet } from "@/lib/api/server";
import { ApiError } from "@/lib/api/client";
import { ProveedorEditForm } from "@/components/proveedores/ProveedorEditForm";
import type { ProveedorRead } from "@/lib/api/schema";

export default async function EditarProveedorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const proveedorId = Number(id);
  if (!Number.isInteger(proveedorId) || proveedorId <= 0) notFound();

  let proveedor: ProveedorRead;
  try {
    proveedor = await serverApiGet<ProveedorRead>(
      `/proveedores/${proveedorId}`,
    );
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return <ProveedorEditForm initialData={proveedor} />;
}
