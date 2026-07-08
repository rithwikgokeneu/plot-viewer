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
  // Edit mode: select a box, drag its corners to resize or its body to move.
  editMode?: boolean;
  onUpdateBox?: (id: number, box: Pt[]) => void;
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

// Min-area bounding rectangle (4 corners) of a polygon — a clean tilted box
// that fully encloses the detected shape, so the overlay covers all four sides.
function minAreaRect(poly: Pt[]): Pt[] {
  if (poly.length < 3) return poly;
  let best: { minx: number; maxx: number; miny: number; maxy: number; ang: number } | null = null;
  let bestArea = Infinity;
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
      best = { minx, maxx, miny, maxy, ang };
    }
  }
  if (!best) return poly;
  const { minx, maxx, miny, maxy, ang } = best;
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return ([[minx, miny], [maxx, miny], [maxx, maxy], [minx, maxy]] as [number, number][]).map(
    ([x, y]) => ({ x: x * c - y * s, y: x * s + y * c })
  );
}

// Expand corners outward from their center by `factor` (to reach the plot's outer border).
function expand(corners: Pt[], factor: number): Pt[] {
  const cx = corners.reduce((s, p) => s + p.x, 0) / corners.length;
  const cy = corners.reduce((s, p) => s + p.y, 0) / corners.length;
  return corners.map((p) => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }));
}

// The rendered box for a plot: its min-area rectangle, expanded to cover the cell.
function plotBox(poly: Pt[]): Pt[] {
  return expand(minAreaRect(poly), 1.12);
}

