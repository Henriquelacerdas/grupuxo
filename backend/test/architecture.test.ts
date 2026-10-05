import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";

const root = new URL("../", import.meta.url).pathname;

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
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

function withoutComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Imports relativos de um arquivo, resolvidos para caminhos relativos a `src/` (ex.: `domain/ids.ts`). */
function srcImports(file: string): { specifier: string; target: string }[] {
  const text = withoutComments(readFileSync(file, "utf8"));
  return [...text.matchAll(/(?:from|import)\s+"(\.\.?\/[^"]*)"/g)].map((match) => {
    const specifier = match[1] ?? "";
    return { specifier, target: relative(join(root, "src"), resolve(dirname(file), specifier)) };
  });
}

// Camadas de `src/`: para cada pasta, o que ela pode importar (prefixos relativos a `src/`). O que não está
// na lista é proibido. `adapters` e `lambdas` são raízes de composição e podem importar tudo.
const layers: Record<string, readonly string[]> = {
  domain: ["domain/"],
  whatsapp: ["whatsapp/", "domain/ids.ts", "domain/dates.ts", "http.ts"],
  auth: ["auth/", "domain/ids.ts", "domain/dates.ts", "http.ts"],
  assistant: ["assistant/", "domain/", "whatsapp/ports.ts", "whatsapp/incoming-message.ts", "http.ts"],
};

test("cada camada de src/ só importa o que a arquitetura permite", () => {
  const offenders: string[] = [];
  for (const [layer, allowed] of Object.entries(layers)) {
    for (const file of sourceFiles(join(root, "src", layer))) {
      for (const { specifier, target } of srcImports(file)) {
        if (!allowed.some((prefix) => target === prefix || target.startsWith(prefix))) offenders.push(`${file}: ${specifier}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("auth, assistant e whatsapp usam relógio, aleatoriedade e rede só por injeção", () => {
  const offenders: string[] = [];
  const forbidden = [/\bDate\.now\s*\(/, /new Date\(\s*\)/, /Math\.random/, /randomUUID/, /\bprocess\./, /(?<![.\w])fetch\s*\(/, /globalThis/];
  for (const layer of ["auth", "assistant", "whatsapp"]) {
    for (const file of sourceFiles(join(root, "src", layer))) {
      const text = withoutComments(readFileSync(file, "utf8"));
      for (const pattern of forbidden) if (pattern.test(text)) offenders.push(`${file}: ${String(pattern)}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("as Lambdas são só composição: ambiente, relógio e rede entram por parâmetro", () => {
  // `process.env` e o Secrets Manager serão lidos num ponto de entrada fora de `src/lambdas/` (depende do empacotamento).
  const offenders: string[] = [];
  const forbidden = [/\bDate\.now\s*\(/, /new Date\(\s*\)/, /Math\.random/, /randomUUID/, /\bprocess\./, /(?<![.\w])fetch\s*\(/, /globalThis/, /from\s+["']node:/];
  for (const file of sourceFiles(join(root, "src/lambdas"))) {
    const text = withoutComments(readFileSync(file, "utf8"));
    for (const pattern of forbidden) if (pattern.test(text)) offenders.push(`${file}: ${String(pattern)}`);
  }
  assert.deepEqual(offenders, []);
});

test("o assistente não usa node:* (só o domínio e os ports)", () => {
  const offenders = sourceFiles(join(root, "src/assistant")).filter((file) => /from\s+["']node:/.test(withoutComments(readFileSync(file, "utf8"))));
  assert.deepEqual(offenders, []);
});

test("nada no código usa any, @ts-ignore ou @ts-expect-error", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(join(root, "src"))) {
    const text = withoutComments(readFileSync(file, "utf8"));
    if (/:\s*any\b|<any>|\bas any\b|any\[\]/.test(text)) offenders.push(`${file}: any`);
    if (/@ts-(ignore|expect-error|nocheck)/.test(readFileSync(file, "utf8"))) offenders.push(`${file}: @ts-*`);
  }
  assert.deepEqual(offenders, []);
});
