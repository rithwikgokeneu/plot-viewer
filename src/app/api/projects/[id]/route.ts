import { NextResponse } from "next/server";
import { list, del } from "@vercel/blob";
import { getProject, updateProject, deleteProject } from "@/lib/db";
import type { ProjectRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const patch = (await request.json()) as Partial<
    Pick<ProjectRow, "name" | "slug" | "status" | "plots" | "imageUrl" | "dziUrl" | "natW" | "natH">
  >;
  const project = await updateProject(id, patch);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ project });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existing = await getProject(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const { blobs } = await list({ prefix: `projects/${id}/` });
  if (blobs.length) await del(blobs.map((b) => b.url));
  await deleteProject(id);
  return NextResponse.json({ ok: true });
}
