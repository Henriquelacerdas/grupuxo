import "server-only";
import { headers } from "next/headers";
import { messagesFor } from "@/i18n/load";
import { format, pickLocale } from "@/i18n/messages";

/** Título da aba no idioma do navegador (o `title` do layout completa com " · Reveza"). */
export async function pageTitle(key: string): Promise<string> {
  const locale = pickLocale((await headers()).get("accept-language"));
  return format(locale, messagesFor(locale), key, []);
}
