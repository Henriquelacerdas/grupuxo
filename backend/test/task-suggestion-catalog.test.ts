import assert from "node:assert/strict";
import { test } from "node:test";
import { TaskSuggestionCatalog } from "../src/domain/services/task-suggestion-catalog.ts";
import type { RoomCategory } from "../src/domain/value-objects.ts";

const categories: readonly RoomCategory[] = [
  "kitchen",
  "bathroom",
  "bedroom",
  "livingRoom",
  "laundry",
  "office",
  "outdoor",
  "other",
];

test("cada categoria tem pelo menos dez sugestões, sem ids nem nomes repetidos", () => {
  const catalog = new TaskSuggestionCatalog();
  for (const category of categories) {
    const items = catalog.suggestions(category);
    assert.ok(items.length >= 10, `${category} tem ${items.length}`);
    assert.equal(new Set(items.map((item) => item.id)).size, items.length, category);
    assert.equal(new Set(items.map((item) => item.name)).size, items.length, category);
    for (const item of items) assert.ok(item.id.startsWith(`${category}.`), item.id);
  }
});
