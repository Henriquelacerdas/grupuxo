import type { Metadata } from "next";
import { localizedTitle } from "@/features/auth/page-props";
import { InviteScreen } from "@/features/onboarding/invite-screen";
import { inviteCodeFromPath } from "@/features/onboarding/pending-invite";
import { hasSession } from "@/server/auth";

export async function generateMetadata(): Promise<Metadata> {
  return { title: await localizedTitle("Convite"), robots: { index: false, follow: false } };
}

/** Link de convite (`/invite/ABC123`): substitui o App Clip para quem não tem iPhone. */
export default async function InvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <InviteScreen code={inviteCodeFromPath(code)} signedIn={await hasSession()} />;
}
