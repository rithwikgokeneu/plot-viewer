"use client";

import { useEffect, useRef, useState } from "react";
import PlotMap from "@/components/PlotMap";
import { detectPlots } from "@/lib/detect";
import { fetchPlots, seedPlotsRemote } from "@/lib/api";
import {
  PROC_MAX,
  STATUS,
  STATUS_ORDER,
  countByStatus,
  fit,
  type Plot,
  type Status,
} from "@/lib/plot";

const BUNDLED_MAP = "/plotmap.png";
const POLL_MS = 4000;

export default function PublicViewer() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [proc, setProc] = useState({ w: 0, h: 0 });
  const [plots, setPlots] = useState<Plot[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loaded, setLoaded] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    let url: string | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    function detectOn(image: HTMLImageElement, pw: number, ph: number): Plot[] {
      const canvas = document.createElement("canvas");
      canvas.width = pw;
      canvas.height = ph;
      const ctx = canvas.getContext("2d");
      if (!ctx) return [];
      ctx.drawImage(image, 0, 0, pw, ph);
      const data = ctx.getImageData(0, 0, pw, ph);
      const found = detectPlots(
        { data: data.data, width: pw, height: ph },
        { minAreaFrac: 0.0003, maxAreaFrac: 0.12 }
      );
      return found.map((f, i) => ({
        id: i + 1,
        num: String(i + 1),
        polygon: f.polygon,
        centroid: f.centroid,
        status: "available" as Status,
      }));
    }

    (async () => {
      try {
        const res = await fetch(BUNDLED_MAP);
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        const image = new window.Image();
        image.onload = async () => {
          const pr = fit(image.width, image.height, PROC_MAX, PROC_MAX);
          if (cancelled.current) return;
          setProc({ w: pr.w, h: pr.h });
          setImgUrl(url);
          try {
            const state = await fetchPlots();
            if (state.plots.length > 0) {
              if (!cancelled.current) setPlots(state.plots);
            } else {
              const seeded = detectOn(image, pr.w, pr.h);
              if (!cancelled.current) setPlots(seeded);
              await seedPlotsRemote(seeded, pr.w, pr.h);
            }
          } catch {
            /* keep showing the map even if the DB read fails */
          }
          if (!cancelled.current) setLoaded(true);
          // Live updates: re-read shared state every few seconds.
          poll = setInterval(async () => {
            try {
              const s = await fetchPlots();
              if (!cancelled.current && s.plots.length > 0) setPlots(s.plots);
            } catch {
              /* ignore transient poll errors */
            }
          }, POLL_MS);
        };
        image.onerror = () => setLoaded(true);
        image.src = url;
      } catch {
        setLoaded(true);
      }
    })();

    return () => {
      cancelled.current = true;
      if (poll) clearInterval(poll);
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
      {/* Map on the left. */}
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
            <h2 className="font-semibold">Available</h2>
            <span className="text-3xl font-bold text-green-700">{counts.available}</span>
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
            {counts.none > 0 && (
              <div className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded-sm border border-dashed border-neutral-400" />
                <span className="text-neutral-600">Unmarked</span>
                <span className="ml-auto font-semibold tabular-nums">{counts.none}</span>
              </div>
            )}
            <div className="mt-1 flex items-center gap-2 border-t border-neutral-100 pt-2 text-neutral-500">
              <span>Total plots</span>
              <span className="ml-auto font-semibold tabular-nums">{plots.length}</span>
            </div>
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
