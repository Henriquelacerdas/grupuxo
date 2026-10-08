import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  clearSecrets, dryRunHttp, out, parseCli, recording, registerSecret, runMain, safeScalar, scrub, setOutput, shapeOf,
  UsageError,
} from "./common.ts";
import { buildGeminiHandlers, GEMINI_ITEMS } from "./gemini.ts";
import { buildGraphHandlers, GRAPH_ITEMS } from "./graph.ts";

// Roda com `node --test tools/validate/` (fora do `npm test`). Nenhum teste toca a rede: tudo usa `--dry-run`.

const lines: string[] = [];
let restore: ((line: string) => void) | undefined;

beforeEach(() => {
  lines.length = 0;
  restore = setOutput((line) => lines.push(line));
});

afterEach(() => {
  if (restore !== undefined) setOutput(restore);
  clearSecrets();
});

describe("saída segura", () => {
  it("apaga segredos registrados e sequências longas de dígitos", () => {
    registerSecret("tok_ABC123xyz");
    assert.equal(scrub("Bearer tok_ABC123xyz para +5511999998888 e 5511999998888"), "Bearer [segredo] para [dígitos] e [dígitos]");
    out("Authorization: tok_ABC123xyz");
    assert.deepEqual(lines, ["Authorization: [segredo]"]);
  });

  it("shapeOf mostra chaves e tipos, nunca o valor de uma string", () => {
    const shape = shapeOf({ contacts: [{ input: "+5511999998888", wa_id: "5511999998888" }], messages: [{ id: "wamid.SEGREDO" }], code: 190, ok: true });
    assert.equal(shape, "{contacts:[{input:string,wa_id:string}]x1,messages:[{id:string}]x1,code:190,ok:true}");
    assert.ok(!shape.includes("wamid"));
  });

  it("safeScalar só deixa passar identificadores", () => {
    assert.equal(safeScalar("API_KEY_INVALID"), "API_KEY_INVALID");
    assert.equal(safeScalar("Mensagem com espaços e dados"), "<string>");
    assert.equal(safeScalar(undefined), "<ausente>");
  });
});

describe("linha de comando", () => {
  const known = { A1: "um", A2: "dois" };

  it("recusa rodar sem item explícito", () => {
    assert.throws(() => parseCli([], known), UsageError);
    assert.throws(() => parseCli(["--dry-run"], known), UsageError);
  });

  it("recusa argumento desconhecido e aceita --list sem item", () => {
    assert.throws(() => parseCli(["tudo"], known), UsageError);
    assert.deepEqual(parseCli(["--list"], known), { items: [], dryRun: false, list: true });
  });

  it("não repete itens", () => {
    assert.deepEqual(parseCli(["A1", "A1", "A2", "--dry-run"], known).items, ["A1", "A2"]);
  });

  it("variável ausente cita só o nome", async () => {
    const saved = process.env["WHATSAPP_TOKEN"];
    delete process.env["WHATSAPP_TOKEN"];
    try {
      const code = await runMain(["G1"], GRAPH_ITEMS, (dryRun) => buildGraphHandlers(dryRun));
      assert.equal(code, 1);
      assert.ok(lines.some((line) => line.includes("ausente") && line.includes("WHATSAPP_")));
    } finally {
      if (saved !== undefined) process.env["WHATSAPP_TOKEN"] = saved;
    }
  });
});

describe("--dry-run (sem rede)", () => {
  it("exercita todos os itens da Graph sem vazar telefone nem token", async () => {
    const rec = recording(dryRunHttp());
    const code = await runMain([...Object.keys(GRAPH_ITEMS), "--dry-run"], GRAPH_ITEMS, (dryRun) => buildGraphHandlers(dryRun, rec));
    const text = lines.join("\n");
    assert.equal(code, 0, text);
    assert.ok(rec.calls() >= 15);
    for (const forbidden of ["15550000001", "5511999998888", "dry-run-token", "123456789012345"]) assert.ok(!text.includes(forbidden), forbidden);
    assert.ok(text.includes("G3b 4097 cru] status=400"), "4097 caracteres deve ser recusado pelo falso");
    assert.ok(text.includes("G6a token inválido] status=401"));
    assert.ok(text.includes("Meta inseriu o 9") || text.includes("igual ao enviado"));
  });

  it("exercita todos os itens do Gemini sem vazar a chave", async () => {
    const rec = recording(dryRunHttp());
    const code = await runMain([...Object.keys(GEMINI_ITEMS), "--dry-run"], GEMINI_ITEMS, (dryRun) => buildGeminiHandlers(dryRun, rec));
    const text = lines.join("\n");
    assert.equal(code, 0, text);
    assert.ok(!text.includes("dry-run-key"));
    assert.ok(text.includes("[M1e-a chave inválida] status=400") && text.includes("API_KEY_INVALID"));
    assert.ok(text.includes("[M1e-b modelo inexistente] status=404"));
    assert.ok(text.includes("list_my_tasks{range=week} parse=ok id=true thoughtSignature=true"));
    assert.ok(!text.includes("abc"), "o valor do argumento do prompt de injeção não pode aparecer");
  });
});
