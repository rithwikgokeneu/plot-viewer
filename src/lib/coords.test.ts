import { describe, it, expect } from "vitest";
import { normPolygon, denormPolygon, toViewport, fromImagePixels } from "./coords";

describe("coords", () => {
  it("normalizes proc coords to 0..1 of each axis", () => {
    expect(normPolygon([{ x: 800, y: 600 }], 1600, 1200)).toEqual([{ x: 0.5, y: 0.5 }]);
  });
  it("round-trips norm <-> proc", () => {
    const proc = [{ x: 123, y: 456 }];
    const back = denormPolygon(normPolygon(proc, 1600, 1200), 1600, 1200);
    expect(back[0].x).toBeCloseTo(123);
    expect(back[0].y).toBeCloseTo(456);
  });
  it("maps normalized to OSD viewport coords (y scaled by natH/natW)", () => {
    // 2:1 landscape image -> y axis spans 0..0.5
    expect(toViewport({ x: 0.5, y: 1 }, 2000, 1000)).toEqual({ x: 0.5, y: 0.5 });
  });
  it("maps OSD image pixels to normalized 0..1", () => {
    expect(fromImagePixels({ x: 1000, y: 500 }, 2000, 1000)).toEqual({ x: 0.5, y: 0.5 });
  });
});
