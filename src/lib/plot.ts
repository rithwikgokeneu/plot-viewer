import { get, set, del } from "idb-keyval";
import type { Pt } from "./detect";

export type Status = "none" | "available" | "reserved" | "booked" | "sold";

export const STATUS: Record<Status, { label: string; color: string }> = {
  none: { label: "Unmarked", color: "#9ca3af" },
  available: { label: "Available", color: "#16a34a" },
  reserved: { label: "Reserved", color: "#eab308" },
  booked: { label: "Booked", color: "#f97316" },
  sold: { label: "Sold", color: "#dc2626" },
};

// The four coloured statuses shown as swatches + count rows. "none" is the
// "cleared" state (box kept, colour removed) — offered via a separate button.
export const STATUS_ORDER: Status[] = [
  "available",
  "reserved",
  "booked",
  "sold",
];

export interface Plot {
  id: number;
  num: string;
  polygon: Pt[]; // detection (proc) coordinates
  centroid: Pt;
  status: Status;
  box?: Pt[]; // user-adjusted box corners (proc coords); overrides the derived box
}

export interface Project {
  image: Blob; // layout image, or a rendered white backdrop for CAD imports
  natW: number;
  natH: number;
  procW: number; // detection resolution used for polygon coords
  procH: number;
  plots: Plot[];
  updatedAt: number;
}

// Display and detection sizing. Bigger display => bigger blocks on screen.
export const DISP_MAX_W = 900;
export const DISP_MAX_H = 1250;
export const PROC_MAX = 1600;

export function fit(
  w: number,
  h: number,
  maxW: number,
  maxH: number
): { w: number; h: number; scale: number } {
  const scale = Math.min(maxW / w, maxH / h, 1);
  return { w: Math.round(w * scale), h: Math.round(h * scale), scale };
}

const KEY = "plot-project";

export async function saveProject(p: Project): Promise<void> {
  await set(KEY, p);
}

export async function loadProject(): Promise<Project | undefined> {
  return get<Project>(KEY);
}

export async function clearProject(): Promise<void> {
  await del(KEY);
}

export function countByStatus(plots: Plot[]): Record<Status, number> {
  const counts: Record<Status, number> = { none: 0, available: 0, reserved: 0, booked: 0, sold: 0 };
  for (const p of plots) counts[p.status] = (counts[p.status] ?? 0) + 1;
  return counts;
}
