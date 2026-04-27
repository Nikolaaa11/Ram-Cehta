import { notFound } from "next/navigation";
import { serverApiGet } from "@/lib/api/server";
import { ApiError } from "@/lib/api/client";
import { OcEditForm } from "@/components/ordenes-compra/OcEditForm";
import type { OcRead } from "@/lib/api/schema";

export default async function EditarOcPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ocId = Number(id);
  if (!Number.isInteger(ocId) || ocId <= 0) notFound();

  let oc: OcRead;
  try {
    oc = await serverApiGet<OcRead>(`/ordenes-compra/${ocId}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }

  return <OcEditForm initialData={oc} />;
}
