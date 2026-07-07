import Link from "next/link";
import PublicClient from "@/components/PublicClient";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Plot Availability</h1>
          <p className="text-sm text-neutral-600">
            Browse the layout. Green plots are available. Click a plot to see its
            status.
          </p>
        </div>
        <Link
          href="/admin"
          className="shrink-0 rounded border border-neutral-300 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50"
        >
          Admin
        </Link>
      </header>
      <PublicClient />
    </main>
  );
}
