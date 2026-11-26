import suggestions from "@/lib/shared/task-suggestions.json";
import type { RoomCategory, RoomColor } from "@/lib/api/types";

// Cômodos do passo "Primeiros cômodos" (StarterRooms.swift): comuns, semanais, 1 pessoa por ciclo, e as 2 primeiras
// tarefas sugeridas do catálogo da categoria, que seguem o cômodo.

export interface StarterRoom {
  readonly id: RoomCategory;
  /** Chave do catálogo (pt-BR); o nome gravado é o traduzido no idioma do navegador. */
  readonly name: string;
  readonly icon: string;
  readonly color: RoomColor;
}

export const STARTER_ROOMS: readonly StarterRoom[] = [
  { id: "kitchen", name: "Cozinha", icon: "fork.knife", color: "orange" },
  { id: "bathroom", name: "Banheiro", icon: "shower.fill", color: "cyan" },
  { id: "livingRoom", name: "Sala", icon: "sofa.fill", color: "indigo" },
  { id: "bedroom", name: "Quarto", icon: "bed.double.fill", color: "purple" },
  { id: "laundry", name: "Lavanderia", icon: "washer.fill", color: "teal" },
  { id: "outdoor", name: "Área externa", icon: "tree.fill", color: "green" },
];

export const SUGGESTED_TASKS_PER_ROOM = 2;

export interface StarterTask { readonly name: string; readonly details: string; readonly effort: number }

function isStarterTask(value: unknown): value is StarterTask {
  return typeof value === "object" && value !== null
    && typeof Reflect.get(value, "name") === "string" && typeof Reflect.get(value, "details") === "string"
    && typeof Reflect.get(value, "effort") === "number";
}

export function starterTasks(category: RoomCategory): StarterTask[] {
  const list: unknown = Reflect.get(suggestions, category);
  return (Array.isArray(list) ? list.filter(isStarterTask) : []).slice(0, SUGGESTED_TASKS_PER_ROOM);
}