// A plot's current box: the user-edited corners if set, else the derived box.
function boxOf(p: Plot): Pt[] {
  return p.box && p.box.length === 4 ? p.box : plotBox(p.polygon);
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
  editMode,
  onUpdateBox,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draw, setDraw] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [menu, setMenu] = useState<{ id: number; xPct: number; yPct: number } | null>(null);
  // Edit mode: which box is selected, and the live drag session.
  const [editId, setEditId] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ id: number; mode: "move" | "corner" | "edge"; corner: number; start: Pt; orig: Pt[] } | null>(null);
  const [draftBox, setDraftBox] = useState<Pt[] | null>(null);
  const isAdmin = !!onSetStatus;
  // Handle size in proc units, so grab targets stay usable at any display scale.
  const handleR = Math.max(procW, procH) * 0.011;

  function toProc(e: React.MouseEvent): Pt {
    const r = svgRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * procW,
      y: ((e.clientY - r.top) / r.height) * procH,
    };
  }

  // Begin dragging a box (move), a corner (reshape), or a side (stretch).
  function startDrag(e: React.MouseEvent, p: Plot, mode: "move" | "corner" | "edge", corner: number) {
    e.stopPropagation();
    setMenu(null);
    setEditId(p.id);
    const orig = boxOf(p);
    setDrag({ id: p.id, mode, corner, start: toProc(e), orig });
    setDraftBox(orig);
  }

  function onDown(e: React.MouseEvent) {
    if (addMode) {
      const p = toProc(e);
      setDraw({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
      return;
    }
    if (editMode) setEditId(null); // click empty area to deselect
  }

  function onMove(e: React.MouseEvent) {
    if (addMode && draw) {
      const p = toProc(e);
      setDraw((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
      return;
    }
    if (drag) {
      const cur = toProc(e);
      const dx = cur.x - drag.start.x;
      const dy = cur.y - drag.start.y;
      if (drag.mode === "move") {
        setDraftBox(drag.orig.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })));
      } else if (drag.mode === "edge") {
        // Stretch a whole side: move both corners of edge i (i → i+1).
        const a = drag.corner;
        const b = (drag.corner + 1) % 4;
        setDraftBox(drag.orig.map((pt, i) => (i === a || i === b ? { x: pt.x + dx, y: pt.y + dy } : pt)));
      } else {
        setDraftBox(drag.orig.map((pt, i) => (i === drag.corner ? { x: pt.x + dx, y: pt.y + dy } : pt)));
      }
    }
  }

  function onUp() {
    if (addMode && draw) {
      const minx = Math.min(draw.x0, draw.x1);
      const maxx = Math.max(draw.x0, draw.x1);
      const miny = Math.min(draw.y0, draw.y1);
      const maxy = Math.max(draw.y0, draw.y1);
      setDraw(null);
      if (maxx - minx > 4 && maxy - miny > 4 && onAddPlot) {
        onAddPlot(rotatedRect(minx, miny, maxx, maxy, tilt));
      }
      return;
    }
    if (drag && draftBox) {
      // Only persist when the box actually moved (a plain click just selects).
      const changed = draftBox.some((pt, i) => pt.x !== drag.orig[i].x || pt.y !== drag.orig[i].y);
      if (changed) onUpdateBox?.(drag.id, draftBox);
    }
    setDrag(null);
    setDraftBox(null);
  }

  const activeId = menu?.id ?? selectedId ?? null;
  const editingPlot = editMode && editId != null ? plots.find((p) => p.id === editId) ?? null : null;
  const editingBox = editingPlot ? (drag?.id === editingPlot.id && draftBox ? draftBox : boxOf(editingPlot)) : null;

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
          const isNone = p.status === "none";
          const isEditing = editMode && editId === p.id;
          const sel = p.id === activeId || isEditing;
          const interactive = isAdmin || !!onSelect;
          const box = isEditing && draftBox ? draftBox : boxOf(p);
          const cursor = addMode
            ? "crosshair"
            : editMode
            ? isEditing
              ? "move"
              : "pointer"
            : interactive
            ? "pointer"
            : "default";
          return (
            <polygon
              key={p.id}
              points={box.map((pt) => `${pt.x},${pt.y}`).join(" ")}
              // "none" = cleared: visible neutral grey box (colour removed, box kept), dashed edge.
              fill={c}
              fillOpacity={sel ? 0.62 : isNone ? 0.4 : 0.34}
              stroke={c}
              strokeWidth={sel ? 2.5 : 1.5}
              strokeDasharray={isNone ? "6 4" : undefined}
              strokeLinejoin="round"
              style={{ cursor, pointerEvents: "all" }}
              onMouseDown={editMode ? (e) => startDrag(e, p, "move", -1) : undefined}
              onClick={(e) => {
                if (addMode) return;
                e.stopPropagation();
                if (editMode) {
                  setEditId(p.id);
                } else if (isAdmin) {
                  setMenu({ id: p.id, xPct: (p.centroid.x / procW) * 100, yPct: (p.centroid.y / procH) * 100 });
                } else if (onSelect) {
                  onSelect(p.id);
                }
              }}
            />
          );
        })}

        {/* Handles for the box being edited: blue squares stretch a side, white circles reshape a corner. */}
        {editMode && editingPlot && editingBox && (
          <g>
            {editingBox.map((pt, i) => {
              const nx = editingBox[(i + 1) % 4];
              const mx = (pt.x + nx.x) / 2;
              const my = (pt.y + nx.y) / 2;
              const s = handleR * 1.8;
              return (
                <rect
                  key={`edge-${i}`}
                  x={mx - s / 2}
                  y={my - s / 2}
                  width={s}
                  height={s}
                  rx={s * 0.25}
                  fill="#2563eb"
                  stroke="#ffffff"
                  strokeWidth={handleR * 0.35}
                  style={{ cursor: "grab", pointerEvents: "all" }}
                  onMouseDown={(e) => startDrag(e, editingPlot, "edge", i)}
                />
              );
            })}
            {editingBox.map((pt, i) => (
              <circle
                key={`corner-${i}`}
                cx={pt.x}
                cy={pt.y}
                r={handleR}
                fill="#ffffff"
                stroke="#2563eb"
                strokeWidth={handleR * 0.4}
                style={{ cursor: "grab", pointerEvents: "all" }}
                onMouseDown={(e) => startDrag(e, editingPlot, "corner", i)}
              />
            ))}
          </g>
        )}

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

      {/* status / delete popup for the clicked plot (admin, non-edit mode) */}
      {isAdmin && !editMode && menu && (
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
          <button
            title="Remove colour (keep the box)"
            onClick={() => {
              onSetStatus?.(menu.id, "none");
              setMenu(null);
            }}
            className="flex h-6 items-center rounded bg-neutral-100 px-2 text-xs font-medium text-neutral-600 hover:bg-neutral-200"
          >
            Clear
          </button>
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
