import { fileURLToPath } from "node:url";
import { GraphSendError, GraphWhatsAppSender } from "../../src/whatsapp/graph-sender.ts";
import {
  at, dryRunHttp, errorName, fetchHttp, field, isRecord, out, parseJson, rawRequest, readEnv, recording,
  runMain, safeScalar, shapeOf, UsageError, type Handlers, type Recorded, type Recording,
} from "./common.ts";

// Validação da Graph API (VALIDACAO-APIS-REAIS.md, seção 1). Uso: `node tools/validate/graph.ts G1 G3 [--dry-run]`.
// Cada item envia mensagens reais ao número de teste e exige autorização. Texto de mensagem, telefone e token nunca
// são impressos (ver `common.ts`).

export const GRAPH_ITEMS: Readonly<Record<string, string>> = {
  G1: "formato do `to`: com + (sender) e sem + (cru) [2 mensagens]",
  G2: "nono dígito brasileiro: formas com e sem o 9 de VALIDATE_WA_BR_NUMBER [2 mensagens]",
  G3: "limite do text.body: 4096 (sender), 4097 (cru), 4097 (sender, corta), 4096 emojis (cru) [4 mensagens]",
  G4: "recipient_type: com e sem o campo (cru) [2 mensagens]",
  G5: "versão da Graph API aceita e cabeçalho facebook-api-version [1 GET, sem mensagem]",
  G6a: "erro: token inválido [1 requisição, sem mensagem]",
  G6b: "erro: PHONE_NUMBER_ID inexistente [1 requisição, sem mensagem]",
  G6c: "erro: `to` malformado (cru) [1 requisição, sem mensagem]",
  G6d: "erro: fora da janela de 24 h, VALIDATE_WA_OUT_OF_WINDOW_TO [1 requisição]",
  G6e: "erro: número sem WhatsApp, VALIDATE_WA_NOT_ON_WHATSAPP_TO [1 requisição]",
  G7: "corpo da resposta de sucesso do sender [1 mensagem]",
};

interface Context {
  readonly rec: Recording;
  readonly version: string;
  readonly phoneNumberID: string;
  readonly token: string;
  readonly to: () => string;
}

const TEXT_TIMEOUT_MS = 30_000;

