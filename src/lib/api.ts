import type { Plot } from "./plot";
import type { ProjectRow } from "./db";

export type ProjectPatch = Partial<
  Pick<ProjectRow, "name" | "slug" | "status" | "plots" | "imageUrl" | "dziUrl" | "natW" | "natH">
>;

export async function saveProjectPatch(id: string, patch: ProjectPatch): Promise<ProjectRow> {
  const res = await fetch(`/api/projects/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error(`save failed: ${res.status}`);
  const { project } = await res.json();
  return project as ProjectRow;
}
