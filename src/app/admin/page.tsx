import Link from "next/link";
import AdminClient from "@/components/AdminClient";

export default function AdminPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Admin Dashboard</h1>
          <p className="text-sm text-neutral-600">
            Upload a layout, auto-detect plots, and manage availability. Changes
            publish to the public view automatically.
          </p>
        </div>
        <Link
          href="/"
          className="shrink-0 rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          View public
        </Link>
      </header>
      <AdminClient />
    </main>
  );
}
