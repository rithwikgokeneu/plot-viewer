"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectPlots, type Pt } from "@/lib/detect";
import PlotMap from "@/components/PlotMap";
import { fetchPlots, savePlotsRemote, seedPlotsRemote } from "@/lib/api";
import {
  PROC_MAX,
  STATUS,
  STATUS_ORDER,
  countByStatus,
  fit,
  type Plot,
  type Status,
} from "@/lib/plot";

// Bundled map (static asset) + shared live DB for the plot data.
const BUNDLED_MAP = "/plotmap.png";
const ADMIN_PW = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "admin";

// Orientation (radians) of a convex polygon's minimum-area bounding rectangle.
function minAreaRectAngle(poly: Pt[]): number {
  let bestArea = Infinity;
  let bestAng = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(-ang);
    const sin = Math.sin(-ang);
    let minx = Infinity, maxx = -Infinity, miny = Infinity, maxy = -Infinity;
    for (const p of poly) {
      const rx = p.x * cos - p.y * sin;
      const ry = p.x * sin + p.y * cos;
      if (rx < minx) minx = rx;
      if (rx > maxx) maxx = rx;
      if (ry < miny) miny = ry;
      if (ry > maxy) maxy = ry;
    }
    const area = (maxx - minx) * (maxy - miny);
    if (area < bestArea) {
      bestArea = area;
      bestAng = ang;
    }
  }
  return bestAng;
}

function estimateTilt(plots: Plot[]): number {
  const angles: number[] = [];
  for (const p of plots) {
    if (p.polygon.length < 3) continue;
    const deg = (minAreaRectAngle(p.polygon) * 180) / Math.PI;
    angles.push(((((deg + 45) % 90) + 90) % 90) - 45);
  }
  if (angles.length === 0) return 0;
  angles.sort((a, b) => a - b);
  return Math.round(angles[angles.length >> 1]);
}

