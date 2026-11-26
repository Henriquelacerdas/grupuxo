// Catálogo de textos: o do app (gerado de Localizable.xcstrings por scripts/import-xcstrings.mjs) mais os textos
// só do web (web-strings.ts). Chave = texto pt-BR. Idioma: pt-BR ou en (outro idioma cai no inglês, como o app).

export type PluralMessage = { readonly plural: number } & Readonly<Partial<Record<Intl.LDMLPluralRule, string>>>;
export type Message = string | PluralMessage;
export type Messages = Readonly<Record<string, Message>>;

export const LOCALES = ["pt-BR", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** `Accept-Language` → pt-BR (qualquer português) ou en. */
export function pickLocale(acceptLanguage: string | null): Locale {
  if (acceptLanguage === null) return "pt-BR";
  const tags = acceptLanguage.split(",").map((part) => part.split(";")[0]?.trim().toLowerCase() ?? "");
  for (const tag of tags) {
    if (tag.startsWith("pt")) return "pt-BR";
    if (tag.startsWith("en")) return "en";
  }
  return tags.length === 0 || tags[0] === "" ? "pt-BR" : "en";
}

function isPlural(message: Message): message is PluralMessage {
  return typeof message !== "string";
}

export type Arg = string | number;

export function format(locale: Locale, messages: Messages, key: string, args: readonly Arg[]): string {
  const message = messages[key] ?? key;
  let template: string;
  if (isPlural(message)) {
    const count = args[message.plural];
    const category = new Intl.PluralRules(locale).select(typeof count === "number" ? count : Number(count ?? 0));
    template = message[category] ?? message.other ?? key;
  } else {
    template = message;
  }
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = args[Number(index)];
    if (value === undefined) return match;
    return typeof value === "number" ? new Intl.NumberFormat(locale).format(value) : value;
  });
}
