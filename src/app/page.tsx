import Link from "next/link";
import { listProjects } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Home() {
  const published = (await listProjects()).filter((p) => p.status === "published" && p.imageUrl);
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">Plot Projects</h1>
        <Link href="/admin" className="rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50">
          Admin
        </Link>
      </header>
      {published.length === 0 ? (
        <p className="text-neutral-600">No published projects yet.</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {published.map((p) => (
            <li key={p.id}>
              <Link href={`/p/${p.slug}`} className="block rounded-lg border border-neutral-200 p-5 hover:border-blue-400 hover:bg-blue-50/30">
                <h2 className="font-semibold">{p.name}</h2>
                <p className="text-sm text-neutral-500">{p.plots.length} plots</p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
