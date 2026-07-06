import Link from "next/link";
import { notFound } from "next/navigation";
import { getProject } from "@/lib/db";
import PlotEditor from "@/components/PlotEditor";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) notFound();
  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-sm text-neutral-600">/p/{project.slug}</p>
        </div>
        <Link href="/admin" className="text-sm text-neutral-600 underline hover:text-neutral-900">
          ← All projects
        </Link>
      </header>
      <PlotEditor
        projectId={project.id}
        initialImageUrl={project.imageUrl}
        initialDziUrl={project.dziUrl}
        initialNat={{ w: project.natW, h: project.natH }}
        initialPlots={project.plots}
      />
    </main>
  );
}
