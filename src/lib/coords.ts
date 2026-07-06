import type { Pt } from "./detect";

export function normPolygon(poly: Pt[], procW: number, procH: number): Pt[] {
  return poly.map((p) => ({ x: p.x / procW, y: p.y / procH }));
}

export function denormPolygon(poly: Pt[], procW: number, procH: number): Pt[] {
  return poly.map((p) => ({ x: p.x * procW, y: p.y * procH }));
}

export function normCentroid(p: Pt, procW: number, procH: number): Pt {
  return { x: p.x / procW, y: p.y / procH };
}

// Normalized (0..1 of each axis) -> OpenSeadragon viewport coords.
// OSD viewport x spans [0,1] across the image width; y spans [0, natH/natW].
export function toViewport(p: Pt, natW: number, natH: number): Pt {
  return { x: p.x, y: p.y * (natH / natW) };
}

// OSD image-pixel coords (0..natW, 0..natH) -> normalized 0..1 of each axis.
export function fromImagePixels(p: Pt, natW: number, natH: number): Pt {
  return { x: p.x / natW, y: p.y / natH };
}
