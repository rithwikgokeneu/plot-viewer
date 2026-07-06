"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) router.push("/admin");
    else setErr(true);
  }

  return (
    <main className="mx-auto mt-20 max-w-sm px-6">
      <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-6">
        <h1 className="text-lg font-semibold">Admin login</h1>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          autoFocus
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {err && <p className="text-sm text-red-600">Wrong password.</p>}
        <button className="rounded bg-blue-600 px-3 py-2 font-medium text-white">Enter</button>
      </form>
    </main>
  );
}
