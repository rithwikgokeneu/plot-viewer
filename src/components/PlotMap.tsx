"use client";

import { STATUS, type Plot } from "@/lib/plot";

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
}

// Shared map renderer: the layout image with a scaled SVG overlay of colored
// plot polygons. The fill is kept translucent so the map's own printed plot
// numbers stay readable through each box. Interactive when onPlotClick is set.
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
}: Props) {
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
        width={dispW}
        height={dispH}
        viewBox={`0 0 ${procW} ${procH}`}
        className="absolute left-0 top-0"
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
              style={{ cursor: onPlotClick ? "pointer" : "default" }}
              onClick={onPlotClick ? () => onPlotClick(p.id) : undefined}
              onMouseEnter={onPlotHover ? () => onPlotHover(p.id) : undefined}
            />
          );
        })}
      </svg>
    </div>
  );
}
