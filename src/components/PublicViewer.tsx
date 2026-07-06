"use client";

import { useEffect, useState } from "react";
import PlotMap from "@/components/PlotMap";
import {
  STATUS,
  STATUS_ORDER,
  countByStatus,
  loadProject,
  type Plot,
} from "@/lib/plot";

export default function PublicViewer() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [proc, setProc] = useState({ w: 0, h: 0 });
  const [plots, setPlots] = useState<Plot[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    (async () => {
      const p = await loadProject();
      if (p) {
        url = URL.createObjectURL(p.image);
        setImgUrl(url);
        setProc({ w: p.procW, h: p.procH });
        setPlots(p.plots);
      }
      setLoaded(true);
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  const counts = countByStatus(plots);
  const selected = plots.find((p) => p.id === selectedId) || null;

  if (loaded && !imgUrl) {
    return (
      <div className="rounded-lg border border-neutral-200 p-8 text-center text-neutral-600">
        No layout published yet. The project admin needs to upload and publish a
        plot map.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">
        {imgUrl && (
          <PlotMap
            imgUrl={imgUrl}
            procW={proc.w}
            procH={proc.h}
            plots={plots}
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(id)}
          />
        )}
      </div>

      <div className="flex w-full shrink-0 flex-col gap-4 text-sm lg:w-72">
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">Availability</h2>
            <span className="text-3xl font-bold">{plots.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {STATUS_ORDER.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span
                  className="inline-block h-3.5 w-3.5 rounded-sm"
                  style={{ backgroundColor: STATUS[s].color }}
                />
                <span className="text-neutral-600">{STATUS[s].label}</span>
                <span className="ml-auto font-semibold tabular-nums">{counts[s]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-neutral-200 p-4">
          <h3 className="mb-2 font-semibold">Selected plot</h3>
          {selected ? (
            <span
              className="inline-block rounded px-2 py-1 text-xs font-medium text-white"
              style={{ backgroundColor: STATUS[selected.status].color }}
            >
              {STATUS[selected.status].label}
            </span>
          ) : (
            <p className="text-neutral-500">Tap a plot on the map.</p>
          )}
        </div>
      </div>
    </div>
  );
}
