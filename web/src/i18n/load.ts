import "server-only";
import en from "./catalog.en.json";
import pt from "./catalog.pt-BR.json";
import { WEB_EN, WEB_PT } from "./web-strings";
import type { Locale, Message, Messages } from "./messages";

function isMessage(value: unknown): value is Message {
  return typeof value === "string" || (typeof value === "object" && value !== null && "plural" in value);
}

function clean(source: Readonly<Record<string, unknown>>): Record<string, Message> {
  const out: Record<string, Message> = {};
  for (const [key, value] of Object.entries(source)) if (isMessage(value)) out[key] = value;
  return out;
}

/** Só o idioma pedido vai ao navegador; em pt-BR, só as entradas que não são a própria chave. */
export function messagesFor(locale: Locale): Messages {
  if (locale === "en") return { ...clean(en), ...WEB_EN };
  const out: Record<string, Message> = {};
  for (const [key, value] of Object.entries(clean(pt))) if (value !== key) out[key] = value;
  return { ...out, ...WEB_PT };
}
