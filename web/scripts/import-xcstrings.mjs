// Gera src/i18n/catalog.{pt-BR,en}.json a partir do Localizable.xcstrings do app iOS (fonte pt-BR, tradução en).
// Chave = texto pt-BR do catálogo (como no app). Especificadores do iOS viram marcadores posicionais:
// `%@`/`%lld` → `{0}`, `{1}`…; `%2$@` → `{1}`. Plurais viram { "plural": <índice do argumento>, "one", "other", … }.
// Uso: npm run i18n:import (rodar de novo quando o catálogo do app mudar).
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "../../grupuxo/grupuxo/Localizable.xcstrings");
const catalog = JSON.parse(readFileSync(source, "utf8"));

/** Troca os especificadores do iOS por `{n}`; `start` é o primeiro índice dos sequenciais. */
function placeholders(text, start = 0) {
  let next = start;
  return text.replace(/%(?:(\d+)\$)?(?:@|lld|ld|d|f|\.\d+f)/g, (_m, position) => {
    const index = position === undefined ? next++ : Number(position) - 1;
    return `{${index}}`;
  });
}

function unitValue(entry) {
  return entry?.stringUnit?.value;
}

function pluralOf(variations, argIndex, wrap) {
  const plural = variations?.plural;
  if (plural === undefined) return undefined;
  const out = { plural: argIndex };
  for (const [category, entry] of Object.entries(plural)) {
    const value = unitValue(entry);
    if (typeof value === "string") out[category] = wrap(value);
  }
  return out;
}

function firstNumericArg(text) {
  let index = 0;
  for (const match of text.matchAll(/%(?:(\d+)\$)?(@|lld|ld|d)/g)) {
    const position = match[1] === undefined ? index : Number(match[1]) - 1;
    if (match[2] !== "@") return position;
    index++;
  }
  return 0;
}

function message(localization, key) {
  if (localization === undefined) return undefined;
  if (localization.substitutions !== undefined) {
    const outer = unitValue(localization) ?? key;
    const [name, sub] = Object.entries(localization.substitutions)[0];
    const argIndex = (sub.argNum ?? 1) - 1;
    return pluralOf(sub.variations, argIndex, (inner) => {
      const expanded = outer.replace(new RegExp(`%(?:\\d+\\$)?#@${name}@`), inner.replace(/%arg/g, `%${argIndex + 1}$lld`));
      return placeholders(expanded);
    });
  }
  if (localization.variations !== undefined) {
    if (localization.variations.plural !== undefined) {
      const base = Object.values(localization.variations.plural).map(unitValue).find((v) => typeof v === "string") ?? key;
      return pluralOf(localization.variations, firstNumericArg(base), (v) => placeholders(v));
    }
    const device = localization.variations.device;
    const value = unitValue(device?.other ?? device?.iphone ?? Object.values(device ?? {})[0]);
    return value === undefined ? undefined : placeholders(value);
  }
  const value = unitValue(localization);
  return value === undefined ? undefined : placeholders(value);
}

const pt = {};
const en = {};
for (const [key, entry] of Object.entries(catalog.strings)) {
  if (key === "" || entry.shouldTranslate === false) continue;
  const localizations = entry.localizations ?? {};
  pt[placeholders(key)] = message(localizations["pt-BR"], key) ?? placeholders(key);
  const english = message(localizations.en, key);
  if (english !== undefined) en[placeholders(key)] = english;
}

const sorted = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a.localeCompare(b, "pt-BR")));
writeFileSync(join(here, "../src/i18n/catalog.pt-BR.json"), `${JSON.stringify(sorted(pt), null, 1)}\n`);
writeFileSync(join(here, "../src/i18n/catalog.en.json"), `${JSON.stringify(sorted(en), null, 1)}\n`);
process.stdout.write(`catálogo: ${Object.keys(pt).length} chaves pt-BR, ${Object.keys(en).length} en\n`);
