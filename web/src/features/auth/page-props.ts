import "server-only";
import { normalizeEmail, safeNext } from "./logic";
import type { LegalLinks } from "./auth-screen";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function httpsURL(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** `?next=` validado, e-mail pré-preenchido e links legais (lidos do ambiente no servidor). */
export async function authPageProps(searchParams: SearchParams): Promise<{ next: string; initialEmail: string; legal: LegalLinks }> {
  const params = await searchParams;
  const email = normalizeEmail(single(params["email"]) ?? "");
  return {
    next: safeNext(single(params["next"])),
    initialEmail: email.length <= 254 ? email : "",
    legal: { terms: httpsURL(process.env.NEXT_PUBLIC_TERMS_URL), privacy: httpsURL(process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL) },
  };
}

/** Título da aba no idioma do navegador (as páginas de conta não têm casa nem cliente para traduzir). */
export async function localizedTitle(key: string): Promise<string> {
  const { headers } = await import("next/headers");
  const { messagesFor } = await import("@/i18n/load");
  const { format, pickLocale } = await import("@/i18n/messages");
  const locale = pickLocale((await headers()).get("accept-language"));
  return format(locale, messagesFor(locale), key, []);
}
