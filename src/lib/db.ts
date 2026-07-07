import { sql } from "@vercel/postgres";
import type { Plot } from "./plot";

// Single shared row (id = 1) holding the whole plots array + the proc-coordinate
// space they were detected in. One map, one shared state — every visitor sees it.
export interface PlotsState {
  plots: Plot[];
  procW: number;
  procH: number;
  updatedAt: number;
}

export async function ensureSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS plots_state (
      id         int PRIMARY KEY DEFAULT 1,
      plots      jsonb NOT NULL DEFAULT '[]'::jsonb,
      proc_w     int NOT NULL DEFAULT 0,
      proc_h     int NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT plots_state_single_row CHECK (id = 1)
    );
  `;
}

export async function getPlots(): Promise<PlotsState | null> {
  const { rows } = await sql`SELECT plots, proc_w, proc_h, updated_at FROM plots_state WHERE id = 1;`;
  const r = rows[0];
  if (!r) return null;
  return {
    plots: (r.plots ?? []) as Plot[],
    procW: r.proc_w,
    procH: r.proc_h,
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

export async function savePlots(plots: Plot[], procW: number, procH: number): Promise<void> {
  await sql`
    INSERT INTO plots_state (id, plots, proc_w, proc_h, updated_at)
    VALUES (1, ${JSON.stringify(plots)}::jsonb, ${procW}, ${procH}, now())
    ON CONFLICT (id) DO UPDATE SET
      plots = EXCLUDED.plots,
      proc_w = EXCLUDED.proc_w,
      proc_h = EXCLUDED.proc_h,
      updated_at = now();
  `;
}

// Seed only if empty (no plots yet) — idempotent, safe for first-run auto-detect.
// Returns true if it seeded, false if state already existed.
export async function seedIfEmpty(plots: Plot[], procW: number, procH: number): Promise<boolean> {
  const existing = await getPlots();
  if (existing && existing.plots.length > 0) return false;
  await savePlots(plots, procW, procH);
  return true;
}