export default function PlotEditor() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [proc, setProc] = useState({ w: 0, h: 0 });
  const [plots, setPlots] = useState<Plot[]>([]);
  const [threshold, setThreshold] = useState<number>(-1);
  const [invert, setInvert] = useState(false);
  const [busy, setBusy] = useState<string | null>("Loading map…");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [tilt, setTilt] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const procRef = useRef({ w: 0, h: 0 });

  const runDetect = useCallback(
    (image: HTMLImageElement, pw: number, ph: number, t: number, inv: boolean): Plot[] => {
      const canvas = document.createElement("canvas");
      canvas.width = pw;
      canvas.height = ph;
      const ctx = canvas.getContext("2d");
      if (!ctx) return [];
      ctx.drawImage(image, 0, 0, pw, ph);
      const data = ctx.getImageData(0, 0, pw, ph);
      const found = detectPlots(
        { data: data.data, width: pw, height: ph },
        { threshold: t < 0 ? undefined : t, invert: inv, minAreaFrac: 0.0003, maxAreaFrac: 0.12 }
      );
      return found.map((p, i) => ({
        id: i + 1,
        num: String(i + 1),
        polygon: p.polygon,
        centroid: p.centroid,
        status: "available" as Status,
      }));
    },
    []
  );

  // Persist the full plots array to the shared DB.
  const persist = useCallback(async (nextPlots: Plot[]) => {
    try {
      await savePlotsRemote(nextPlots, procRef.current.w, procRef.current.h, ADMIN_PW);
      setSavedAt(Date.now());
    } catch {
      setError("Couldn't save to the server — check your connection and retry.");
    }
  }, []);

  // On mount: load the bundled map, then load shared plots from the DB
  // (or auto-detect + seed on first run).
  useEffect(() => {
    let url: string | null = null;
    (async () => {
      try {
        const res = await fetch(BUNDLED_MAP);
        const blob = await res.blob();
        url = URL.createObjectURL(blob);
        const image = new window.Image();
        image.onload = async () => {
          const pr = fit(image.width, image.height, PROC_MAX, PROC_MAX);
          imgRef.current = image;
          procRef.current = { w: pr.w, h: pr.h };
          setImgUrl(url);
          setProc({ w: pr.w, h: pr.h });
          try {
            const state = await fetchPlots();
            if (state.plots.length > 0) {
              setPlots(state.plots);
              setTilt(estimateTilt(state.plots));
              setSavedAt(state.updatedAt);
              setBusy(null);
            } else {
              setBusy("Detecting plots…");
              const next = runDetect(image, pr.w, pr.h, threshold, invert);
              setPlots(next);
              setTilt(estimateTilt(next));
              await seedPlotsRemote(next, pr.w, pr.h);
              setSavedAt(Date.now());
              setBusy(null);
            }
          } catch {
            setBusy(null);
            setError("Couldn't reach the server.");
          }
        };
        image.onerror = () => {
          setBusy(null);
          setError("Could not load the map image.");
        };
        image.src = url;
      } catch {
        setBusy(null);
        setError("Could not load the map.");
      }
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function redetect() {
    if (!imgRef.current) return;
    setError(null);
    setBusy("Detecting plots…");
    setTimeout(async () => {
      try {
        const next = runDetect(imgRef.current!, proc.w, proc.h, threshold, invert);
        setPlots(next);
        setTilt(estimateTilt(next));
        await persist(next);
      } catch {
        setError("Re-detect failed — please try again.");
      } finally {
        setBusy(null);
      }
    }, 0);
  }

  function addPlot(polygon: Pt[]) {
    let cx = 0, cy = 0;
    for (const pt of polygon) { cx += pt.x; cy += pt.y; }
    setPlots((prev) => {
      const nextId = prev.reduce((m, p) => Math.max(m, p.id), 0) + 1;
      const next = [...prev, {
        id: nextId, num: "", polygon,
        centroid: { x: cx / polygon.length, y: cy / polygon.length },
        status: "available" as Status,
      }];
      void persist(next);
      return next;
    });
  }

  function setStatus(id: number, status: Status) {
    setPlots((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, status } : p));
      void persist(next);
      return next;
    });
  }

  function removePlot(id: number) {
    setPlots((prev) => {
      const next = prev.filter((p) => p.id !== id);
      void persist(next);
      return next;
    });
  }

  const counts = countByStatus(plots);

  if (!imgUrl) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-center gap-2 rounded-xl border border-neutral-200 bg-neutral-50 p-12 text-center">
        <span className={`text-lg font-medium ${error ? "text-red-600" : "text-neutral-700"}`}>
          {error ?? busy ?? "Loading map…"}
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setAddMode((v) => !v)}
            className={`rounded px-3 py-2 text-sm font-medium ${addMode ? "bg-blue-600 text-white" : "border border-blue-600 text-blue-700"}`}
          >
            {addMode ? "Done adding" : "+ Add plot box"}
          </button>
          {addMode && (
            <label className="flex items-center gap-2 rounded border border-neutral-200 px-2 py-1 text-xs text-neutral-600">
              Tilt
              <input type="range" min={-45} max={45} value={tilt} onChange={(e) => setTilt(Number(e.target.value))} />
              <span className="w-8 tabular-nums">{tilt}°</span>
            </label>
          )}
          <span className="ml-auto flex items-center gap-3 text-xs text-neutral-500">
            {busy && <span className="text-blue-700">{busy}</span>}
            {!busy && error && <span className="text-red-600">{error}</span>}
            {!busy && !error && savedAt && <span className="text-green-700">Saved ✓ (live)</span>}
          </span>
        </div>

        <PlotMap
          imgUrl={imgUrl}
          procW={proc.w}
          procH={proc.h}
          plots={plots}
          onSetStatus={setStatus}
          onDeletePlot={removePlot}
          addMode={addMode}
          onAddPlot={addPlot}
          tilt={(tilt * Math.PI) / 180}
        />

        <p className="text-xs text-neutral-500">
          {addMode
            ? "Add mode: drag a box around a plot the detector missed. It tilts to match automatically."
            : "Click a plot to set its status or delete it. Changes save to the live database instantly."}
        </p>
      </div>

      <div className="flex w-full shrink-0 flex-col gap-4 text-sm lg:w-72">
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">Plots</h2>
            <span className="text-3xl font-bold">{plots.length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {STATUS_ORDER.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: STATUS[s].color }} />
                <span className="text-neutral-600">{STATUS[s].label}</span>
                <span className="ml-auto font-semibold tabular-nums">{counts[s]}</span>
              </div>
            ))}
          </div>
        </div>

        <details className="rounded-lg border border-neutral-200 p-3">
          <summary className="cursor-pointer font-semibold">Detection settings</summary>
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex items-center justify-between gap-2">
              <span className="text-neutral-600">Sensitivity {threshold < 0 ? "(auto)" : threshold}</span>
              <input type="range" min={-1} max={255} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={invert} onChange={(e) => setInvert(e.target.checked)} />
              <span className="text-neutral-600">Invert (plots darker than background)</span>
            </label>
            <button onClick={redetect} disabled={!!busy} className="rounded bg-neutral-800 px-3 py-2 text-white disabled:opacity-40">
              {busy ?? "Re-detect (overwrites live data)"}
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}
