import { describe, expect, it } from "vitest";
import catalog from "@/lib/shared/task-suggestions.json";
import { suggestionsCatalog } from "../scripts/shared-source";

describe("catálogo compartilhado", () => {
  it("a cópia do web é igual ao catálogo do domínio (rode npm run shared:sync)", () => {
    expect(catalog).toEqual(suggestionsCatalog());
  });
});
