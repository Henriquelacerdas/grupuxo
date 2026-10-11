import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  clearSecrets, dryRunHttp, out, parseCli, recording, registerSecret, runMain, safeScalar, scrub, setOutput, shapeOf,
  UsageError, type Recorded,
} from "./common.ts";
import { buildGeminiHandlers, GEMINI_ITEMS } from "./gemini.ts";
import { buildGraphHandlers, g1Conclusion, GRAPH_ITEMS } from "./graph.ts";

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

describe("conclusão do G1", () => {
  const rejected = (code: number): Recorded => ({ status: 400, ms: 1, apiVersion: null, body: JSON.stringify({ error: { code, type: "OAuthException" } }) });
  const accepted: Recorded = { status: 200, ms: 1, apiVersion: null, body: "{}" };

  it("duas recusas iguais (ex.: 131030, fora da lista permitida) não concluem nada sobre o formato", () => {
    assert.match(g1Conclusion(rejected(131030), rejected(131030)), /^inconclusivo: .*mesmo erro/);
  });

  it("forma que nem chegou à rede deixa o resultado inconclusivo", () => {
    assert.match(g1Conclusion(null, rejected(131030)), /^inconclusivo: .*não chegou à rede/);
  });

  it("recusas por erros diferentes continuam inconclusivas", () => {
    assert.match(g1Conclusion(rejected(131030), rejected(100)), /^inconclusivo: .*erros diferentes/);
  });

  it("conclui só quando alguma forma foi aceita", () => {
    assert.equal(g1Conclusion(accepted, accepted), "as duas formas foram aceitas");
    assert.equal(g1Conclusion(accepted, rejected(100)), "só a forma com + foi aceita");
    assert.equal(g1Conclusion(rejected(100), accepted), "só a forma sem + foi aceita");
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
