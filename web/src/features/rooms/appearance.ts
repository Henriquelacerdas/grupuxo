import { ROOM_COLORS, type Periodicity, type Room, type RoomCategory, type RoomColor, type RoomVisibility } from "@/lib/api/types";
import type { RoomChanges, RoomInput } from "@/lib/client/endpoints";
import { ROOM_NAME_MAX } from "@/lib/rules/tasks";

// Regras do formulário de cômodo (RoomCreationSheetView/RoomEditorViewModel do app): sugestão de ícone, cor e
// categoria pelo nome, ciclo do design (semanal, 2 semanas, mensal, personalizado) e o que muda ao editar.

export interface AppearanceSuggestion { readonly icon: string; readonly color: RoomColor; readonly category: RoomCategory }

const SUGGESTIONS: readonly (AppearanceSuggestion & { readonly keys: readonly string[] })[] = [
  { keys: ["banheiro", "lavabo", "wc", "bath", "toilet", "restroom"], icon: "toilet.fill", color: "cyan", category: "bathroom" },
  { keys: ["cozinha", "copa", "kitchen", "pantry"], icon: "cup.and.saucer.fill", color: "orange", category: "kitchen" },
  { keys: ["sala", "estar", "living", "lounge"], icon: "sofa.fill", color: "brown", category: "livingRoom" },
  { keys: ["quarto", "suite", "bedroom"], icon: "bed.double.fill", color: "indigo", category: "bedroom" },
  { keys: ["garagem", "garage"], icon: "car.fill", color: "gray", category: "outdoor" },
  { keys: ["lavanderia", "area de servico", "laundry"], icon: "washer.fill", color: "teal", category: "laundry" },
  { keys: ["escritorio", "home office", "office", "study"], icon: "desktopcomputer", color: "cyan", category: "office" },
  { keys: ["varanda", "quintal", "jardim", "balcony", "porch", "yard", "garden", "patio"], icon: "sparkles", color: "green", category: "outdoor" },
  { keys: ["lixo", "trash", "garbage"], icon: "trash.fill", color: "gray", category: "other" },
];

/** Sem acento e em minúsculas, como o `folding(.diacriticInsensitive, .caseInsensitive)` do app. */
export function foldName(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();
}

/** Primeira linha da tabela cujo termo aparece no nome (mesma ordem do app). */
export function appearanceSuggestion(name: string): AppearanceSuggestion | null {
  const folded = foldName(name);
  const match = SUGGESTIONS.find((entry) => entry.keys.some((key) => folded.includes(key)));
  return match === undefined ? null : { icon: match.icon, color: match.color, category: match.category };
}

/** Nomes (chaves pt-BR do catálogo) para leitores de tela: no app a grade não tem rótulo. */
export const ICON_NAMES: Readonly<Record<string, string>> = {
  "house.fill": "Casa", "bed.double.fill": "Cama", "sofa.fill": "Sofá", "tv.fill": "TV", desktopcomputer: "Computador",
  "books.vertical.fill": "Livros", "refrigerator.fill": "Geladeira", "cabinet.fill": "Armário", "spigot.fill": "Torneira",
  "cup.and.saucer.fill": "Xícara", "shower.fill": "Chuveiro", "toilet.fill": "Vaso sanitário", "washer.fill": "Máquina de lavar",
  "trash.fill": "Lixo", sparkles: "Brilho", "paintbrush.pointed.fill": "Pincel", "car.fill": "Carro",
};

export const COLOR_NAMES: Readonly<Record<RoomColor, string>> = {
  red: "Vermelho", orange: "Laranja", yellow: "Amarelo", green: "Verde", blue: "Azul", purple: "Roxo",
  brown: "Marrom", gray: "Cinza", pink: "Rosa", teal: "Azul-petróleo", indigo: "Índigo", cyan: "Ciano",
};

export const COLOR_CHOICES: readonly RoomColor[] = ROOM_COLORS;

export type CycleKind = "weekly" | "biweekly" | "monthly" | "custom";
export const CYCLE_KINDS: readonly CycleKind[] = ["weekly", "biweekly", "monthly", "custom"];
export const CUSTOM_WEEKS_MAX = 12;