function digitsOf(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Texto de exatamente `length` pontos de código: prefixo fixo e preenchimento neutro. */
function fillerText(prefix: string, length: number, filler: string): string {
  const prefixLength = [...prefix].length;
  return `${prefix}${filler.repeat(Math.max(0, length - prefixLength))}`;
}

function sender(ctx: Context, overrides: { readonly token?: string; readonly phoneNumberID?: string } = {}): GraphWhatsAppSender {
  return new GraphWhatsAppSender({
    accessToken: overrides.token ?? ctx.token,
    phoneNumberID: overrides.phoneNumberID ?? ctx.phoneNumberID,
    apiVersion: ctx.version,
    http: ctx.rec.http,
    timeoutMs: TEXT_TIMEOUT_MS,
  });
}

function graphErrorSummary(body: string): string {
  const parsed = parseJson(body);
  const error = field(parsed, "error");
  if (!isRecord(error)) return `corpo sem "error": ${shapeOf(parsed)}`;
  const keys = Object.keys(error).join(",");
  return `type=${safeScalar(field(error, "type"))} code=${safeScalar(field(error, "code"))} error_subcode=${safeScalar(field(error, "error_subcode"))} keys=[${keys}]`;
}

/** 4xx (exceto 429) é permanente: repetir não adianta. 429 e 5xx valem nova tentativa. */
function retryHint(status: number): string {
  if (status === 429 || status >= 500) return "transitório (vale repetir)";
  if (status >= 400) return "permanente (repetir não adianta)";
  return "sucesso";
}

function describe(label: string, recorded: Recorded | null): void {
  if (recorded === null) {
    out(`[${label}] sem resposta HTTP`);
    return;
  }
  const detail = recorded.status >= 400 ? ` ${graphErrorSummary(recorded.body)} → ${retryHint(recorded.status)}` : "";
  out(`[${label}] status=${recorded.status} ms=${recorded.ms}${detail}`);
}

/** `wa_id` devolvido × dígitos enviados, sem imprimir nenhum dos dois. */
function waIdRelation(sentDigits: string, body: string): string {
  const waId = at(parseJson(body), "contacts", 0, "wa_id");
  if (typeof waId !== "string") return "ausente";
  if (waId === sentDigits) return "igual ao enviado";
  if (sentDigits.startsWith("55") && sentDigits.length === 12 && waId === `${sentDigits.slice(0, 4)}9${sentDigits.slice(4)}`) {
    return "Meta inseriu o 9";
  }
  if (sentDigits.startsWith("55") && sentDigits.length === 13 && waId === `${sentDigits.slice(0, 4)}${sentDigits.slice(5)}`) {
    return "Meta removeu o 9";
  }
  return `outro (${sentDigits.length} → ${waId.length} dígitos)`;
}

async function viaSender(ctx: Context, label: string, client: GraphWhatsAppSender, to: string, text: string): Promise<Recorded | null> {
  ctx.rec.reset();
  try {
    await client.send(text, to);
  } catch (error) {
    if (error instanceof GraphSendError) out(`[${label}] sender lançou: code=${error.code} status=${error.status ?? "-"}`);
    else out(`[${label}] erro inesperado (${errorName(error)})`);
  }
  const recorded = ctx.rec.last();
  describe(label, recorded);
  return recorded;
}

function messagesUrl(ctx: Context, phoneNumberID: string = ctx.phoneNumberID): string {
  return `https://graph.facebook.com/${ctx.version}/${phoneNumberID}/messages`;
}

function authorization(ctx: Context): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${ctx.token}` };
}

function messageBody(to: string, text: string, recipientType: boolean): Readonly<Record<string, unknown>> {
  return {
    messaging_product: "whatsapp",
    ...(recipientType ? { recipient_type: "individual" } : {}),
    to,
    type: "text",
    text: { body: text },
  };
}

// Bypass deliberado do sender: ele recusa estes formatos antes de chamar a rede, e é justamente a resposta da Graph
// a eles que queremos conhecer.
async function viaRaw(ctx: Context, label: string, body: Readonly<Record<string, unknown>>): Promise<Recorded | null> {
  const recorded = await rawRequest(ctx.rec, "POST", messagesUrl(ctx), authorization(ctx), body);
  describe(label, recorded);
  return recorded;
}

function succeeded(recorded: Recorded | null): boolean {
  return recorded !== null && recorded.status >= 200 && recorded.status < 300;
}

export function buildGraphHandlers(dryRun: boolean, rec: Recording | undefined = undefined): Handlers {
  const recorder = rec ?? recording(dryRun ? dryRunHttp() : fetchHttp);
  const ctx: Context = {
    rec: recorder,
    version: readEnv("WHATSAPP_GRAPH_VERSION", dryRun, "v25.0", { secret: false }),
    phoneNumberID: readEnv("PHONE_NUMBER_ID", dryRun, "123456789012345", { secret: true }),
    token: readEnv("WHATSAPP_TOKEN", dryRun, "dry-run-token", { secret: true }),
    to: () => readEnv("VALIDATE_WA_TO", dryRun, "+15550000001", { secret: true }),
  };
  out(`Graph ${ctx.version}`);

  return {
    G1: async () => {
      const to = ctx.to();
      const withPlus = await viaSender(ctx, "G1a com +", sender(ctx), to, "[validacao G1a] to com +");
      if (withPlus !== null) out(`[G1a] wa_id: ${waIdRelation(digitsOf(to), withPlus.body)}`);
      const withoutPlus = await viaRaw(ctx, "G1b sem +", messageBody(digitsOf(to), "[validacao G1b] to sem +", true));
      if (withoutPlus !== null) out(`[G1b] wa_id: ${waIdRelation(digitsOf(to), withoutPlus.body)}`);
      out(`[G1] conclusão: ${succeeded(withPlus) && succeeded(withoutPlus) ? "as duas formas foram aceitas" : "as formas diferem (veja os status acima)"}`);
      out("[G1] confira no aparelho de teste se chegaram as mensagens G1a e G1b");
    },

    G2: async () => {
      const number = readEnv("VALIDATE_WA_BR_NUMBER", dryRun, "+5511999998888", { secret: true });
      const digits = digitsOf(number);
      if (!/^55[0-9]{2}9?[0-9]{8}$/.test(digits)) throw new UsageError("VALIDATE_WA_BR_NUMBER deve ser um celular brasileiro (+55, DDD, 8 ou 9 dígitos)");
      const base = digits.length === 13 ? `${digits.slice(0, 4)}${digits.slice(5)}` : digits;
      const forms = [
        { label: "G2a sem o 9", digits: base },
        { label: "G2b com o 9", digits: `${base.slice(0, 4)}9${base.slice(4)}` },
      ];
      for (const form of forms) {
        const recorded = await viaSender(ctx, form.label, sender(ctx), `+${form.digits}`, `[validacao ${form.label.slice(0, 3)}]`);
        if (recorded !== null && succeeded(recorded)) out(`[${form.label}] wa_id: ${waIdRelation(form.digits, recorded.body)}`);
      }
      out("[G2] só cobre o envio (to → wa_id). O `from` recebido sem o 9 depende do webhook (G8, depois do deploy)");
    },

    G3: async () => {
      const to = ctx.to();
      const exact = fillerText("[validacao G3a] ", 4096, "a");
      await viaSender(ctx, "G3a 4096 pelo sender", sender(ctx), to, exact);
      await viaRaw(ctx, "G3b 4097 cru", messageBody(to, fillerText("[validacao G3b] ", 4097, "a"), true));
      await viaSender(ctx, "G3c 4097 pelo sender (deve cortar em 4096)", sender(ctx), to, fillerText("[validacao G3c] ", 4097, "a"));
      await viaRaw(ctx, "G3d 4096 emojis cru (pontos de código ≠ unidades UTF-16)", messageBody(to, "😀".repeat(4096), true));
      out("[G3] conclusão: a=aceito e b=recusado confirma 4096; d aceito confirma que o limite conta pontos de código, não UTF-16");
    },

    G4: async () => {
      const to = ctx.to();
      await viaRaw(ctx, "G4a com recipient_type", messageBody(to, "[validacao G4a] com recipient_type", true));
      await viaRaw(ctx, "G4b sem recipient_type", messageBody(to, "[validacao G4b] sem recipient_type", false));
    },

    G5: async () => {
      const recorded = await rawRequest(ctx.rec, "GET", `https://graph.facebook.com/${ctx.version}/${ctx.phoneNumberID}?fields=id`, authorization(ctx));
      describe("G5", recorded);
      if (recorded !== null) {
        out(`[G5] versão pedida=${ctx.version} cabeçalho facebook-api-version=${recorded.apiVersion === null ? "ausente" : safeScalar(recorded.apiVersion)}`);
        out(`[G5] forma: ${shapeOf(parseJson(recorded.body))}`);
      }
      out("[G5] a versão vigente na página de versões da Meta é conferida à parte, na documentação");
    },

    G6a: async () => {
      // Token fixo e inválido: nada do token real sai daqui.
      await viaSender(ctx, "G6a token inválido", sender(ctx, { token: "invalid" }), ctx.to(), "[validacao G6a]");
    },

    G6b: async () => {
      await viaSender(ctx, "G6b PHONE_NUMBER_ID inexistente", sender(ctx, { phoneNumberID: "100000000000001" }), ctx.to(), "[validacao G6b]");
    },

    G6c: async () => {
      await viaRaw(ctx, "G6c to malformado", messageBody("not-a-phone", "[validacao G6c]", true));
    },

    G6d: async () => {
      const to = readEnv("VALIDATE_WA_OUT_OF_WINDOW_TO", dryRun, "+15550000002", { secret: true });
      out("[G6d] o número deve estar FORA da janela de 24 h (sem mensagem recebida dele nas últimas 24 h)");
      await viaSender(ctx, "G6d fora da janela", sender(ctx), to, "[validacao G6d]");
    },

    G6e: async () => {
      const to = readEnv("VALIDATE_WA_NOT_ON_WHATSAPP_TO", dryRun, "+15550000003", { secret: true });
      await viaSender(ctx, "G6e número sem WhatsApp", sender(ctx), to, "[validacao G6e]");
    },

    G7: async () => {
      const recorded = await viaSender(ctx, "G7", sender(ctx), ctx.to(), "[validacao G7] resposta de sucesso");
      if (recorded === null) return;
      const parsed = parseJson(recorded.body);
      out(`[G7] forma: ${shapeOf(parsed)}`);
      const id = at(parsed, "messages", 0, "id");
      out(`[G7] messages[0].id presente=${typeof id === "string"} começa com wamid.=${typeof id === "string" && id.startsWith("wamid.")}`);
      out(`[G7] message_status=${safeScalar(at(parsed, "messages", 0, "message_status"))}`);
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runMain(process.argv.slice(2), GRAPH_ITEMS, (dryRun) => buildGraphHandlers(dryRun));
}
