import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

// O service worker gerado (public/sw.js) roda num contexto falso: o push vira notificação com a frase do catálogo.
type Listener = (event: { data?: { json(): unknown }; waitUntil(p: Promise<unknown>): void; notification?: unknown }) => void;

function worker(language: string) {
  const listeners = new Map<string, Listener>();
  const shown: { title: string; options: { body: string; data: { url: string } } }[] = [];
  const self = {
    navigator: { language },
    location: { origin: "https://reveza.test" },
    addEventListener: (name: string, listener: Listener) => listeners.set(name, listener),
    registration: { showNotification: async (title: string, options: { body: string; data: { url: string } }) => { shown.push({ title, options }); } },
    skipWaiting: () => undefined,
    clients: { claim: async () => undefined },
  };
  runInNewContext(readFileSync(join(__dirname, "..", "public", "sw.js"), "utf8"), { self, URL });
  const push = async (payload: unknown) => {
    const pending: Promise<unknown>[] = [];
    listeners.get("push")?.({ data: { json: () => payload }, waitUntil: (p) => pending.push(p) });
    await Promise.all(pending);
  };
  return { push, shown };
}

describe("service worker", () => {
  it("monta a frase pela chave e argumentos, no idioma do navegador", async () => {
    const pt = worker("pt-BR");
    await pt.push({ kind: "taskEdited", key: "push.taskEdited", args: ["Ana", "Lavar a louça"], url: "/app/notifications" });
    expect(pt.shown[0]?.options.body).toBe("Ana editou a tarefa Lavar a louça.");
    const en = worker("en-US");
    await en.push({ kind: "taskEdited", args: ["Lavar a louça"] });
    expect(en.shown[0]?.options.body).toBe("The task Lavar a louça was edited.");
  });

  it("resumo diário no singular e plural", async () => {
    const sw = worker("pt-BR");
    await sw.push({ kind: "dailyTasks", args: [1], url: "/app/tasks" });
    await sw.push({ kind: "dailyTasks", args: [3], url: "/app/tasks" });
    expect(sw.shown.map((n) => n.options.body)).toEqual(["Você tem 1 tarefa pendente", "Você tem 3 tarefas pendentes"]);
    expect(sw.shown[0]?.options.data.url).toBe("/app/tasks");
  });

  it("ignora tipo desconhecido e não abre URL de fora", async () => {
    const sw = worker("pt-BR");
    await sw.push({ kind: "inventado", args: [] });
    await sw.push({ kind: "weeklySummaryReady", args: [], url: "https://evil.example/x" });
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0]?.options.data.url).toBe("/app/notifications");
  });
});
