// Dependency-free plot auto-detection for clean line-art layout maps.
// Pipeline: grayscale -> threshold (Otsu or manual) -> connected-components
// flood fill of "open" (plot-interior) pixels -> filter by border/area ->
// convex-hull polygon per region. Works when each plot is enclosed by
// boundary lines/roads. Not intended for photos or satellite imagery.

export type Pt = { x: number; y: number };

export interface DetectOptions {
  /** 0-255 grayscale cutoff; if omitted, computed with Otsu's method. */
  threshold?: number;
  /** Min region area as a fraction of total pixels (drops noise/text). */
  minAreaFrac?: number;
  /** Max region area as a fraction of total pixels (drops background blob). */
  maxAreaFrac?: number;
  /** Set true when plots are dark on a light background. */
  invert?: boolean;
}

export interface DetectedPlot {
  polygon: Pt[];
  areaPx: number;
  centroid: Pt;
  bbox: { x: number; y: number; w: number; h: number };
}

type RGBAImage = {
  data: Uint8ClampedArray | Uint8Array | number[];
  width: number;
  height: number;
};

/** RGBA image data -> single-channel grayscale (Rec. 601 luma). */
export function toGray(
  data: Uint8ClampedArray | Uint8Array | number[],
  width: number,
  height: number
): Uint8Array {
  const g = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const gg = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    g[i] = (r * 0.299 + gg * 0.587 + b * 0.114) | 0;
  }
  return g;
}

/** Otsu's method: the grayscale threshold maximizing between-class variance. */
export function otsuThreshold(gray: Uint8Array): number {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  return threshold;
}

interface Region {
  label: number;
  area: number;
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
  cx: number;
  cy: number;
  border: boolean;
}

/**
 * 4-connectivity connected-components labeling over an "open" mask
 * (1 = plot interior, 0 = wall). Returns labels and per-region stats,
 * flagging regions that touch the image border.
 */
export function labelRegions(open: Uint8Array, w: number, h: number) {
  const labels = new Int32Array(w * h).fill(-1);
  const regions: Region[] = [];
  const stack: number[] = [];
  let next = 0;

  for (let s = 0; s < w * h; s++) {
    if (open[s] === 0 || labels[s] !== -1) continue;
    const label = next++;
    let area = 0;
    let minx = Infinity;
    let miny = Infinity;
    let maxx = -1;
    let maxy = -1;
    let sumx = 0;
    let sumy = 0;
    let border = false;

    stack.push(s);
    labels[s] = label;
    while (stack.length) {
      const p = stack.pop() as number;
      const x = p % w;
      const y = (p / w) | 0;
      area++;
      sumx += x;
      sumy += y;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) border = true;

      if (x > 0) {
        const q = p - 1;
        if (open[q] && labels[q] === -1) {
          labels[q] = label;
          stack.push(q);
        }
      }
      if (x < w - 1) {
        const q = p + 1;
        if (open[q] && labels[q] === -1) {
          labels[q] = label;
          stack.push(q);
        }
      }
      if (y > 0) {
        const q = p - w;
        if (open[q] && labels[q] === -1) {
          labels[q] = label;
          stack.push(q);
        }
      }
      if (y < h - 1) {
        const q = p + w;
        if (open[q] && labels[q] === -1) {
          labels[q] = label;
          stack.push(q);
        }
      }
    }
    regions.push({
      label,
      area,
      minx,
      miny,
      maxx,
      maxy,
      cx: sumx / area,
      cy: sumy / area,
      border,
    });
  }
  return { labels, regions };
}

/** Andrew's monotone-chain convex hull. Collinear points are dropped. */
export function convexHull(points: Pt[]): Pt[] {
  const pts = points
    .slice()
    .sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Pt[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Convex hull of a labeled region's boundary pixels, scanned within its bbox. */
function regionHull(
  labels: Int32Array,
  w: number,
  h: number,
  r: Region
): Pt[] {
  const pts: Pt[] = [];
  for (let y = r.miny; y <= r.maxy; y++) {
    for (let x = r.minx; x <= r.maxx; x++) {
      if (labels[y * w + x] !== r.label) continue;
      const up = y > 0 && labels[(y - 1) * w + x] === r.label;
      const dn = y < h - 1 && labels[(y + 1) * w + x] === r.label;
      const lf = x > 0 && labels[y * w + x - 1] === r.label;
      const rt = x < w - 1 && labels[y * w + x + 1] === r.label;
      if (!(up && dn && lf && rt)) pts.push({ x, y });
    }
  }
  return convexHull(pts);
}

/**
 * Detect plot polygons from an RGBA image.
 * Regions touching the image border are treated as background/road and dropped,
 * so the map should enclose each plot with boundary lines.
 */
export function detectPlots(
  img: RGBAImage,
  opts: DetectOptions = {}
): DetectedPlot[] {
  const w = img.width;
  const h = img.height;
  const gray = toGray(img.data, w, h);
  const T = opts.threshold ?? otsuThreshold(gray);
  const invert = opts.invert ?? false;

  const open = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const light = gray[i] > T;
    open[i] = (invert ? !light : light) ? 1 : 0;
  }

  const { labels, regions } = labelRegions(open, w, h);
  const total = w * h;
  const minA = (opts.minAreaFrac ?? 0.0008) * total;
  const maxA = (opts.maxAreaFrac ?? 0.25) * total;

  // first pass: enclosed regions within the absolute area band
  const cand = regions.filter(
    (r) => !r.border && r.area >= minA && r.area <= maxA
  );
  // Plots are uniformly sized. Keep regions near the MEDIAN plot area so that
  // larger non-plot regions (open spaces, the legend/info box, decorations)
  // and leftover speckles are dropped without needing manual cleanup.
  const sortedA = cand.map((r) => r.area).sort((a, b) => a - b);
  const med = sortedA.length ? sortedA[sortedA.length >> 1] : 0;
  const loA = 0.4 * med;
  const hiA = 3 * med;

  const plots: DetectedPlot[] = [];
  for (const r of cand) {
    if (med > 0 && (r.area < loA || r.area > hiA)) continue;
    const bw = r.maxx - r.minx + 1;
    const bh = r.maxy - r.miny + 1;
    const ar = bw / bh;
    if (ar < 0.3 || ar > 3.5) continue; // reject slivers / road fragments
    const polygon = regionHull(labels, w, h, r);
    if (polygon.length < 3) continue;
    plots.push({
      polygon,
      areaPx: r.area,
      centroid: { x: r.cx, y: r.cy },
      bbox: { x: r.minx, y: r.miny, w: bw, h: bh },
    });
  }

  // number top-to-bottom, then left-to-right
  plots.sort((a, b) => a.centroid.y - b.centroid.y || a.centroid.x - b.centroid.x);
  return plots;
}
