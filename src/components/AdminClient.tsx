"use client";

import dynamic from "next/dynamic";

const AdminGate = dynamic(() => import("./AdminGate"), {
  ssr: false,
  loading: () => <p className="text-sm text-neutral-500">Loading…</p>,
});

export default function AdminClient() {
  return <AdminGate />;
}
