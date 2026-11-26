import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/features/auth/login-form";
import { authPageProps, localizedTitle, type SearchParams } from "@/features/auth/page-props";
import { hasSession } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await localizedTitle("Entrar") };
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const props = await authPageProps(searchParams);
  if (await hasSession()) redirect(props.next);
  return <LoginForm {...props} />;
}
