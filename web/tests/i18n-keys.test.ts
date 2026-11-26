import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "@/i18n/catalog.en.json";
import { WEB_EN } from "@/i18n/web-strings";
import { format, pickLocale } from "@/i18n/messages";

// Todo texto literal passado a `t("…")` precisa de tradução em inglês: no catálogo do app ou nos textos do web.

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const KEY = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;

describe("i18n", () => {
  it("todo t(\"…\") tem inglês", () => {
    const english: Record<string, unknown> = { ...en, ...WEB_EN };
    const missing = new Set<string>();
    for (const file of files(join(__dirname, "..", "src"))) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(KEY)) {
        const key = JSON.parse(`"${match[1] ?? ""}"`) as string;
        if (!(key in english)) missing.add(`${key}  (${file.split("/src/")[1]})`);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it("formata argumentos e plurais", () => {
    expect(format("pt-BR", { "Termina {0}": "Termina {0}" }, "Termina {0}", ["domingo"])).toBe("Termina domingo");
    const plural = { "{0} tarefas": { plural: 0, one: "{0} task", other: "{0} tasks" } };
    expect(format("en", plural, "{0} tarefas", [1])).toBe("1 task");
    expect(format("en", plural, "{0} tarefas", [3])).toBe("3 tasks");
  });

  it("escolhe o idioma pelo navegador", () => {
    expect(pickLocale("pt-PT,pt;q=0.9")).toBe("pt-BR");
    expect(pickLocale("en-US")).toBe("en");
    expect(pickLocale("fr-FR")).toBe("en");
    expect(pickLocale(null)).toBe("pt-BR");
  });
});
