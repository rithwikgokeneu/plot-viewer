"use client";

import { useRef, useState } from "react";
import { STATUS, STATUS_ORDER, type Plot, type Status } from "@/lib/plot";
import type { Pt } from "@/lib/detect";

interface Props {
  imgUrl: string;
  procW: number;
  procH: number;
  plots: Plot[];
  // Admin: clicking a plot opens a status/delete popup.
  onSetStatus?: (id: number, status: Status) => void;
  onDeletePlot?: (id: number) => void;
  // Public: clicking a plot just selects it (read-only).
  selectedId?: number | null;
  onSelect?: (id: number) => void;
  // Add mode: drag to draw a new (tilted) box.
  addMode?: boolean;
  onAddPlot?: (polygon: Pt[]) => void;
  tilt?: number;
}

// Four corners of the drag rectangle, rotated by `ang` around its center.
function rotatedRect(x0: number, y0: number, x1: number, y1: number, ang: number): Pt[] {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hw = Math.abs(x1 - x0) / 2;
  const hh = Math.abs(y1 - y0) / 2;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([dx, dy]) => ({ x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos }));
}

export default function PlotMap({
  imgUrl,
  procW,
  procH,
  plots,
  onSetStatus,
  onDeletePlot,
  selectedId,
  onSelect,
  addMode,
  onAddPlot,
  tilt = 0,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draw, setDraw] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [menu, setMenu] = useState<{ id: number; xPct: number; yPct: number } | null>(null);
  const isAdmin = !!onSetStatus;

  function toProc(e: React.MouseEvent): Pt {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * procW,
      y: ((e.clientY - r.top) / r.height) * procH,
    };
  }

  function onDown(e: React.MouseEvent) {
    if (!addMode) return;
    const p = toProc(e);
    setDraw({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  }
  function onMove(e: React.MouseEvent) {
    if (!addMode || !draw) return;
    const p = toProc(e);
    setDraw((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
  }
  function onUp() {
    if (!addMode || !draw) return;
    const minx = Math.min(draw.x0, draw.x1);
    const maxx = Math.max(draw.x0, draw.x1);
    const miny = Math.min(draw.y0, draw.y1);
    const maxy = Math.max(draw.y0, draw.y1);
    setDraw(null);
    if (maxx - minx > 4 && maxy - miny > 4 && onAddPlot) {
      onAddPlot(rotatedRect(minx, miny, maxx, maxy, tilt));
    }
  }

  const activeId = menu?.id ?? selectedId ?? null;

  return (
    <div
      className="relative w-full select-none overflow-hidden rounded-lg border border-neutral-200 bg-neutral-50"
      style={{ maxWidth: procW, aspectRatio: `${procW} / ${procH}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imgUrl}
        alt="Plot layout map"
        className="pointer-events-none absolute inset-0 h-full w-full"
        draggable={false}
      />
      <svg
        ref={svgRef}
        viewBox={`0 0 ${procW} ${procH}`}
        className="absolute inset-0 h-full w-full"
        style={{ cursor: addMode ? "crosshair" : "default" }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onClick={() => setMenu(null)}
      >
        {plots.map((p) => {
          const c = STATUS[p.status].color;
          const sel = p.id === activeId;
          const interactive = isAdmin || !!onSelect;
          return (
            <polygon
              key={p.id}
              points={p.polygon.map((pt) => `${pt.x},${pt.y}`).join(" ")}
              fill={c}
              fillOpacity={sel ? 0.5 : 0.22}
              stroke={c}
              strokeWidth={sel ? 3 : 1.5}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: addMode ? "crosshair" : interactive ? "pointer" : "default" }}
              onClick={(e) => {
                if (addMode) return;
                e.stopPropagation();
                if (isAdmin) {
                  const cx = p.centroid.x;
                  const cy = p.centroid.y;
                  setMenu({ id: p.id, xPct: (cx / procW) * 100, yPct: (cy / procH) * 100 });
                } else if (onSelect) {
                  onSelect(p.id);
                }
              }}
            />
          );
        })}

        {draw && (
          <polygon
            points={rotatedRect(draw.x0, draw.y0, draw.x1, draw.y1, tilt)
              .map((p) => `${p.x},${p.y}`)
              .join(" ")}
            fill="#2563eb"
            fillOpacity={0.2}
            stroke="#2563eb"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* status / delete popup for the clicked plot (admin) */}
      {isAdmin && menu && (
        <div
          className="absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg"
          style={{ left: `${menu.xPct}%`, top: `${menu.yPct}%` }}
        >
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              title={`Set ${STATUS[s].label}`}
              onClick={() => {
                onSetStatus?.(menu.id, s);
                setMenu(null);
              }}
              className="h-6 w-6 rounded ring-offset-1 hover:ring-2"
              style={{ backgroundColor: STATUS[s].color }}
            />
          ))}
          <span className="mx-0.5 h-6 w-px bg-neutral-200" />
          <button
            title="Delete this box"
            onClick={() => {
              onDeletePlot?.(menu.id);
              setMenu(null);
            }}
            className="flex h-6 items-center gap-1 rounded bg-red-50 px-2 text-xs font-medium text-red-600 hover:bg-red-100"
          >
            🗑 Delete
          </button>
        </div>
      )}
    </div>
  );
}
