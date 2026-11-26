import { IMPROVEMENT_TAGS, PRAISE_TAGS, type RatingLevel, type RatingTag } from "@/lib/api/types";
import type { Translate, TextContext } from "@/lib/format/labels";
import { weekday } from "@/lib/format/dates";

// Textos dos níveis e das tags da avaliação (WeekRatingText.swift): frases completas, sem estrelas nem pontuação.

export const LEVELS: readonly RatingLevel[] = ["needsWork", "good", "great"];

export function levelTitle(t: Translate, level: RatingLevel): string {
  switch (level) {
    case "needsWork": return t("Precisa melhorar");
    case "good": return t("Bom");
    case "great": return t("Ótimo");
  }
}

/** Pergunta acima das tags: elogio para bom e ótimo, melhoria para "precisa melhorar". */
export function tagsQuestion(t: Translate, level: RatingLevel): string {
  return level === "needsWork" ? t("O que pode melhorar? (opcional)") : t("O que foi bom? (opcional)");
}

export function tagTitle(t: Translate, tag: RatingTag): string {
  switch (tag) {
    case "spotless": return t("Bem limpo");
    case "tidy": return t("Organizado");
    case "onTime": return t("No prazo");
    case "careful": return t("Caprichado");
    case "notCleaned": return t("Faltou limpar");
    case "messy": return t("Ficou bagunçado");
    case "halfDone": return t("Ficou pela metade");
    case "tookTooLong": return t("Demorou para ficar pronto");
  }
}

const IMPROVEMENT: ReadonlySet<RatingTag> = new Set(IMPROVEMENT_TAGS);
export const isImprovement = (tag: RatingTag): boolean => IMPROVEMENT.has(tag);

/** As tags que o nível aceita: melhorar para "precisa melhorar", elogio para os demais. */
export function tagOptions(level: RatingLevel): readonly RatingTag[] {
  return level === "needsWork" ? IMPROVEMENT_TAGS : PRAISE_TAGS;
}

/** "2 nov": dia e mês abreviado, sem "de" nem ponto (como no Figma). */
function shortDay(ctx: TextContext, at: number): string {
  const day = new Intl.DateTimeFormat("en-US", { day: "numeric", timeZone: ctx.timeZone }).format(at);
  const month = new Intl.DateTimeFormat(ctx.locale, { month: "short", timeZone: ctx.timeZone }).format(at).replace(/\./g, "");
  return ctx.locale === "en" ? `${month} ${day}` : `${day} ${month}`;
}

/** "27 out – 2 nov": a semana do resumo (o fim é exclusivo, então o último dia é o anterior). */
export function period(ctx: TextContext, start: number, end: number): string {
  return `${shortDay(ctx, start)} – ${shortDay(ctx, end - 1000)}`;
}

export function ratingCount(t: Translate, count: number): string {
  return count === 1 ? t("1 avaliação") : t("{0} avaliações", count);
}

/** "Termina terça": o último dia para avaliar (a janela fecha à meia-noite do dia seguinte). */
export function closing(ctx: TextContext, windowEnd: number): string {
  return ctx.t("Termina {0}", weekday(windowEnd - 1000, ctx.locale, ctx.timeZone));
}

/** "O resumo sai terça": o dia em que a janela fecha e o resultado é liberado. */
export function summaryComes(ctx: TextContext, windowEnd: number): string {
  return ctx.t("O resumo sai {0}", weekday(windowEnd - 1000, ctx.locale, ctx.timeZone));
}
