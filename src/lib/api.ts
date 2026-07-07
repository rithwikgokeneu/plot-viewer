import type { Plot } from "./plot";
import type { PlotsState } from "./db";

// Read the shared plot state from the live DB.
export async function fetchPlots(): Promise<PlotsState> {
  const res = await fetch("/api/plots", { cache: "no-store" });
  if (!res.ok) throw new Error(`load failed: ${res.status}`);
  return (await res.json()) as PlotsState;
}

// Admin write — persists the full plots array (sends the admin password header).
export async function savePlotsRemote(
  plots: Plot[],
  procW: number,
  procH: number,
  password: string
): Promise<void> {
  const res = await fetch("/api/plots", {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-admin-password": password },
    body: JSON.stringify({ plots, procW, procH }),
  });
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
}

// First-run seed (idempotent server-side; no-op if state already exists).
export async function seedPlotsRemote(plots: Plot[], procW: number, procH: number): Promise<void> {
  await fetch("/api/plots/seed", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plots, procW, procH }),
  });
}
