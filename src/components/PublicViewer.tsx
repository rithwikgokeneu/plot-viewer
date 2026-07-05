"use client";

import { useEffect, useState } from "react";
import PlotMap from "@/components/PlotMap";
import {
  DISP_MAX_W,
  DISP_MAX_H,
  STATUS,
  STATUS_ORDER,
  countByStatus,
  fit,
  loadProject,
  type Plot,
} from "@/lib/plot";

export default function PublicViewer() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [disp, setDisp] = useState({ w: 0, h: 0 });
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
        const d = fit(p.natW, p.natH, DISP_MAX_W, DISP_MAX_H);
        setDisp({ w: d.w, h: d.h });
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
      <div className="rounded border border-neutral-200 p-8 text-center text-neutral-600">
        No layout published yet. The project admin needs to upload and publish a
        plot map.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex flex-col gap-3">
        {imgUrl && (
          <PlotMap
            imgUrl={imgUrl}
            dispW={disp.w}
            dispH={disp.h}
            procW={proc.w}
            procH={proc.h}
            plots={plots}
            selectedId={selectedId}
            onPlotClick={(id) => setSelectedId(id)}
          />
        )}
      </div>

      <div className="flex w-full max-w-sm flex-col gap-4 text-sm">
        <div className="rounded border border-neutral-200 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-semibold">Availability</h2>
            <span className="text-2xl font-bold">{plots.length}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {STATUS_ORDER.map((s) => (
              <div key={s} className="flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: STATUS[s].color }}
                />
                <span className="text-neutral-600">{STATUS[s].label}</span>
                <span className="ml-auto font-semibold">{counts[s]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-neutral-200 p-3">
          <h3 className="mb-2 font-semibold">Selected plot</h3>
          {selected ? (
            <div className="flex items-center gap-2">
              <span className="text-lg font-bold">#{selected.num}</span>
              <span
                className="rounded px-2 py-1 text-xs font-medium text-white"
                style={{ backgroundColor: STATUS[selected.status].color }}
              >
                {STATUS[selected.status].label}
              </span>
            </div>
          ) : (
            <p className="text-neutral-500">Click a plot on the map.</p>
          )}
        </div>
      </div>
    </div>
  );
}
