import { NextResponse } from "next/server";
import { ensureSchema, seedIfEmpty } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// First-run auto-detect seed: the client detects plots on the bundled map and
// posts them here. Only writes if the shared state is still empty (idempotent),
// so it's safe to call from any first visitor without auth and can't overwrite
// admin edits.
export async function POST(request: Request) {
  const body = (await request.json()) as {
    plots?: unknown;
    procW?: number;
    procH?: number;
  };
  if (!Array.isArray(body.plots) || !body.procW || !body.procH) {
    return NextResponse.json({ error: "plots, procW, procH required" }, { status: 400 });
  }
  await ensureSchema();
  const seeded = await seedIfEmpty(body.plots as never[], body.procW, body.procH);
  return NextResponse.json({ seeded });
}
