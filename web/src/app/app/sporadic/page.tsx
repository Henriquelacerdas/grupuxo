import type { Metadata } from "next";
import { SporadicTasks } from "@/features/tasks/sporadic-tasks";
import { pageTitle } from "@/features/tasks/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await pageTitle("Tarefas Únicas") };
}

export default function Page() {
  return <SporadicTasks />;
}
