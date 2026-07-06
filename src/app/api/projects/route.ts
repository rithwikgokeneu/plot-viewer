import { NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/db";
import { slugify, uniqueSlug } from "@/lib/slug";
import type { Plot } from "@/lib/plot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const projects = await listProjects();
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    name?: string;
    natW?: number;
    natH?: number;
    plots?: Plot[];
  };
  if (!body.name || !body.natW || !body.natH) {
    return NextResponse.json({ error: "name, natW, natH required" }, { status: 400 });
  }
  const existing = new Set((await listProjects()).map((p) => p.slug));
  const slug = uniqueSlug(slugify(body.name), existing);
  const project = await createProject({
    slug,
    name: body.name,
    natW: body.natW,
    natH: body.natH,
    plots: body.plots ?? [],
  });
  return NextResponse.json({ project }, { status: 201 });
}
