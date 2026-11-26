import "server-only";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { messagesFor } from "@/i18n/load";
import { format, pickLocale } from "@/i18n/messages";

/** Título da aba do navegador no idioma do pedido. */
export async function localizedTitle(key: string): Promise<Metadata> {
  const locale = pickLocale((await headers()).get("accept-language"));
  return { title: format(locale, messagesFor(locale), key, []) };
}
