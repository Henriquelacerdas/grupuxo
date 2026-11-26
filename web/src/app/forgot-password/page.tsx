import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ForgotForm } from "@/features/auth/forgot-form";
import { authPageProps, localizedTitle, type SearchParams } from "@/features/auth/page-props";
import { hasSession } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await localizedTitle("Esqueci a senha") };
}

export default async function ForgotPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const { next, initialEmail } = await authPageProps(searchParams);
  if (await hasSession()) redirect(next);
  return <ForgotForm next={next} initialEmail={initialEmail} />;
}
