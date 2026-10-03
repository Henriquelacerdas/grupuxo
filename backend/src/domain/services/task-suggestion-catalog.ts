import type { TaskSuggestion } from "../entities.ts";
import { taskEffort, type RoomCategory } from "../value-objects.ts";

/** Sugestões de tarefa por categoria de cômodo. */
const CATALOG: Readonly<Record<RoomCategory, readonly TaskSuggestion[]>> = {
  kitchen: [
    { id: "kitchen.cleanFloor", name: "Limpar o chão", details: "", effort: taskEffort(2) },
    { id: "kitchen.cleanSink", name: "Limpar a pia", details: "", effort: taskEffort(1) },
    { id: "kitchen.cleanStove", name: "Limpar o fogão", details: "", effort: taskEffort(2) },
    { id: "kitchen.organizeFridge", name: "Organizar a geladeira", details: "", effort: taskEffort(3) },
  ],
  bathroom: [
    { id: "bathroom.cleanToilet", name: "Limpar o vaso sanitário", details: "", effort: taskEffort(2) },
    { id: "bathroom.cleanSink", name: "Limpar a pia", details: "", effort: taskEffort(1) },
    { id: "bathroom.cleanMirror", name: "Limpar o espelho", details: "", effort: taskEffort(1) },
    { id: "bathroom.cleanShower", name: "Lavar o box", details: "", effort: taskEffort(3) },
  ],
  bedroom: [
    { id: "bedroom.changeSheets", name: "Trocar roupa de cama", details: "", effort: taskEffort(2) },
    { id: "bedroom.cleanFloor", name: "Limpar o chão", details: "", effort: taskEffort(2) },
    { id: "bedroom.dust", name: "Tirar o pó", details: "", effort: taskEffort(1) },
    { id: "bedroom.organizeWardrobe", name: "Organizar o guarda-roupa", details: "", effort: taskEffort(3) },
  ],
  livingRoom: [
    { id: "livingRoom.vacuum", name: "Aspirar o chão", details: "", effort: taskEffort(2) },
    { id: "livingRoom.dust", name: "Tirar o pó", details: "", effort: taskEffort(1) },
    { id: "livingRoom.cleanFurniture", name: "Limpar os móveis", details: "", effort: taskEffort(2) },
  ],
  laundry: [
    { id: "laundry.washClothes", name: "Lavar roupas", details: "", effort: taskEffort(2) },
    { id: "laundry.cleanFloor", name: "Limpar o chão", details: "", effort: taskEffort(2) },
    { id: "laundry.organizeProducts", name: "Organizar produtos de limpeza", details: "", effort: taskEffort(1) },
  ],
  office: [
    { id: "office.dust", name: "Tirar o pó", details: "", effort: taskEffort(1) },
    { id: "office.organizeDesk", name: "Organizar a mesa", details: "", effort: taskEffort(1) },
    { id: "office.cleanFloor", name: "Limpar o chão", details: "", effort: taskEffort(2) },
  ],
  outdoor: [
    { id: "outdoor.sweep", name: "Varrer a área", details: "", effort: taskEffort(2) },
    { id: "outdoor.organize", name: "Organizar a área", details: "", effort: taskEffort(2) },
  ],
  other: [],
};

export class TaskSuggestionCatalog {
  suggestions(category: RoomCategory): readonly TaskSuggestion[] {
    return CATALOG[category];
  }
}
