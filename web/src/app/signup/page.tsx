import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { authPageProps, localizedTitle, type SearchParams } from "@/features/auth/page-props";
import { SignUpForm } from "@/features/auth/signup-form";
import { hasSession } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await localizedTitle("Criar conta") };
}

export default async function SignUpPage({ searchParams }: { searchParams: SearchParams }) {
  const props = await authPageProps(searchParams);
  if (await hasSession()) redirect(props.next);
  return <SignUpForm {...props} />;
}