export function cycleKindOf(intervalWeeks: number): CycleKind {
  if (intervalWeeks === 1) return "weekly";
  if (intervalWeeks === 2) return "biweekly";
  if (intervalWeeks === 4) return "monthly";
  return "custom";
}

/** Mensalmente = 4 semanas (o domínio guarda a periodicidade em semanas). */
export function intervalWeeksFor(kind: CycleKind, customWeeks: number): number {
  switch (kind) {
    case "weekly": return 1;
    case "biweekly": return 2;
    case "monthly": return 4;
    case "custom": return Math.min(CUSTOM_WEEKS_MAX, Math.max(1, Math.round(customWeeks)));
  }
}

export interface RoomDraft {
  readonly name: string;
  readonly category: RoomCategory;
  readonly icon: string;
  readonly color: RoomColor;
  readonly visibility: RoomVisibility;
  readonly periodicity: Periodicity;
  readonly responsibleCount: number;
  /** Participantes do cômodo privado (o criador entra sempre). */
  readonly participantIDs: readonly string[];
}

export function newDraft(creatorID: string): RoomDraft {
  return {
    name: "", category: "other", icon: "house.fill", color: "blue", visibility: "common",
    periodicity: { executionsPerPeriod: 1, intervalWeeks: 1 }, responsibleCount: 1, participantIDs: [creatorID],
  };
}

export function draftFrom(room: Room): RoomDraft {
  return {
    name: room.name, category: room.category, icon: room.icon, color: room.color, visibility: room.visibility,
    periodicity: room.periodicity, responsibleCount: room.responsibleCount, participantIDs: [],
  };
}

/** Pessoas por ciclo vai de 1 a quem participa do cômodo (comum: todos os moradores; privado: os marcados). */
export function maxPeople(draft: RoomDraft, residentCount: number): number {
  return Math.max(1, draft.visibility === "privateRoom" ? draft.participantIDs.length : residentCount);
}

/** Corrige os limites depois de qualquer mudança (como `updateDraft` do app). */
export function clampDraft(draft: RoomDraft, residentCount: number): RoomDraft {
  const name = Array.from(draft.name).slice(0, ROOM_NAME_MAX).join("");
  const responsibleCount = Math.min(Math.max(1, draft.responsibleCount), maxPeople(draft, residentCount));
  const { intervalWeeks } = draft.periodicity;
  const executionsPerPeriod = Math.min(draft.periodicity.executionsPerPeriod, intervalWeeks * 7);
  return { ...draft, name, responsibleCount, periodicity: { intervalWeeks, executionsPerPeriod } };
}

export function createInput(draft: RoomDraft): RoomInput {
  return {
    name: draft.name.trim(), visibility: draft.visibility, category: draft.category, periodicity: draft.periodicity,
    responsibleCount: draft.responsibleCount, icon: draft.icon, color: draft.color,
    ...(draft.visibility === "privateRoom" ? { participantIDs: draft.participantIDs.map((id) => id.toLowerCase()) } : {}),
  };
}

/** Só o que mudou em relação ao cômodo aberto; vazio = nada a gravar. */
export function roomChanges(draft: RoomDraft, room: Room): RoomChanges {
  const name = draft.name.trim();
  const samePeriodicity = draft.periodicity.intervalWeeks === room.periodicity.intervalWeeks
    && draft.periodicity.executionsPerPeriod === room.periodicity.executionsPerPeriod;
  return {
    ...(name !== room.name ? { name } : {}),
    ...(draft.category !== room.category ? { category: draft.category } : {}),
    ...(draft.icon !== room.icon ? { icon: draft.icon } : {}),
    ...(draft.color !== room.color ? { color: draft.color } : {}),
    ...(samePeriodicity ? {} : { periodicity: draft.periodicity }),
    ...(draft.responsibleCount !== room.responsibleCount ? { responsibleCount: draft.responsibleCount } : {}),
  };
}

export const isEmptyChange = (changes: RoomChanges): boolean => Object.keys(changes).length === 0;
