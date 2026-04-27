import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft } from "lucide-react";
import { UsersTable } from "@/components/admin/UsersTable";

export default function AdminUsuariosPage() {
  return (
    <div className="mx-auto max-w-[1200px] space-y-6">
      <div>
        <Link
          href={"/admin" as Route}
          className="inline-flex items-center gap-1 text-xs font-medium text-ink-500 transition-colors hover:text-cehta-green"
        >
          <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
          Panel admin
        </Link>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-ink-900">
          Usuarios
        </h1>
        <p className="mt-1 text-sm text-ink-500">
          Asigná roles (admin · finance · viewer) y revocá accesos. Los usuarios
          deben estar registrados en Supabase Auth antes de poder asignarles un
          rol.
        </p>
      </div>

      <UsersTable />
    </div>
  );
}
