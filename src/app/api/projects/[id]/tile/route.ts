import { NextResponse } from "next/server";
import { put } from "@vercel/blob";
import sharp from "sharp";
import { mkdtemp, readFile, readdir, stat, rm } from "fs/promises";
import { tmpdir } from "os";
import { join, relative } from "path";
import { getProject, updateProject } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 300; // seconds — raise/lower per your Vercel plan

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    if ((await stat(full)).isDirectory()) yield* walk(full);
    else yield full;
  }
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project?.imageUrl) {
    return NextResponse.json({ error: "no image to tile" }, { status: 400 });
  }

  const buf = Buffer.from(await (await fetch(project.imageUrl)).arrayBuffer());
  const workDir = await mkdtemp(join(tmpdir(), `pv-${id}-`));
  const outBase = join(workDir, "dz"); // sharp writes dz.dzi + dz_files/

  try {
    // sharp's own "dz" (Deep Zoom) layout appends the .dzi/_files suffixes
    // itself — passing an already-suffixed path (e.g. "dz.dzi") double-appends
    // to "dz.dzi.dzi" / "dz.dzi_files", which breaks the "dz.dzi" match below.
    // "dzi" is not a valid `layout` value (sharp accepts dz/iiif/iiif3/zoomify/google).
    await sharp(buf)
      .webp({ quality: 80 })
      .tile({ size: 512, overlap: 1, layout: "dz" })
      .toFile(outBase);

    // Upload dz.dzi and every dz_files/** tile, preserving relative paths.
    let dziUrl = "";
    for await (const file of walk(workDir)) {
      const rel = relative(workDir, file); // e.g. "dz.dzi" or "dz_files/10/0_0.webp"
      const data = await readFile(file);
      const contentType = rel.endsWith(".dzi") ? "application/xml" : "image/webp";
      const uploaded = await put(`projects/${id}/${rel}`, data, {
        access: "public",
        addRandomSuffix: false,
        contentType,
      });
      if (rel === "dz.dzi") dziUrl = uploaded.url;
    }

    await updateProject(id, { dziUrl });
    return NextResponse.json({ dziUrl });
  } finally {
    // Vercel Functions can reuse warm containers between invocations, so /tmp
    // persists across requests — without this, tile pyramids would accumulate
    // on disk until the container's /tmp cap is hit and tiling fails (ENOSPC).
    await rm(workDir, { recursive: true, force: true });
  }
}
