import DxfParser from "dxf-parser";
import type { Pt } from "./detect";

// Extract plot polygons + their printed numbers from a DXF (AutoCAD) drawing.
// Plot boundaries are closed polylines; plot numbers are TEXT/MTEXT entities.
// Each plot's number is the largest numeric text whose point falls inside it.
// Ported from the verified Python (ezdxf + shapely) pipeline.

interface RawPoly {
  pts: Pt[];
  area: number;
  cx: number;
  cy: number;
}
interface NumText {
  val: number;
  x: number;
  y: number;
  h: number;
}
export interface DxfPlot {
  num: string;
  polygon: Pt[]; // normalized display coords (Y-flipped)
  area: number; // raw DXF area (units^2)
}
export interface DxfResult {
  plots: DxfPlot[];
  procW: number;
  procH: number;
}

function shoelace(pts: Pt[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function pointInPolygon(x: number, y: number, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    const hit =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function cleanMText(s: string): string {
  return s
    .replace(/\\[A-Za-z][^;]*;/g, "") // formatting codes like \A1;
    .replace(/[{}]/g, "")
    .replace(/\\P/g, " ")
    .trim();
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function parseDxfPlots(text: string): DxfResult {
  const parser = new DxfParser();
  const dxf = parser.parseSync(text) as unknown as {
    entities: Array<Record<string, unknown>>;
  };
  const entities = dxf?.entities ?? [];

  const polys: RawPoly[] = [];
  const nums: NumText[] = [];

  for (const e of entities) {
    const type = e.type as string;
    if (type === "LWPOLYLINE" || type === "POLYLINE") {
      const verts = (e.vertices as Array<{ x: number; y: number }>) || [];
      if (verts.length >= 3) {
        const pts = verts.map((v) => ({ x: v.x, y: v.y }));
        const area = shoelace(pts);
        if (area > 0) {
          let cx = 0;
          let cy = 0;
          for (const p of pts) {
            cx += p.x;
            cy += p.y;
          }
          polys.push({ pts, area, cx: cx / pts.length, cy: cy / pts.length });
        }
      }
    } else if (type === "TEXT" || type === "MTEXT") {
      const rawText =
        type === "MTEXT"
          ? cleanMText(String(e.text ?? ""))
          : String(e.text ?? "").trim();
      if (/^\d{1,4}$/.test(rawText)) {
        const pos =
          (e.startPoint as { x: number; y: number }) ||
          (e.position as { x: number; y: number });
        const h = Number(e.textHeight ?? e.height ?? e.nominalTextHeight ?? 0);
        if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
          nums.push({ val: parseInt(rawText, 10), x: pos.x, y: pos.y, h });
        }
      }
    }
  }

  // assign each numeric text to the smallest polygon containing it
  const assign = new Map<number, NumText[]>();
  for (const n of nums) {
    let best = -1;
    let bestArea = Infinity;
    for (let i = 0; i < polys.length; i++) {
      if (polys[i].area < bestArea && pointInPolygon(n.x, n.y, polys[i].pts)) {
        best = i;
        bestArea = polys[i].area;
      }
    }
    if (best >= 0) {
      const arr = assign.get(best) ?? [];
      arr.push(n);
      assign.set(best, arr);
    }
  }

  // candidate = polygon with a number; number = tallest text (tie: nearest center)
  const cand: { pi: number; num: number; area: number }[] = [];
  for (const [pi, texts] of assign) {
    const p = polys[pi];
    texts.sort((a, b) => {
      if (b.h !== a.h) return b.h - a.h;
      const da = (p.cx - a.x) ** 2 + (p.cy - a.y) ** 2;
      const db = (p.cx - b.x) ** 2 + (p.cy - b.y) ** 2;
      return da - db;
    });
    cand.push({ pi, num: texts[0].val, area: p.area });
  }

  // keep plots within a plausible size band around the median plot area
  const med = median(cand.map((c) => c.area));
  const banded = cand.filter((c) => c.area >= 0.15 * med && c.area <= 6 * med);

  // one polygon per number: keep the tightest (smallest area)
  const byNum = new Map<number, { pi: number; num: number; area: number }>();
  for (const c of banded) {
    const cur = byNum.get(c.num);
    if (!cur || c.area < cur.area) byNum.set(c.num, c);
  }
  const finals = [...byNum.values()].sort((a, b) => a.num - b.num);

  // normalize to display coords: translate to origin, flip Y, scale to width 1000
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const f of finals) {
    for (const p of polys[f.pi].pts) {
      if (p.x < minx) minx = p.x;
      if (p.x > maxx) maxx = p.x;
      if (p.y < miny) miny = p.y;
      if (p.y > maxy) maxy = p.y;
    }
  }
  const spanX = maxx - minx || 1;
  const spanY = maxy - miny || 1;
  const scale = 1000 / spanX;
  const procW = Math.round(spanX * scale);
  const procH = Math.round(spanY * scale);

  const plots: DxfPlot[] = finals.map((f) => ({
    num: String(f.num),
    area: Math.round(polys[f.pi].area * 100) / 100,
    polygon: polys[f.pi].pts.map((p) => ({
      x: (p.x - minx) * scale,
      y: (maxy - p.y) * scale, // flip Y for screen coords
    })),
  }));

  return { plots, procW, procH };
}
