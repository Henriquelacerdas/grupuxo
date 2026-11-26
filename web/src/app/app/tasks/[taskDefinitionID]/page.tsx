import type { Metadata } from "next";
import { TaskDetail } from "@/features/tasks/task-detail";
import { pageTitle } from "@/features/tasks/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await pageTitle("Detalhes") };
}

export default async function Page({ params }: { params: Promise<{ taskDefinitionID: string }> }) {
  const { taskDefinitionID } = await params;
  return <TaskDetail taskDefinitionID={decodeURIComponent(taskDefinitionID)} />;
}
