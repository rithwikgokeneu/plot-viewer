import Link from "next/link";
import { listProjects } from "@/lib/db";
import AdminProjectsList from "@/components/AdminProjectsList";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const projects = await listProjects();
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Projects</h1>
        <div className="flex items-center gap-3">
          <Link href="/" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            View site
          </Link>
          <form action="/api/admin/logout" method="post">
            <button className="text-xs text-neutral-500 underline hover:text-neutral-800">Log out</button>
          </form>
        </div>
      </header>
      <AdminProjectsList
        initial={projects.map((p) => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          status: p.status,
          count: p.plots.length,
        }))}
      />
    </main>
  );
}
