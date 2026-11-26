import type { Metadata } from "next";
import { Suspense } from "react";
import { MyTasks } from "@/features/tasks/my-tasks";
import { pageTitle } from "@/features/tasks/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await pageTitle("Minhas tarefas") };
}

export default function Page() {
  return (
    <Suspense>
      <MyTasks />
    </Suspense>
  );
}
