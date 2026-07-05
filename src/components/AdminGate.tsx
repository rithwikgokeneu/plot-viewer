"use client";

import { useEffect, useState } from "react";
import PlotEditor from "@/components/PlotEditor";

// NOTE: this is a UI gate, not real security — NEXT_PUBLIC_* is visible in the
// client bundle. It keeps casual visitors out of the admin controls. Real
// access control needs server-side auth (Supabase Auth is the planned step).
const ADMIN_PASSWORD = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "admin";
const FLAG = "plot-admin-ok";

export default function AdminGate() {
  const [authed, setAuthed] = useState(false);
  const [pw, setPw] = useState("");
  const [err, setErr] = useState(false);

  useEffect(() => {
    setAuthed(sessionStorage.getItem(FLAG) === "1");
  }, []);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw === ADMIN_PASSWORD) {
      sessionStorage.setItem(FLAG, "1");
      setAuthed(true);
      setErr(false);
    } else {
      setErr(true);
    }
  }

  function logout() {
    sessionStorage.removeItem(FLAG);
    setAuthed(false);
    setPw("");
  }

  if (!authed) {
    return (
      <form
        onSubmit={submit}
        className="mx-auto mt-10 flex max-w-sm flex-col gap-3 rounded border border-neutral-200 p-6"
      >
        <h2 className="text-lg font-semibold">Admin login</h2>
        <p className="text-sm text-neutral-600">
          Enter the admin password to manage plot status.
        </p>
        <input
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Password"
          autoFocus
          className="rounded border border-neutral-300 px-3 py-2"
        />
        {err && <p className="text-sm text-red-600">Wrong password.</p>}
        <button className="rounded bg-blue-600 px-3 py-2 font-medium text-white">
          Enter
        </button>
      </form>
    );
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <button
          onClick={logout}
          className="text-xs text-neutral-500 underline hover:text-neutral-800"
        >
          Log out
        </button>
      </div>
      <PlotEditor />
    </div>
  );
}
