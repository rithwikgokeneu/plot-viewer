"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { detectPlots, toGray, otsuThreshold, type Pt } from "@/lib/detect";
import PlotMap from "@/components/PlotMap";
import {
  DISP_MAX_W,
  DISP_MAX_H,
  PROC_MAX,
  STATUS,
  STATUS_ORDER,
  countByStatus,
  fit,
  loadProject,
  saveProject,
  clearProject,
  type Plot,
  type Project,
  type Status,
} from "@/lib/plot";

function isHeic(file: File) {
  return /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

// Orientation (radians) of a convex polygon's minimum-area bounding rectangle.
// By the rotating-calipers theorem that rectangle shares an edge with the
// polygon, so we test each edge's direction and keep the tightest fit. For a
// (tilted) rectangular plot this recovers its true tilt.
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
    let minx = Infinity;
    let maxx = -Infinity;
    let miny = Infinity;
    let maxy = -Infinity;
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

// Estimate the plots' tilt (degrees, in (-45,45]) as the median orientation of
// each detected plot's minimum-area rectangle — used as the default rotation
// for newly drawn boxes so they match the layout automatically.
function estimateTilt(plots: Plot[]): number {
  const angles: number[] = [];
  for (const p of plots) {
    if (p.polygon.length < 3) continue;
    const deg = (minAreaRectAngle(p.polygon) * 180) / Math.PI;
    // fold into (-45, 45] since a rectangle repeats every 90deg
    angles.push(((((deg + 45) % 90) + 90) % 90) - 45);
  }
  if (angles.length === 0) return 0;
  angles.sort((a, b) => a - b);
  return Math.round(angles[angles.length >> 1]);
}

export default function PlotEditor() {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [disp, setDisp] = useState({ w: 0, h: 0 });
  const [proc, setProc] = useState({ w: 0, h: 0 });
  const [plots, setPlots] = useState<Plot[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [threshold, setThreshold] = useState<number>(-1); // -1 = auto (Otsu)
  const [invert, setInvert] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [ocr, setOcr] = useState<{ done: number; total: number } | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [removeMode, setRemoveMode] = useState(false);
  const [tilt, setTilt] = useState(0); // degrees, rotation for newly drawn boxes

  const imgRef = useRef<HTMLImageElement | null>(null);

  // Load any previously published project on mount.
  useEffect(() => {
    let url: string | null = null;
    (async () => {
      const p = await loadProject();
      if (!p) return;
      url = URL.createObjectURL(p.image);
      const image = new window.Image();
      image.onload = () => {
        imgRef.current = image;
      };
      image.src = url;
      setImageBlob(p.image);
      setImgUrl(url);
      setNat({ w: p.natW, h: p.natH });
      setProc({ w: p.procW, h: p.procH });
      const d = fit(p.natW, p.natH, DISP_MAX_W, DISP_MAX_H);
      setDisp({ w: d.w, h: d.h });
      setPlots(p.plots);
      setTilt(estimateTilt(p.plots));
      setSavedAt(p.updatedAt);
    })();
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, []);

  const persist = useCallback(
    async (nextPlots: Plot[]) => {
      if (!imageBlob) return;
      const project: Project = {
        image: imageBlob,
        natW: nat.w,
        natH: nat.h,
        procW: proc.w,
        procH: proc.h,
        plots: nextPlots,
        updatedAt: Date.now(),
      };
      await saveProject(project);
      setSavedAt(project.updatedAt);
    },
    [imageBlob, nat, proc]
  );

  const runDetect = useCallback(
    (image: HTMLImageElement, pw: number, ph: number, t: number, inv: boolean) => {
      const canvas = document.createElement("canvas");
      canvas.width = pw;
      canvas.height = ph;
      const ctx = canvas.getContext("2d");
      if (!ctx) return [] as Plot[];
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
      image.onload = async () => {
        const d = fit(image.width, image.height, DISP_MAX_W, DISP_MAX_H);
        const pr = fit(image.width, image.height, PROC_MAX, PROC_MAX);
        imgRef.current = image;
        setImageBlob(blob);
        setImgUrl(url);
        setNat({ w: image.width, h: image.height });
        setDisp({ w: d.w, h: d.h });
        setProc({ w: pr.w, h: pr.h });
        setBusy("Detecting plots…");
        setTimeout(async () => {
          const next = runDetect(image, pr.w, pr.h, threshold, invert);
          setPlots(next);
          setTilt(estimateTilt(next));
          setSelectedId(null);
          // persist immediately with fresh sizes (state may not be applied yet)
          await saveProject({
            image: blob,
            natW: image.width,
            natH: image.height,
            procW: pr.w,
            procH: pr.h,
            plots: next,
            updatedAt: Date.now(),
          });
          setSavedAt(Date.now());
          setBusy(null);
        }, 0);
      };
      image.onerror = () => setBusy("Could not load that image.");
      image.src = url;
    } catch {
      setBusy("HEIC conversion failed — try a PNG or JPG.");
    }
  }

  function redetect() {
    if (!imgRef.current) return;
    setBusy("Detecting plots…");
    setTimeout(async () => {
      const next = runDetect(imgRef.current!, proc.w, proc.h, threshold, invert);
      setPlots(next);
      setTilt(estimateTilt(next));
      setSelectedId(null);
      await persist(next);
      setBusy(null);
    }, 0);
  }

  // Add a manually-drawn box as a new plot (for plots the detector missed).
  function addPlot(polygon: Pt[]) {
    let cx = 0;
    let cy = 0;
    for (const pt of polygon) {
      cx += pt.x;
      cy += pt.y;
    }
    setPlots((prev) => {
      const nextId = prev.reduce((m, p) => Math.max(m, p.id), 0) + 1;
      const next = [
        ...prev,
        {
          id: nextId,
          num: "",
          polygon,
          centroid: { x: cx / polygon.length, y: cy / polygon.length },
          status: "available" as Status,
        },
      ];
      void persist(next);
      return next;
    });
  }

  // Read the printed number inside each plot via OCR. Crops the central ~70%
  // of each plot (excludes edge dimension text) from the native-res image,
  // upscales, and recognizes digits only.
  async function readNumbers() {
    if (!imgRef.current || plots.length === 0) return;
    const image = imgRef.current;
    const sx = image.width / proc.w;
    const sy = image.height / proc.h;
    setOcr({ done: 0, total: plots.length });
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker("eng");
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789",
      tessedit_pageseg_mode: PSM.SINGLE_WORD,
    });
    const tmp = document.createElement("canvas");
    const tctx = tmp.getContext("2d")!;
    const current = plots;
    const updated: Plot[] = [];
    for (let i = 0; i < current.length; i++) {
      const p = current[i];
      const xs = p.polygon.map((pt) => pt.x);
      const ys = p.polygon.map((pt) => pt.y);
      const minx = Math.min(...xs);
      const maxx = Math.max(...xs);
      const miny = Math.min(...ys);
      const maxy = Math.max(...ys);
      // central 70% of the plot excludes edge dimension text
      const cw = (maxx - minx) * 0.7;
      const ch = (maxy - miny) * 0.7;
      const cx = (minx + maxx) / 2;
      const cy = (miny + maxy) / 2;
      const srcX = (cx - cw / 2) * sx;
      const srcY = (cy - ch / 2) * sy;
      const srcW = Math.max(1, cw * sx);
      const srcH = Math.max(1, ch * sy);
      const up = Math.max(1, 130 / srcH); // upscale digit height ~130px
      const iW = Math.max(8, Math.round(srcW * up));
      const iH = Math.max(8, Math.round(srcH * up));
      const pad = Math.round(iH * 0.35); // white margin helps Tesseract
      const dW = iW + pad * 2;
      const dH = iH + pad * 2;
      tmp.width = dW;
      tmp.height = dH;
      tctx.fillStyle = "#fff";
      tctx.fillRect(0, 0, dW, dH);
      tctx.imageSmoothingEnabled = true;
      tctx.imageSmoothingQuality = "high";
      tctx.drawImage(image, srcX, srcY, srcW, srcH, pad, pad, iW, iH);
      // binarize: grayscale + Otsu so the digit is crisp black on white
      const idata = tctx.getImageData(0, 0, dW, dH);
      const gray = toGray(idata.data, dW, dH);
      const T = otsuThreshold(gray);
      for (let k = 0; k < dW * dH; k++) {
        const v = gray[k] > T ? 255 : 0;
        idata.data[k * 4] = idata.data[k * 4 + 1] = idata.data[k * 4 + 2] = v;
      }
      tctx.putImageData(idata, 0, 0);
      let num = p.num;
      try {
        const { data } = await worker.recognize(tmp);
        const digits = (data.text || "").replace(/\D/g, "");
        if (digits) num = digits;
      } catch {
        /* keep existing number on failure */
      }
      updated.push({ ...p, num });
      if (i % 5 === 0 || i === current.length - 1)
        setOcr({ done: i + 1, total: current.length });
    }
    await worker.terminate();
    setPlots(updated);
    await persist(updated);
    setOcr(null);
  }

  function setNum(id: number, num: string) {
    setPlots((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, num } : p));
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

  function toggleSold(id: number) {
    setPlots((prev) => {
      const next = prev.map((p) =>
        p.id === id
          ? { ...p, status: (p.status === "sold" ? "available" : "sold") as Status }
          : p
      );
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

  async function resetAll() {
    await clearProject();
    if (imgUrl) URL.revokeObjectURL(imgUrl);
    setImgUrl(null);
    setImageBlob(null);
    setPlots([]);
    setSelectedId(null);
    setSavedAt(null);
  }

  const counts = countByStatus(plots);

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white">
            Upload map / picture
            <input
              type="file"
              accept="image/*,.heic,.heif"
              onChange={onFile}
              className="hidden"
            />
          </label>
          <button
            onClick={() => {
              setAddMode((v) => !v);
              setRemoveMode(false);
            }}
            disabled={!imgUrl}
            className={`rounded px-3 py-2 text-sm font-medium disabled:opacity-40 ${
              addMode
                ? "bg-blue-600 text-white"
                : "border border-blue-600 text-blue-700"
            }`}
          >
            {addMode ? "Done adding" : "+ Add plot box"}
          </button>
          <button
            onClick={() => {
              setRemoveMode((v) => !v);
              setAddMode(false);
            }}
            disabled={!imgUrl}
            className={`rounded px-3 py-2 text-sm font-medium disabled:opacity-40 ${
              removeMode
                ? "bg-red-600 text-white"
                : "border border-red-600 text-red-700"
            }`}
          >
            {removeMode ? "Done removing" : "✕ Remove box"}
          </button>
          {addMode && (
            <label className="flex items-center gap-2 text-xs text-neutral-600">
              Tilt
              <input
                type="range"
                min={-45}
                max={45}
                value={tilt}
                onChange={(e) => setTilt(Number(e.target.value))}
              />
              <span className="w-8 tabular-nums">{tilt}°</span>
            </label>
          )}
          {savedAt && (
            <span className="text-xs text-green-700">
              Published ✓ {new Date(savedAt).toLocaleTimeString()}
            </span>
          )}
        </div>

        {imgUrl ? (
          <PlotMap
            imgUrl={imgUrl}
            dispW={disp.w}
            dispH={disp.h}
            procW={proc.w}
            procH={proc.h}
            plots={plots}
            selectedId={selectedId}
            addMode={addMode}
            onAddPlot={addPlot}
            tilt={(tilt * Math.PI) / 180}
            onPlotClick={(id) => {
              if (removeMode) {
                removePlot(id);
              } else {
                setSelectedId(id);
                toggleSold(id);
              }
            }}
            onPlotHover={(id) => setSelectedId(id)}
          />
        ) : (
          <div
            className="flex items-center justify-center border border-neutral-300 bg-neutral-50 text-sm text-neutral-500"
            style={{ width: DISP_MAX_W, height: 480 }}
          >
            Upload a plot layout map to auto-detect plots
          </div>
        )}

        {imgUrl && (
          <p className="max-w-[900px] text-xs text-neutral-500">
            {addMode
              ? "Add mode: drag a box around a plot the detector missed. Click “Done adding” when finished."
              : removeMode
                ? "Remove mode: click any box on the map to delete it. Click “Done removing” when finished."
                : "Click a plot to toggle Available ↔ Sold. Use the list dropdown for Reserved / Booked. “✕ Remove box” then click boxes to delete; “+ Add plot box” to draw a missing one. Changes publish automatically."}
          </p>
        )}
      </div>

      {/* Admin controls */}
      <div className="flex w-full max-w-sm flex-col gap-4 text-sm">
        <div className="rounded border border-neutral-200 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-semibold">Plots</h2>
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

        <div className="flex flex-col gap-2 rounded border border-neutral-200 p-3">
          <h3 className="font-semibold">Detection</h3>
          <label className="flex items-center justify-between gap-2">
            <span className="text-neutral-600">
              Sensitivity {threshold < 0 ? "(auto)" : threshold}
            </span>
            <input
              type="range"
              min={-1}
              max={255}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={invert}
              onChange={(e) => setInvert(e.target.checked)}
            />
            <span className="text-neutral-600">
              Invert (plots darker than background)
            </span>
          </label>
          <div className="flex gap-2">
            <button
              onClick={redetect}
              disabled={!imgUrl || !!busy}
              className="flex-1 rounded bg-neutral-800 px-3 py-2 text-white disabled:opacity-40"
            >
              {busy ?? "Re-detect"}
            </button>
            <button
              onClick={resetAll}
              disabled={!imgUrl}
              className="rounded border border-neutral-300 px-3 py-2 text-neutral-700 disabled:opacity-40"
            >
              Reset
            </button>
          </div>
          <button
            onClick={readNumbers}
            disabled={!imgUrl || !!busy || !!ocr || plots.length === 0}
            className="rounded bg-indigo-600 px-3 py-2 text-white disabled:opacity-40"
          >
            {ocr
              ? `Reading numbers… ${ocr.done}/${ocr.total}`
              : "Read plot numbers (OCR)"}
          </button>
          <p className="text-xs text-neutral-500">
            OCR reads the printed number in each plot. It is a best guess — fix
            any wrong ones in the list below.
          </p>
        </div>

        <div className="rounded border border-neutral-200">
          <div className="border-b border-neutral-200 px-3 py-2 font-semibold">
            Inventory
          </div>
          {plots.length === 0 ? (
            <p className="px-3 py-4 text-neutral-500">
              {imgUrl
                ? "No plots detected. Adjust sensitivity or toggle Invert, then Re-detect."
                : "Upload a map to begin."}
            </p>
          ) : (
            <ul className="max-h-[32rem] divide-y divide-neutral-100 overflow-auto">
              {plots.map((p) => (
                <li
                  key={p.id}
                  onMouseEnter={() => setSelectedId(p.id)}
                  className={`flex items-center gap-2 px-3 py-2 ${
                    p.id === selectedId ? "bg-neutral-50" : ""
                  }`}
                >
                  <input
                    value={p.num}
                    onChange={(e) => setNum(p.id, e.target.value)}
                    title="Plot number (editable)"
                    className="w-12 rounded border border-neutral-300 px-1 py-1 text-center font-semibold"
                  />
                  <select
                    value={p.status}
                    onChange={(e) => setStatus(p.id, e.target.value as Status)}
                    className="flex-1 rounded border border-neutral-300 px-2 py-1"
                    style={{ color: STATUS[p.status].color }}
                  >
                    {STATUS_ORDER.map((s) => (
                      <option key={s} value={s}>
                        {STATUS[s].label}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => removePlot(p.id)}
                    title="Remove false detection"
                    className="rounded px-2 py-1 text-neutral-400 hover:bg-red-50 hover:text-red-600"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
