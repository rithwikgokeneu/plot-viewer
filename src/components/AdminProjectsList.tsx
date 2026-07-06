"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface Item {
  id: string;
  name: string;
  slug: string;
  status: "draft" | "published";
  count: number;
}

export default function AdminProjectsList({ initial }: { initial: Item[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [name, setName] = useState("");

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    // Placeholder dims; real dims are set when a map is uploaded in the editor.
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, natW: 1, natH: 1, plots: [] }),
    });
    const { project } = await res.json();
    router.push(`/admin/${project.id}`);
  }

  async function togglePublish(it: Item) {
    const next = it.status === "published" ? "draft" : "published";
    await fetch(`/api/projects/${it.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, status: next } : x)));
  }

  async function remove(it: Item) {
    if (!confirm(`Delete "${it.name}"? This cannot be undone.`)) return;
    await fetch(`/api/projects/${it.id}`, { method: "DELETE" });
    setItems((xs) => xs.filter((x) => x.id !== it.id));
  }

  function copyLink(slug: string) {
    navigator.clipboard.writeText(`${location.origin}/p/${slug}`);
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={create} className="flex flex-wrap gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New project name"
          className="min-w-0 flex-1 rounded border border-neutral-300 px-3 py-2"
        />
        <button className="rounded bg-blue-600 px-4 py-2 font-medium text-white">Create project</button>
      </form>

      {items.length === 0 ? (
        <p className="text-neutral-500">No projects yet. Create one above.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((it) => (
            <li key={it.id} className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/admin/${it.id}`} className="font-semibold hover:underline">
                  {it.name}
                </Link>
                <span
                  className={`rounded px-2 py-0.5 text-xs ${
                    it.status === "published" ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-600"
                  }`}
                >
                  {it.status}
                </span>
              </div>
              <p className="text-xs text-neutral-500">{it.count} plots · /p/{it.slug}</p>
              <div className="mt-auto flex flex-wrap gap-2 text-xs">
                <button onClick={() => togglePublish(it)} className="rounded border border-neutral-300 px-2 py-1">
                  {it.status === "published" ? "Unpublish" : "Publish"}
                </button>
                <button onClick={() => copyLink(it.slug)} className="rounded border border-neutral-300 px-2 py-1">
                  Copy link
                </button>
                <button onClick={() => remove(it)} className="rounded bg-red-50 px-2 py-1 text-red-600">
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
