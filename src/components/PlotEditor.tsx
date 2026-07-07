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

const BUNDLED_MAP = "/plotmap.png";
const ADMIN_PW = process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "admin";
const MAX_UNDO = 40;

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
  const [undoStack, setUndoStack] = useState<Plot[][]>([]);
  const [busy, setBusy] = useState<string | null>("Loading map…");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [tilt, setTilt] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const procRef = useRef({ w: 0, h: 0 });
  const plotsRef = useRef<Plot[]>([]);

  // Keep a live ref of the current plots so mutations + undo read fresh values.
  useEffect(() => {
    plotsRef.current = plots;
  }, [plots]);

  const runDetect = useCallback(
    (image: HTMLImageElement, pw: number, ph: number): Plot[] => {
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

  const persist = useCallback(async (nextPlots: Plot[]) => {
    try {
      await savePlotsRemote(nextPlots, procRef.current.w, procRef.current.h, ADMIN_PW);
      setSavedAt(Date.now());
    } catch {
      setError("Couldn't save to the server — check your connection and retry.");
    }
  }, []);

  // Apply an edit: snapshot the current plots for undo, update state + DB.
  const commit = useCallback(
    (next: Plot[]) => {
      setUndoStack((s) => [...s.slice(-(MAX_UNDO - 1)), plotsRef.current]);
      plotsRef.current = next;
      setPlots(next);
      void persist(next);
    },
    [persist]
  );

  function undo() {
    setUndoStack((s) => {
      if (s.length === 0) return s;
      const prev = s[s.length - 1];
      plotsRef.current = prev;
      setPlots(prev);
      void persist(prev);
      return s.slice(0, -1);
    });
  }

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
              plotsRef.current = state.plots;
              setPlots(state.plots);
              setTilt(estimateTilt(state.plots));
              setSavedAt(state.updatedAt);
              setBusy(null);
            } else {
              setBusy("Detecting plots…");
              const next = runDetect(image, pr.w, pr.h);
              plotsRef.current = next;
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

  function addPlot(polygon: Pt[]) {
    let cx = 0, cy = 0;
    for (const pt of polygon) { cx += pt.x; cy += pt.y; }
    const cur = plotsRef.current;
    const nextId = cur.reduce((m, p) => Math.max(m, p.id), 0) + 1;
    commit([...cur, {
      id: nextId, num: "", polygon,
      centroid: { x: cx / polygon.length, y: cy / polygon.length },
      status: "available" as Status,
      box: polygon, // render a freshly drawn box exactly as drawn
    }]);
  }

  function setStatus(id: number, status: Status) {
    commit(plotsRef.current.map((p) => (p.id === id ? { ...p, status } : p)));
  }

  function updateBox(id: number, box: Pt[]) {
    let cx = 0, cy = 0;
    for (const pt of box) { cx += pt.x; cy += pt.y; }
    const centroid = { x: cx / box.length, y: cy / box.length };
    commit(plotsRef.current.map((p) => (p.id === id ? { ...p, box, centroid } : p)));
  }

  function removePlot(id: number) {
    commit(plotsRef.current.filter((p) => p.id !== id));
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
            onClick={() => { setAddMode((v) => !v); setEditMode(false); }}
            className={`rounded px-3 py-2 text-sm font-medium ${addMode ? "bg-blue-600 text-white" : "border border-blue-600 text-blue-700"}`}
          >
            {addMode ? "Done adding" : "+ Add plot box"}
          </button>
          <button
            onClick={() => { setEditMode((v) => !v); setAddMode(false); }}
            className={`rounded px-3 py-2 text-sm font-medium ${editMode ? "bg-blue-600 text-white" : "border border-blue-600 text-blue-700"}`}
          >
            {editMode ? "Done editing" : "✎ Edit boxes"}
          </button>
          <button
            onClick={undo}
            disabled={undoStack.length === 0}
            title="Undo the last change (restores deleted plots / reverts a status)"
            className="rounded border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-40"
          >
            ↶ Undo{undoStack.length ? ` (${undoStack.length})` : ""}
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
          editMode={editMode}
          onUpdateBox={updateBox}
        />

        <p className="text-xs text-neutral-500">
          {addMode
            ? "Add mode: drag a box around a plot the detector missed. It tilts to match automatically."
            : editMode
            ? "Edit mode: click a box to select it, then drag a corner to resize or drag the middle to move. Changes save instantly — use Undo to revert."
            : "Click a plot to set its status (colour) or delete it. Changes save to the live database instantly — use Undo to revert."}
        </p>
      </div>

      <div className="flex w-full shrink-0 flex-col gap-4 text-sm lg:w-72">
        <div className="rounded-lg border border-neutral-200 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-semibold">Available</h2>
            <span className="text-3xl font-bold text-green-700">{counts.available}</span>
          </div>
          <div className="flex flex-col gap-2">
            {STATUS_ORDER.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span className="inline-block h-3.5 w-3.5 rounded-sm" style={{ backgroundColor: STATUS[s].color }} />
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
      </div>
    </div>
  );
}
