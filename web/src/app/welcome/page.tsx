import type { Metadata } from "next";
import { WelcomeScreen } from "@/features/auth/welcome-screen";
import { authPageProps, localizedTitle, type SearchParams } from "@/features/auth/page-props";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await localizedTitle("Boas-vindas") };
}

/** "Como o Reveza funciona" (Ajustes › Ajuda) e primeira visita: Continuar volta para `next`. */
export default async function WelcomePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { next } = await authPageProps(Promise.resolve({ next: params["next"] ?? "/login" }));
  return <WelcomeScreen next={next} />;
}
