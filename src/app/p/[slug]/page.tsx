import { notFound } from "next/navigation";
import { getProjectBySlug } from "@/lib/db";
import PublicViewer from "@/components/PublicViewer";

export const dynamic = "force-dynamic";

export default async function PublicProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const project = await getProjectBySlug(slug);
  if (!project || project.status !== "published" || !project.dziUrl) notFound();
  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <h1 className="mb-4 text-xl font-bold sm:text-2xl">{project.name}</h1>
      <PublicViewer
        name={project.name}
        dziUrl={project.dziUrl}
        natW={project.natW}
        natH={project.natH}
        plots={project.plots}
      />
    </main>
  );
}
