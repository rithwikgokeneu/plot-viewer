import OpenSeadragon from "openseadragon";

const SVGNS = "http://www.w3.org/2000/svg";

export interface SvgOverlayHandle {
  node(): SVGGElement;
  destroy(): void;
}

// Attaches an SVG <g> over the OSD canvas whose coordinate system is OSD
// viewport space (x in [0,1], y in [0, imgH/imgW]). The <g> transform is
// re-synced whenever the viewport moves, so children drawn in viewport
// coords track the image at every zoom/pan.
export function attachSvgOverlay(viewer: OpenSeadragon.Viewer): SvgOverlayHandle {
  const svg = document.createElementNS(SVGNS, "svg");
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.width = "100%";
  svg.style.height = "100%";
  svg.style.pointerEvents = "none"; // pan passes through; polygons opt back in
  const g = document.createElementNS(SVGNS, "g");
  svg.appendChild(g);
  viewer.canvas.appendChild(svg);

  function resize() {
    const vp = viewer.viewport;
    const p0 = vp.pixelFromPoint(new OpenSeadragon.Point(0, 0), true);
    const p1 = vp.pixelFromPoint(new OpenSeadragon.Point(1, 0), true);
    const scale = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    const rotation = vp.getRotation(true);
    g.setAttribute("transform", `translate(${p0.x},${p0.y}) scale(${scale}) rotate(${rotation})`);
  }

  const handler = () => resize();
  viewer.addHandler("open", handler);
  viewer.addHandler("animation", handler);
  viewer.addHandler("update-viewport", handler);
  viewer.addHandler("resize", handler);
  viewer.addHandler("rotate", handler);
  resize();

  return {
    node: () => g,
    destroy() {
      for (const e of ["open", "animation", "update-viewport", "resize", "rotate"] as const) {
        viewer.removeHandler(e, handler);
      }
      svg.remove();
    },
  };
}
