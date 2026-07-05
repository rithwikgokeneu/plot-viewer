import { describe, it, expect } from "vitest";
import {
  toGray,
  otsuThreshold,
  labelRegions,
  convexHull,
  detectPlots,
} from "./detect";

/** Build an RGBA image from a grayscale value function. */
function makeImage(
  w: number,
  h: number,
  val: (x: number, y: number) => number
) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = val(x, y);
      const i = (y * w + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, width: w, height: h };
}

describe("toGray", () => {
  it("collapses RGBA to luma", () => {
    const g = toGray([255, 255, 255, 255, 0, 0, 0, 255], 2, 1);
    expect(g[0]).toBe(255);
    expect(g[1]).toBe(0);
  });
});

describe("otsuThreshold", () => {
  it("finds a cutoff between two clear clusters", () => {
    const g = new Uint8Array([10, 12, 8, 240, 250, 245]);
    const t = otsuThreshold(g);
    // threshold sits at/above the low cluster and below the high cluster,
    // so "light = gray > t" cleanly separates the two groups
    expect(t).toBeGreaterThanOrEqual(12);
    expect(t).toBeLessThan(240);
  });
});

describe("convexHull", () => {
  it("reduces a filled square to 4 corners", () => {
    const pts = [];
    for (let x = 0; x <= 10; x++)
      for (let y = 0; y <= 10; y++) pts.push({ x, y });
    const hull = convexHull(pts);
    expect(hull.length).toBe(4);
  });
});

describe("labelRegions", () => {
  it("separates two open regions split by a wall column", () => {
    const w = 5;
    const h = 3;
    // columns 0-1 open, column 2 wall, columns 3-4 open
    const open = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) open[y * w + x] = x === 2 ? 0 : 1;
    const { regions } = labelRegions(open, w, h);
    expect(regions.length).toBe(2);
    // both touch the image border here
    expect(regions.every((r) => r.border)).toBe(true);
  });
});

describe("detectPlots", () => {
  it("finds 4 enclosed plots in a framed cross layout", () => {
    const W = 100;
    const H = 100;
    // white background (255); black frame near edges + black cross in the
    // middle => four enclosed white quadrant plots.
    const img = makeImage(W, H, (x, y) => {
      const frame = x < 3 || y < 3 || x > W - 4 || y > H - 4;
      const cross = (x >= 48 && x <= 51) || (y >= 48 && y <= 51);
      return frame || cross ? 0 : 255;
    });
    const plots = detectPlots(img, { threshold: 128 });
    expect(plots.length).toBe(4);
    // centroids land in the four quadrants (numbered top-to-bottom, L-to-R)
    const cs = plots.map((p) => p.centroid);
    expect(cs[0].x).toBeLessThan(50);
    expect(cs[0].y).toBeLessThan(50);
    expect(cs[3].x).toBeGreaterThan(50);
    expect(cs[3].y).toBeGreaterThan(50);
    // each plot polygon is a quadrilateral after hull simplification
    expect(plots.every((p) => p.polygon.length === 4)).toBe(true);
  });

  it("ignores the large background and tiny noise", () => {
    const W = 100;
    const H = 100;
    // one small enclosed box in the center, rest background
    const img = makeImage(W, H, (x, y) => {
      const boxWall =
        (x >= 40 && x <= 60 && (y === 40 || y === 60)) ||
        (y >= 40 && y <= 60 && (x === 40 || x === 60));
      return boxWall ? 0 : 255;
    });
    const plots = detectPlots(img, { threshold: 128 });
    // only the enclosed interior counts (background touches border -> dropped)
    expect(plots.length).toBe(1);
    expect(plots[0].centroid.x).toBeGreaterThan(45);
    expect(plots[0].centroid.x).toBeLessThan(55);
  });
});
