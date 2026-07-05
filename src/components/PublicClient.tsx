"use client";

import dynamic from "next/dynamic";

const PublicViewer = dynamic(() => import("./PublicViewer"), {
  ssr: false,
  loading: () => <p className="text-sm text-neutral-500">Loading…</p>,
});

export default function PublicClient() {
  return <PublicViewer />;
}
