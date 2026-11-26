import { expect, type Page } from "@playwright/test";

export const API = "http://127.0.0.1:4010";
export const CODE = "123456";
export const PASSWORD = "Reveza!2026";

let counter = 0;
/** E-mail único por execução (o servidor local guarda tudo em memória até o reset). */
export function email(name: string): string {
  counter += 1;
  return `${name}.${Date.now()}.${counter}@example.com`;
}

export async function resetServer(): Promise<void> {
  const response = await fetch(`${API}/__test/reset`, { method: "POST" });
  expect(response.ok).toBe(true);
}

export async function advanceClock(ms: number): Promise<void> {
  const response = await fetch(`${API}/__test/clock`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ advanceMs: ms }) });
  expect(response.ok).toBe(true);
}

export async function runScheduled(): Promise<void> {
  const response = await fetch(`${API}/__test/scheduled`, { method: "POST" });
  expect(response.ok).toBe(true);
}

export const DAY = 24 * 3600 * 1000;

/** Marca as Boas-vindas como vistas, para os testes irem direto ao que importa. */
export async function skipWelcome(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { localStorage.setItem("reveza.hasSeenWelcome", "1"); } catch { /* sem armazenamento */ }
  });
}
