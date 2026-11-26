"use client";

import { useRouter } from "next/navigation";
import { WelcomeView, markWelcomeSeen } from "./welcome";

export function WelcomeScreen({ next }: { next: string }) {
  const router = useRouter();
  return <WelcomeView onContinue={() => { markWelcomeSeen(); router.replace(next); }} />;
}
