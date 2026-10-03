import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("../", import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

test("o domínio é puro: sem node:*, sem relógio nem aleatoriedade globais", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(join(root, "src/domain"))) {
    const text = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const forbidden = [/from\s+["']node:/, /\bDate\.now\s*\(/, /new Date\(\s*\)/, /Math\.random/, /randomUUID/, /\bprocess\./, /\bfetch\s*\(/];
    for (const pattern of forbidden) if (pattern.test(text)) offenders.push(`${file}: ${String(pattern)}`);
  }
  assert.deepEqual(offenders, []);
});

test("o backend não tem dependências de runtime", () => {
  const manifest: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(typeof manifest === "object" && manifest !== null);
  assert.ok(!("dependencies" in manifest), "package.json não deve ter `dependencies`");
});

test("a camada WhatsApp não importa o agendamento nem regras de negócio do domínio", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(join(root, "src/whatsapp"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/from\s+"(\.\.?\/[^"]*domain\/[^"]*)"/g)) {
      const target = match[1] ?? "";
      if (!/domain\/(ids|dates)\.ts$/.test(target)) offenders.push(`${file}: ${target}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("nenhum arquivo do código registra conteúdo em log", () => {
  const offenders = sourceFiles(join(root, "src")).filter((file) => /\bconsole\./.test(readFileSync(file, "utf8")));
  assert.deepEqual(offenders, []);
});
