import type { Frequency, Periodicity, Recurrence } from "@/lib/api/types";
import type { Translate } from "@/lib/format/labels";
import { cycleDuration, recurrenceText } from "@/lib/format/labels";

// Nomes de repetição do editor (RecurrencePresentation) e do detalhe (TaskDetailText), com o vocabulário da
// Apple: Semanalmente, A cada 2 semanas, Mensalmente.

export const FREQUENCY_ORDER: readonly Frequency[] = ["daily", "weekly", "monthly", "yearly"];

export function frequencyName(t: Translate, frequency: Frequency): string {
  switch (frequency) {
    case "daily": return t("Diariamente");
    case "weekly": return t("Semanalmente");
    case "monthly": return t("Mensalmente");
    case "yearly": return t("Anualmente");
  }
}

export function unitName(t: Translate, frequency: Frequency, interval: number): string {
  const one = interval === 1;
  switch (frequency) {
    case "daily": return one ? t("dia") : t("dias");
    case "weekly": return one ? t("semana") : t("semanas");
    case "monthly": return one ? t("mês") : t("meses");
    case "yearly": return one ? t("ano") : t("anos");
  }
}

export function intervalName(t: Translate, frequency: Frequency, interval: number): string {
  if (interval === 1) return frequencyName(t, frequency);
  if (frequency === "monthly" && interval === 3) return t("A cada 3 meses");
  if (frequency === "monthly" && interval === 6) return t("A cada 6 meses");
  return t("A cada {0} {1}", interval, unitName(t, frequency, interval));
}

/** Periodicidade de um cômodo: "Semanalmente", "A cada 2 semanas"; mais de uma vez no período, o rótulo do domínio. */
export function periodicityName(t: Translate, periodicity: Periodicity): string {
  return periodicity.executionsPerPeriod === 1
    ? intervalName(t, "weekly", periodicity.intervalWeeks)
    : t("{0} vez(es) a cada {1} semana(s)", periodicity.executionsPerPeriod, periodicity.intervalWeeks);
}

/** Valor da linha "Repetição" do editor. */
export function recurrenceName(t: Translate, recurrence: Recurrence): string {
  switch (recurrence.kind) {
    case "none": return t("Sem repetição");
    case "weekly": return periodicityName(t, recurrence.periodicity);
    case "recurring": return intervalName(t, recurrence.frequency, recurrence.interval);
  }
}

/** Linha "Repetição" do detalhe da tarefa. */
export function detailRecurrence(t: Translate, recurrence: Recurrence): string {
  switch (recurrence.kind) {
    case "none": return t("Não se repete");
    case "weekly": return cycleDuration(t, recurrence.periodicity);
    case "recurring": return recurrence.interval === 1 ? frequencyName(t, recurrence.frequency) : (recurrenceText(t, recurrence) ?? "");
  }
}

export function recurrenceSummary(t: Translate, frequency: Frequency, interval: number): string {
  if (interval === 1) {
    switch (frequency) {
      case "daily": return t("A tarefa ocorrerá todos os dias.");
      case "weekly": return t("A tarefa ocorrerá toda semana.");
      case "monthly": return t("A tarefa ocorrerá todo mês.");
      case "yearly": return t("A tarefa ocorrerá todo ano.");
    }
  }
  return t("A tarefa ocorrerá a cada {0} {1}.", interval, unitName(t, frequency, interval));
}

/** Opções fixas do menu de repetição própria, na ordem do app. */
export const RECURRENCE_PRESETS: readonly { readonly frequency: Frequency; readonly interval: number }[] = [
  { frequency: "daily", interval: 1 },
  { frequency: "weekly", interval: 1 },
  { frequency: "weekly", interval: 2 },
  { frequency: "monthly", interval: 1 },
  { frequency: "monthly", interval: 3 },
  { frequency: "monthly", interval: 6 },
  { frequency: "yearly", interval: 1 },
];
