import { sql } from "@vercel/postgres";
import type { Plot } from "./plot";

export interface ProjectRow {
  id: string;
  slug: string;
  name: string;
  natW: number;
  natH: number;
  imageUrl: string | null;
  dziUrl: string | null;
  plots: Plot[];
  status: "draft" | "published";
  updatedAt: number;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapRow(r: any): ProjectRow {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    natW: r.nat_w,
    natH: r.nat_h,
    imageUrl: r.image_url,
    dziUrl: r.dzi_url,
    plots: (r.plots ?? []) as Plot[],
    status: r.status,
    updatedAt: new Date(r.updated_at).getTime(),
  };
}

export async function ensureSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      slug       text UNIQUE NOT NULL,
      name       text NOT NULL,
      nat_w      int NOT NULL,
      nat_h      int NOT NULL,
      image_url  text,
      dzi_url    text,
      plots      jsonb NOT NULL DEFAULT '[]'::jsonb,
      status     text NOT NULL DEFAULT 'draft',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `;
}

export async function listProjects(): Promise<ProjectRow[]> {
  const { rows } = await sql`SELECT * FROM projects ORDER BY updated_at DESC;`;
  return rows.map(mapRow);
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const { rows } = await sql`SELECT * FROM projects WHERE id = ${id};`;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function getProjectBySlug(slug: string): Promise<ProjectRow | null> {
  const { rows } = await sql`SELECT * FROM projects WHERE slug = ${slug};`;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function createProject(input: {
  slug: string;
  name: string;
  natW: number;
  natH: number;
  plots: Plot[];
}): Promise<ProjectRow> {
  const { rows } = await sql`
    INSERT INTO projects (slug, name, nat_w, nat_h, plots)
    VALUES (${input.slug}, ${input.name}, ${input.natW}, ${input.natH}, ${JSON.stringify(
      input.plots
    )}::jsonb)
    RETURNING *;
  `;
  return mapRow(rows[0]);
}

export async function updateProject(
  id: string,
  patch: Partial<
    Pick<ProjectRow, "name" | "slug" | "status" | "plots" | "imageUrl" | "dziUrl" | "natW" | "natH">
  >
): Promise<ProjectRow | null> {
  // COALESCE keeps existing values when a field is omitted (undefined -> null param).
  const { rows } = await sql`
    UPDATE projects SET
      name       = COALESCE(${patch.name ?? null}, name),
      slug       = COALESCE(${patch.slug ?? null}, slug),
      status     = COALESCE(${patch.status ?? null}, status),
      nat_w      = COALESCE(${patch.natW ?? null}, nat_w),
      nat_h      = COALESCE(${patch.natH ?? null}, nat_h),
      image_url  = COALESCE(${patch.imageUrl ?? null}, image_url),
      dzi_url    = COALESCE(${patch.dziUrl ?? null}, dzi_url),
      plots      = COALESCE(${patch.plots ? JSON.stringify(patch.plots) : null}::jsonb, plots),
      updated_at = now()
    WHERE id = ${id}
    RETURNING *;
  `;
  return rows[0] ? mapRow(rows[0]) : null;
}

export async function deleteProject(id: string): Promise<void> {
  await sql`DELETE FROM projects WHERE id = ${id};`;
}
