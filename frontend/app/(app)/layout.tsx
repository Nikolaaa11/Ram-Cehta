import Link from "next/link";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/oc", label: "Órdenes de Compra" },
  { href: "/proveedores", label: "Proveedores" },
  { href: "/movimientos", label: "Movimientos" },
  { href: "/f29", label: "F29" },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 border-r bg-card p-6">
        <div className="mb-8">
          <h2 className="text-lg font-semibold">Cehta Capital</h2>
          <p className="text-xs text-muted-foreground">FIP CEHTA ESG</p>
        </div>
        <nav className="space-y-1">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="block rounded-md px-3 py-2 text-sm text-foreground hover:bg-accent"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>
      <main className="flex-1 p-8">{children}</main>
    </div>
  );
}
