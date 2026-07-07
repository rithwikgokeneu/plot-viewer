import { NextResponse } from "next/server";
import { ensureSchema, getPlots, savePlots } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Public read — the current shared plot state.
export async function GET() {
  await ensureSchema();
  const state = await getPlots();
  return NextResponse.json(state ?? { plots: [], procW: 0, procH: 0, updatedAt: 0 });
}

// Admin write — overwrite the shared plots. Guarded by the admin password
// (sent from the client after the gate). Not bank-grade, but blocks casual writes.
export async function PATCH(request: Request) {
  const pw = request.headers.get("x-admin-password");
  if (!pw || pw !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await request.json()) as {
    plots?: unknown;
    procW?: number;
    procH?: number;
  };
  if (!Array.isArray(body.plots) || !body.procW || !body.procH) {
    return NextResponse.json({ error: "plots, procW, procH required" }, { status: 400 });
  }
  await ensureSchema();
  await savePlots(body.plots as never[], body.procW, body.procH);
  return NextResponse.json({ ok: true });
}
