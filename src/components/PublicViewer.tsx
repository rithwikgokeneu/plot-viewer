"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { STATUS, STATUS_ORDER, countByStatus, type Plot } from "@/lib/plot";

// SSR-safe: OpenSeadragon (via DeepZoomMap) touches `document` at module load,
// which would 500 this server-rendered page. Load client-side only — mirrors
// the fix already applied to PlotEditor.tsx for the same reason.
const DeepZoomMap = dynamic(() => import("@/components/DeepZoomMap"), { ssr: false });

interface Props {
  name: string;
  dziUrl: string;
  natW: number;
  natH: number;
  plots: Plot[]; // normalized
}

// `name` is part of the contract (the page passes project.name) but the
// page itself renders the <h1>; PublicViewer doesn't need to repeat it.
export default function PublicViewer({ dziUrl, natW, natH, plots }: Props) {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const counts = countByStatus(plots);
  const selected = plots.find((p) => p.id === selectedId) || null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        <DeepZoomMap
          dziUrl={dziUrl}
          natW={natW}
          natH={natH}
          plots={plots}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col gap-4 text-sm lg:flex">
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">Availability</h2>
            <span className="text-3xl font-bold">{plots.length}</span>
          </div>
          <Legend counts={counts} />
        </div>
        <div className="rounded-lg border border-neutral-200 p-4">
          <h3 className="mb-2 font-semibold">Selected plot</h3>
          {selected ? <StatusBadge plot={selected} /> : <p className="text-neutral-500">Tap a plot on the map.</p>}
        </div>
      </aside>

      {/* Mobile: compact legend strip + bottom sheet on selection */}
      <div className="flex flex-wrap gap-3 rounded-lg border border-neutral-200 p-3 text-xs lg:hidden">
        <span className="font-semibold">{plots.length} plots</span>
        {STATUS_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: STATUS[s].color }} />
            {counts[s]}
          </span>
        ))}
      </div>
      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-20 flex items-center justify-between gap-3 border-t border-neutral-200 bg-white p-4 shadow-2xl lg:hidden">
          <div>
            <p className="text-xs text-neutral-500">Plot {selected.num || selected.id}</p>
            <StatusBadge plot={selected} />
          </div>
          <button
            onClick={() => setSelectedId(null)}
            className="min-h-11 min-w-11 rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function Legend({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="flex flex-col gap-2">
      {STATUS_ORDER.map((s) => (
        <div key={s} className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: STATUS[s].color }} />
          <span className="text-neutral-600">{STATUS[s].label}</span>
          <span className="ml-auto font-semibold tabular-nums">{counts[s]}</span>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ plot }: { plot: Plot }) {
  return (
    <span
      className="inline-block rounded px-2 py-1 text-xs font-medium text-white"
      style={{ backgroundColor: STATUS[plot.status].color }}
    >
      {STATUS[plot.status].label}
    </span>
  );
}
