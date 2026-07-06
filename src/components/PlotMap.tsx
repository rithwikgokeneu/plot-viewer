"use client";

import { useRef, useState } from "react";
import { STATUS, type Plot } from "@/lib/plot";
import type { Pt } from "@/lib/detect";

interface Props {
  imgUrl: string;
  dispW: number;
  dispH: number;
  procW: number;
  procH: number;
  plots: Plot[];
  selectedId: number | null;
  onPlotClick?: (id: number) => void;
  onPlotHover?: (id: number) => void;
  // When true, drag on the map to draw a new plot box (calls onAddPlot).
  addMode?: boolean;
  onAddPlot?: (polygon: Pt[]) => void;
  // Rotation (radians) applied to a newly drawn box so it matches tilted plots.
  tilt?: number;
}

// Four corners of the drag rectangle, rotated by `ang` around its center.
function rotatedRect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  ang: number
): Pt[] {
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

// Shared map renderer: the layout image with a scaled SVG overlay of colored
// plot polygons. The fill is kept translucent so the map's own printed plot
// numbers stay readable through each box. Interactive when onPlotClick is set;
// in addMode, dragging draws a new box.
export default function PlotMap({
  imgUrl,
  dispW,
  dispH,
  procW,
  procH,
  plots,
  selectedId,
  onPlotClick,
  onPlotHover,
  addMode,
  onAddPlot,
  tilt = 0,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [draw, setDraw] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(
    null
  );

  // pointer position in detection (proc) coordinates
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

  return (
    <div
      className="relative border border-neutral-300 bg-neutral-50"
      style={{ width: dispW, height: dispH }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imgUrl}
        alt="Plot layout map"
        width={dispW}
        height={dispH}
        className="absolute left-0 top-0 select-none"
        draggable={false}
      />
      <svg
        ref={svgRef}
        width={dispW}
        height={dispH}
        viewBox={`0 0 ${procW} ${procH}`}
        className="absolute left-0 top-0"
        style={{ cursor: addMode ? "crosshair" : "default" }}
        onMouseDown={onDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
      >
        {plots.map((p) => {
          const c = STATUS[p.status].color;
          const sel = p.id === selectedId;
          return (
            <polygon
              key={p.id}
              points={p.polygon.map((pt) => `${pt.x},${pt.y}`).join(" ")}
              fill={c}
              fillOpacity={sel ? 0.45 : 0.22}
              stroke={c}
              strokeWidth={sel ? 3 : 1.5}
              vectorEffect="non-scaling-stroke"
              style={{ cursor: addMode ? "crosshair" : onPlotClick ? "pointer" : "default" }}
              onClick={!addMode && onPlotClick ? () => onPlotClick(p.id) : undefined}
              onMouseEnter={
                !addMode && onPlotHover ? () => onPlotHover(p.id) : undefined
              }
            />
          );
        })}

        {/* live preview of the (tilted) box being drawn */}
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
    </div>
  );
}
