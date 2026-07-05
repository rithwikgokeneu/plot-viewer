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

// Shared map renderer: the layout image with a scaled SVG overlay of colored,
// numbered plot polygons. Interactive when onPlotClick is provided.
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
  const fontScale = procW && dispW ? procW / dispW : 1;
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
            <g key={p.id}>
              <polygon
                points={p.polygon.map((pt) => `${pt.x},${pt.y}`).join(" ")}
                fill={c}
                fillOpacity={sel ? 0.6 : 0.38}
                stroke={c}
                strokeWidth={sel ? 3 : 1.5}
                vectorEffect="non-scaling-stroke"
                style={{ cursor: onPlotClick ? "pointer" : "default" }}
                onClick={onPlotClick ? () => onPlotClick(p.id) : undefined}
                onMouseEnter={onPlotHover ? () => onPlotHover(p.id) : undefined}
              />
              <text
                x={p.centroid.x}
                y={p.centroid.y}
                fontSize={11 * fontScale}
                fontWeight={700}
                fill="#111"
                textAnchor="middle"
                dominantBaseline="middle"
                style={{ pointerEvents: "none" }}
              >
                {p.num}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
