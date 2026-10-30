import { fileURLToPath } from "node:url";
import { ICE_BREAKERS, iceBreakerProblems } from "../../src/assistant/ice-breakers.ts";
import {
  at, dryRunHttp, fetchHttp, field, isRecord, out, parseJson, rawRequest, readEnv, recording, runMain, safeScalar,
  shapeOf, UsageError, type Handlers, type Recorded, type Recording,
} from "../validate/common.ts";

// Quebra-gelos do número do bot (docs/WHATSAPP-MENSAGENS.md). Uso: `node tools/whatsapp-config/ice-breakers.ts show|apply
// [--dry-run]`. `apply` altera a configuração do número real e exige autorização explícita do dono do projeto.
// Token e PHONE_NUMBER_ID nunca são impressos (ver `../validate/common.ts`).

export const ICE_BREAKER_ITEMS: Readonly<Record<string, string>> = {
  show: "lê os quebra-gelos configurados no número [1 GET, sem alteração]",
  apply: "grava ICE_BREAKERS (src/assistant/ice-breakers.ts) no número e confere com um GET [1 POST + 1 GET, ALTERA o número]",
};

interface Context {
  readonly rec: Recording;
  readonly version: string;
  readonly phoneNumberID: string;
  readonly token: string;
}

function authorization(ctx: Context): Readonly<Record<string, string>> {
  return { authorization: `Bearer ${ctx.token}` };
}

function graphError(recorded: Recorded): string {
  const error = field(parseJson(recorded.body), "error");
  return `type=${safeScalar(field(error, "type"))} code=${safeScalar(field(error, "code"))} error_subcode=${safeScalar(field(error, "error_subcode"))}`;
}

function failed(label: string, recorded: Recorded | null): boolean {
  if (recorded === null) {
    out(`[${label}] sem resposta HTTP`);
    return true;
  }
  out(`[${label}] status=${recorded.status} ms=${recorded.ms}${recorded.status >= 400 ? ` ${graphError(recorded)}` : ""}`);
  return recorded.status >= 400;
}

/** Quebra-gelos de uma resposta de `GET /<PHONE_NUMBER_ID>?fields=conversational_automation`; `null` se a forma não bate. */
export function configuredPrompts(body: string): string[] | null {
  const automation = field(parseJson(body), "conversational_automation");
  if (automation === undefined) return [];
  if (!isRecord(automation)) return null;
  const prompts = field(automation, "prompts");
  if (prompts === undefined) return [];
  if (!Array.isArray(prompts)) return null;
  const list: readonly unknown[] = prompts;
  const strings = list.filter((prompt): prompt is string => typeof prompt === "string");
  return strings.length === list.length ? strings : null;
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

async function show(ctx: Context, label: string): Promise<string[] | null> {
  const url = `https://graph.facebook.com/${ctx.version}/${ctx.phoneNumberID}?fields=conversational_automation`;
  const recorded = await rawRequest(ctx.rec, "GET", url, authorization(ctx));
  if (failed(label, recorded) || recorded === null) return null;
  const prompts = configuredPrompts(recorded.body);
  if (prompts === null) {
    out(`[${label}] resposta inesperada: ${shapeOf(parseJson(recorded.body))}`);
    return null;
  }
  // Os quebra-gelos são texto público do bot, não dado de morador: podem aparecer na saída.
  out(`[${label}] ${prompts.length} quebra-gelo(s) configurado(s)${prompts.length === 0 ? "" : ":"}`);
  for (const prompt of prompts) out(`  - ${prompt}`);
  out(`[${label}] igual a ICE_BREAKERS: ${sameList(prompts, ICE_BREAKERS) ? "sim" : "não"}`);
  return prompts;
}

export function buildIceBreakerHandlers(dryRun: boolean, rec: Recording | undefined = undefined): Handlers {
  const ctx: Context = {
    rec: rec ?? recording(dryRun ? dryRunHttp() : fetchHttp),
    version: readEnv("WHATSAPP_GRAPH_VERSION", dryRun, "v25.0", { secret: false }),
    phoneNumberID: readEnv("PHONE_NUMBER_ID", dryRun, "123456789012345", { secret: true }),
    token: readEnv("WHATSAPP_TOKEN", dryRun, "dry-run-token", { secret: true }),
  };
  out(`Graph ${ctx.version}`);

  return {
    show: async () => {
      await show(ctx, "show");
    },

    apply: async () => {
      const problems = iceBreakerProblems(ICE_BREAKERS);
      if (problems.length > 0) throw new UsageError(`ICE_BREAKERS fora dos limites da Meta: ${problems.join("; ")}`);
      const url = `https://graph.facebook.com/${ctx.version}/${ctx.phoneNumberID}/conversational_automation`;
      const recorded = await rawRequest(ctx.rec, "POST", url, authorization(ctx), { prompts: ICE_BREAKERS });
      if (failed("apply", recorded) || recorded === null) return;
      out(`[apply] success=${safeScalar(at(parseJson(recorded.body), "success"))}`);
      const after = await show(ctx, "apply: conferência");
      if (after !== null && !sameList(after, ICE_BREAKERS)) out("[apply] ATENÇÃO: a configuração lida não bate com ICE_BREAKERS");
      out("[apply] confira no aparelho: os quebra-gelos aparecem ao abrir uma conversa nova com o número");
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runMain(process.argv.slice(2), ICE_BREAKER_ITEMS, (dryRun) => buildIceBreakerHandlers(dryRun));
}
