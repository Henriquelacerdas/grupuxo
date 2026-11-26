import type { ReactNode } from "react";
import { AppShell } from "@/features/app-shell";

export default function Layout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
