"use client";

import { useEffect, useRef } from "react";
import OpenSeadragon from "openseadragon";
import { attachSvgOverlay, type SvgOverlayHandle } from "./osdSvgOverlay";
import { STATUS, STATUS_ORDER, type Plot, type Status } from "@/lib/plot";
import type { Pt } from "@/lib/detect";
import { toViewport, fromImagePixels } from "@/lib/coords";

const SVGNS = "http://www.w3.org/2000/svg";

interface DeepZoomMapProps {
  dziUrl: string;
  natW: number;
  natH: number;
  plots: Plot[]; // normalized 0..1
  // admin:
  onSetStatus?: (id: number, status: Status) => void;
  onDeletePlot?: (id: number) => void;
  addMode?: boolean;
  onAddPlot?: (polygonNormalized: Pt[]) => void;
  // public:
  selectedId?: number | null;
  onSelect?: (id: number) => void;
}

export default function DeepZoomMap(props: DeepZoomMapProps) {
  const { dziUrl, natW, natH } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<OpenSeadragon.Viewer | null>(null);
  const overlayRef = useRef<SvgOverlayHandle | null>(null);
  const overlayNodeRef = useRef<SVGGElement | null>(null);
  // Admin status/delete popup: a plain DOM element positioned over the plot
  // centroid (OVERRIDE 2 — no SVG foreignObject).
  const popupRef = useRef<HTMLDivElement | null>(null);
  const popupPlotRef = useRef<Plot | null>(null);
  // keep latest props for imperative OSD handlers
  const propsRef = useRef(props);
  propsRef.current = props;

  // Init viewer once per dziUrl / natural size.
  useEffect(() => {
    if (!hostRef.current || !dziUrl) return;
    const viewer = OpenSeadragon({
      element: hostRef.current,
      tileSources: dziUrl,
      showNavigationControl: true,
      navigatorPosition: "BOTTOM_RIGHT",
      gestureSettingsTouch: { pinchToZoom: true, flickEnabled: true },
      maxZoomPixelRatio: 4,
      visibilityRatio: 1,
      constrainDuringPan: true,
    });
    viewerRef.current = viewer;

    // Vendored SVG overlay (OVERRIDE 1 — the npm plugin does not exist).
    const overlay = attachSvgOverlay(viewer);
    overlayRef.current = overlay;
    overlayNodeRef.current = overlay.node();

    viewer.addHandler("open", () => {
      drawPlots();
    });

    // Keep the admin popup pinned to its plot as the viewport moves.
    const reposition = () => positionPopup();
    viewer.addHandler("animation", reposition);
    viewer.addHandler("update-viewport", reposition);

    // Admin add-mode: click empty map to place a small box at the pointer.
    // Also dismiss the popup on empty-area clicks.
    viewer.addHandler("canvas-click", (e: OpenSeadragon.CanvasClickEvent) => {
      const cur = propsRef.current;
      const tag = (e.originalTarget as Element | null)?.tagName?.toLowerCase();
      const onPlot = tag === "polygon"; // plot clicks are handled by the polygon listener
      if (cur.addMode && cur.onAddPlot) {
        if (onPlot) return; // don't stack a box on an existing plot
        e.preventDefaultAction = true;
        const vpt = viewer.viewport.pointFromPixel(e.position, true);
        const img = viewer.viewport.viewportToImageCoordinates(vpt);
        // default box ~4% of width
        const half = natW * 0.02;
        const corners: Pt[] = [
          { x: img.x - half, y: img.y - half },
          { x: img.x + half, y: img.y - half },
          { x: img.x + half, y: img.y + half },
          { x: img.x - half, y: img.y + half },
        ];
        cur.onAddPlot(corners.map((p) => fromImagePixels(p, natW, natH)));
        return;
      }
      if (!onPlot) closePopup();
    });

    return () => {
      closePopup();
      overlay.destroy();
      viewer.destroy();
      viewerRef.current = null;
      overlayRef.current = null;
      overlayNodeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dziUrl, natW, natH]);

  // Redraw overlay whenever plots / selection / add-mode change.
  useEffect(() => {
    drawPlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.plots, props.selectedId, props.addMode]);

  function drawPlots() {
    const node = overlayNodeRef.current;
    if (!node) return;
    while (node.firstChild) node.removeChild(node.firstChild);
    const cur = propsRef.current;
    const activeId = cur.selectedId ?? popupPlotRef.current?.id ?? null;

    for (const plot of cur.plots) {
      const poly = document.createElementNS(SVGNS, "polygon");
      const pts = plot.polygon
        .map((p) => toViewport(p, natW, natH))
        .map((p) => `${p.x},${p.y}`)
        .join(" ");
      const color = STATUS[plot.status].color;
      const selected = plot.id === activeId;
      poly.setAttribute("points", pts);
      poly.setAttribute("fill", color);
      poly.setAttribute("fill-opacity", selected ? "0.5" : "0.22");
      poly.setAttribute("stroke", color);
      // With non-scaling-stroke the width is in the overlay <svg>'s px space
      // (constant on screen at every zoom), matching PlotMap. A viewport-unit
      // value like 0.002 would render sub-pixel and be invisible.
      poly.setAttribute("stroke-width", selected ? "3" : "1.5");
      poly.setAttribute("vector-effect", "non-scaling-stroke");
      poly.style.cursor = "pointer";
      // Parent <svg> is pointer-events:none so empty areas pan; opt this
      // polygon back in so plots stay clickable (OVERRIDE 1).
      poly.style.pointerEvents = "auto";
      poly.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const c = propsRef.current;
        if (c.addMode) return;
        if (c.onSetStatus) {
          c.onSelect?.(plot.id);
          openAdminPopup(plot);
        } else {
          c.onSelect?.(plot.id);
        }
      });
      node.appendChild(poly);
    }
  }

  // Position the admin popup over the plot centroid, in pixel coords relative
  // to the viewer element. Re-run on every viewport change so it tracks.
  function positionPopup() {
    const viewer = viewerRef.current;
    const el = popupRef.current;
    const plot = popupPlotRef.current;
    if (!viewer || !el || !plot) return;
    const cxImg = plot.centroid.x * natW;
    const cyImg = plot.centroid.y * natH;
    const vp = viewer.viewport.imageToViewportCoordinates(new OpenSeadragon.Point(cxImg, cyImg));
    const px = viewer.viewport.pixelFromPoint(vp, true);
    el.style.left = `${px.x}px`;
    el.style.top = `${px.y}px`;
  }

  function closePopup() {
    if (popupRef.current) {
      popupRef.current.remove();
      popupRef.current = null;
    }
    popupPlotRef.current = null;
  }

  // Admin popup: status swatches + delete, positioned via viewport pixel
  // coordinates (OVERRIDE 2).
  function openAdminPopup(plot: Plot) {
    const viewer = viewerRef.current;
    const cur = propsRef.current;
    if (!viewer || !cur.onSetStatus) return;
    closePopup();

    const el = document.createElement("div");
    el.className =
      "absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-lg border border-neutral-200 bg-white p-1 shadow-lg";
    el.style.position = "absolute";
    el.style.pointerEvents = "auto";
    el.addEventListener("mousedown", (ev) => ev.stopPropagation());

    STATUS_ORDER.forEach((s) => {
      const b = document.createElement("button");
      b.className = "h-6 w-6 rounded ring-offset-1 hover:ring-2";
      b.style.backgroundColor = STATUS[s].color;
      b.title = `Set ${STATUS[s].label}`;
      b.onclick = (ev) => {
        ev.stopPropagation();
        propsRef.current.onSetStatus?.(plot.id, s);
        closePopup();
      };
      el.appendChild(b);
    });

    const sep = document.createElement("span");
    sep.className = "mx-0.5 h-6 w-px bg-neutral-200";
    el.appendChild(sep);

    const del = document.createElement("button");
    del.className =
      "flex h-6 items-center rounded bg-red-50 px-2 text-xs font-medium text-red-600 hover:bg-red-100";
    del.textContent = "Delete";
    del.title = "Delete this box";
    del.onclick = (ev) => {
      ev.stopPropagation();
      propsRef.current.onDeletePlot?.(plot.id);
      closePopup();
    };
    el.appendChild(del);

    viewer.element.appendChild(el);
    popupRef.current = el;
    popupPlotRef.current = plot;
    positionPopup();
  }

  return (
    <div
      ref={hostRef}
      className="relative h-[70vh] w-full rounded-lg border border-neutral-200 bg-neutral-50 lg:h-[80vh]"
    />
  );
}
