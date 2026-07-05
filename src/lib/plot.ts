import { get, set, del } from "idb-keyval";
import type { Pt } from "./detect";

export type Status = "available" | "reserved" | "booked" | "sold";

export const STATUS: Record<Status, { label: string; color: string }> = {
  available: { label: "Available", color: "#16a34a" },
  reserved: { label: "Reserved", color: "#eab308" },
  booked: { label: "Booked", color: "#f97316" },
  sold: { label: "Sold", color: "#dc2626" },
};

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
}

export interface Project {
  image: Blob; // layout image, or a rendered white backdrop for CAD imports
  natW: number;
  natH: number;
  procW: number; // coordinate space used for polygon coords
  procH: number;
  plots: Plot[];
  source?: "image" | "dxf"; // how plots were produced
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
  return STATUS_ORDER.reduce(
    (acc, s) => ({ ...acc, [s]: plots.filter((p) => p.status === s).length }),
    {} as Record<Status, number>
  );
}
