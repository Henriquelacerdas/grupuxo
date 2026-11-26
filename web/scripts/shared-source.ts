import { TaskSuggestionCatalog } from "../../backend/src/domain/services/task-suggestion-catalog.ts";

const CATEGORIES = ["kitchen", "bathroom", "bedroom", "livingRoom", "laundry", "office", "outdoor", "other"] as const;

export interface SuggestionJSON { readonly id: string; readonly name: string; readonly details: string; readonly effort: number }

/** Catálogo por categoria, em JSON simples (o esforço vira número). */
export function suggestionsCatalog(): Record<string, SuggestionJSON[]> {
  const catalog = new TaskSuggestionCatalog();
  return Object.fromEntries(CATEGORIES.map((category) => [
    category,
    catalog.suggestions(category).map((s) => ({ id: s.id, name: s.name, details: s.details, effort: s.effort.points })),
  ]));
}
