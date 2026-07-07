"use client";

import { useEffect, useState } from "react";
import PlotMap from "@/components/PlotMap";
import { detectPlots } from "@/lib/detect";
import {
  PROC_MAX,
  STATUS,
  STATUS_ORDER,
  countByStatus,
  fit,
  loadProject,
  type Plot,
  type Status,
} from "@/lib/plot";

// Bundled map — same asset the editor pre-loads. Public falls back to it (and
// auto-detects, read-only) when this browser has no admin-saved project yet,
// so the public view always shows the map instead of an empty state.
const BUNDLED_MAP = "/plotmap.png";

export default function PublicViewer() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [proc, setProc] = useState({ w: 0, h: 0 });
  const [plots, setPlots] = useState<Plot[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    (async () => {
      // 1) Prefer the admin-saved project (includes status edits).
      const p = await loadProject();
      if (p) {
        url = URL.createObjectURL(p.image);
        setImgUrl(url);
        setProc({ w: p.procW, h: p.procH });
        setPlots(p.plots);
        setLoaded(true);
        return;
      }
      // 2) Fallback: load the bundled map and auto-detect (read-only display).
      try {
        const res = await fetch(BUNDLED_MAP);
        if (!res.ok) throw new Error("fetch failed");
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        const image = new window.Image();
        image.onload = () => {
          const pr = fit(image.width, image.height, PROC_MAX, PROC_MAX);
          const canvas = document.createElement("canvas");
          canvas.width = pr.w;
          canvas.height = pr.h;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.drawImage(image, 0, 0, pr.w, pr.h);
            const data = ctx.getImageData(0, 0, pr.w, pr.h);
            const found = detectPlots(
              { data: data.data, width: pr.w, height: pr.h },
              { minAreaFrac: 0.0003, maxAreaFrac: 0.12 }
            );
            setPlots(
              found.map((f, i) => ({
                id: i + 1,
                num: String(i + 1),
                polygon: f.polygon,
                centroid: f.centroid,
                status: "available" as Status,
              }))
            );
          }
          setProc({ w: pr.w, h: pr.h });
          setImgUrl(url);
          setLoaded(true);
        };
        image.onerror = () => setLoaded(true);
        image.src = url;
      } catch {
        setLoaded(true);
      }
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
        Could not load the plot map.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      {/* Map on the left (fills the space, fits the viewport height). */}
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

      {/* Availability box on the right. */}
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
