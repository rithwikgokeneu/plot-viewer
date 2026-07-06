"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { detectPlots, type Pt } from "@/lib/detect";
import PlotMap from "@/components/PlotMap";
import { saveProjectPatch } from "@/lib/api";
import { normPolygon, denormPolygon, normCentroid } from "@/lib/coords";
import {
  PROC_MAX,
  STATUS,
  STATUS_ORDER,
  countByStatus,
  fit,
  type Plot,
  type Status,
} from "@/lib/plot";

function isHeic(file: File) {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

interface Props {
  projectId: string;
  initialImageUrl: string | null;
  initialNat: { w: number; h: number };
  initialPlots: Plot[]; // normalized 0..1
}

export default function PlotEditor({ projectId, initialImageUrl, initialNat, initialPlots }: Props) {
  const [imgUrl, setImgUrl] = useState<string | null>(initialImageUrl);
  const [nat, setNat] = useState(initialNat);
  // proc = detection resolution used for the legacy PlotMap overlay
  const [proc, setProc] = useState(() => fit(initialNat.w || 1, initialNat.h || 1, PROC_MAX, PROC_MAX));
  // Plots held in PROC coords for PlotMap; normalized on save.
  const [plots, setPlots] = useState<Plot[]>(() =>
    initialPlots.map((p) => ({
      ...p,
      polygon: denormPolygon(p.polygon, proc0(initialNat).w, proc0(initialNat).h),
      centroid: denormPolygon([p.centroid], proc0(initialNat).w, proc0(initialNat).h)[0],
    }))
  );
  const [threshold, setThreshold] = useState<number>(-1);
  const [invert, setInvert] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [tilt, setTilt] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);

  function proc0(n: { w: number; h: number }) {
    return fit(n.w || 1, n.h || 1, PROC_MAX, PROC_MAX);
  }

  useEffect(() => {
    if (!initialImageUrl) return;
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.onload = () => { imgRef.current = image; };
    image.src = initialImageUrl;
  }, [initialImageUrl]);

  const persist = useCallback(
    async (nextPlots: Plot[]) => {
      const normalized = nextPlots.map((p) => ({
        ...p,
        polygon: normPolygon(p.polygon, proc.w, proc.h),
        centroid: normCentroid(p.centroid, proc.w, proc.h),
      }));
      await saveProjectPatch(projectId, { plots: normalized, natW: nat.w, natH: nat.h });
      setSavedAt(Date.now());
    },
    [projectId, proc, nat]
  );

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

  // NOTE: tiling/deep-zoom is wired in Task 12/13. The original image is
  // uploaded straight to Blob below; only its URL round-trips through the DB.
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy("Loading image…");
    try {
      let blob: Blob = file;
      if (isHeic(file)) {
        setBusy("Converting HEIC…");
        const heic2any = (await import("heic2any")).default;
        const out = await heic2any({ blob: file, toType: "image/png" });
        blob = Array.isArray(out) ? out[0] : out;
      }
      const url = URL.createObjectURL(blob);
      const image = new window.Image();
      image.onload = () => {
        const pr = fit(image.width, image.height, PROC_MAX, PROC_MAX);
        imgRef.current = image;
        setImgUrl(url);
        setNat({ w: image.width, h: image.height });
        setProc({ w: pr.w, h: pr.h, scale: pr.scale });
        setAddMode(false);
        setBusy("Detecting plots…");
        setTimeout(async () => {
          const next = runDetect(image, pr.w, pr.h, threshold, invert);
          setPlots(next);
          const normalized = next.map((p) => ({
            ...p,
            polygon: normPolygon(p.polygon, pr.w, pr.h),
            centroid: normCentroid(p.centroid, pr.w, pr.h),
          }));
          await saveProjectPatch(projectId, { plots: normalized, natW: image.width, natH: image.height });

          setBusy("Uploading map…");
          const ext = (blob.type.split("/")[1] || "png").replace("jpeg", "jpg");
          const put = await upload(`projects/${projectId}/original.${ext}`, blob, {
            access: "public",
            handleUploadUrl: "/api/blob/upload",
          });
          await saveProjectPatch(projectId, { imageUrl: put.url });
          setImgUrl(put.url);
          setSavedAt(Date.now());
          setBusy(null);
        }, 0);
      };
      image.onerror = () => setBusy("Could not load that image.");
      image.src = url;
    } catch {
      setBusy("HEIC conversion failed — try a PNG or JPG.");
    }
    e.target.value = "";
  }

  function redetect() {
    if (!imgRef.current) return;
    setBusy("Detecting plots…");
    setTimeout(async () => {
      const next = runDetect(imgRef.current!, proc.w, proc.h, threshold, invert);
      setPlots(next);
      await persist(next);
      setBusy(null);
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
      <label className="mx-auto flex max-w-xl cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-neutral-300 bg-neutral-50 p-12 text-center hover:border-blue-400 hover:bg-blue-50/40">
        <span className="text-lg font-medium text-neutral-700">{busy ?? "Upload a plot layout map"}</span>
        <span className="text-sm text-neutral-500">PNG, JPG, or HEIC. Plots are detected automatically.</span>
        <span className="mt-1 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white">Choose file</span>
        <input type="file" accept="image/*,.heic,.heif" onChange={onFile} className="hidden" />
      </label>
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
            {savedAt && <span className="text-green-700">Saved ✓</span>}
            <label className="cursor-pointer underline hover:text-neutral-800">
              Replace map
              <input type="file" accept="image/*,.heic,.heif" onChange={onFile} className="hidden" />
            </label>
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
            ? "Add mode: drag a box around a plot the detector missed."
            : "Click a plot to set its status or delete it. Changes save automatically."}
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
              {busy ?? "Re-detect"}
            </button>
          </div>
        </details>
      </div>
    </div>
  );
}
