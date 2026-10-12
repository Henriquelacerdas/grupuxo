import { isCompleted, type TaskItem } from "../domain/entities.ts";
import { compareIDs } from "../domain/ids.ts";
import { normalizeRoomName } from "./read-tools.ts";

// Resolução do pedido de conclusão e leitura do "sim/não". Tudo por código: o modelo só informa o nome que o
// morador citou, e a resposta à confirmação nunca passa por ele.

export type TaskResolution =
  | { readonly kind: "found"; readonly item: TaskItem }
  | { readonly kind: "notFound" }
  /** Várias tarefas de nomes diferentes combinam com o pedido: melhor perguntar do que escolher uma. */
  | { readonly kind: "ambiguous"; readonly items: readonly TaskItem[] };

const MIN_PARTIAL_MATCH_CHARS = 3;

/** Prazo mais próximo primeiro (sem prazo por último), depois o menor ID: desempate explícito, sem ordem de `Map`. */
function byDeadlineThenID(a: TaskItem, b: TaskItem): number {
  const left = a.occurrence.dueAt;
  const right = b.occurrence.dueAt;
  if (left !== right) {
    if (left === null) return 1;
    if (right === null) return -1;
    return left - right;
  }
  return compareIDs(a.occurrence.id, b.occurrence.id);
}

/**
 * Resolve o nome citado contra as tarefas **pendentes do próprio morador** (as concluídas são ignoradas). Primeiro
 * igualdade normalizada; depois um nome que contém o outro. Ocorrências com o mesmo nome (por exemplo, a atrasada
 * e a da semana) resolvem para a de prazo mais próximo; nomes diferentes na busca parcial são ambíguos.
 */
export function resolveTask(items: readonly TaskItem[], requestedName: string): TaskResolution {
  const wanted = normalizeRoomName(requestedName);
  if (wanted === "") return { kind: "notFound" };
  const pending = items.filter((item) => !isCompleted(item.occurrence)).sort(byDeadlineThenID);
  const exact = pending.filter((item) => normalizeRoomName(item.definition.name) === wanted);
  const [firstExact] = exact;
  if (firstExact !== undefined) return { kind: "found", item: firstExact };
  if (wanted.length < MIN_PARTIAL_MATCH_CHARS) return { kind: "notFound" };
  const partial = pending.filter((item) => {
    const name = normalizeRoomName(item.definition.name);
    return name.length >= MIN_PARTIAL_MATCH_CHARS && (name.includes(wanted) || wanted.includes(name));
  });
  const [firstPartial] = partial;
  if (firstPartial === undefined) return { kind: "notFound" };
  const distinctNames = new Set(partial.map((item) => normalizeRoomName(item.definition.name)));
  return distinctNames.size === 1 ? { kind: "found", item: firstPartial } : { kind: "ambiguous", items: partial };
}

const YES = new Set(["sim", "s", "ss", "sip", "ok", "okay", "pode", "pode sim", "isso", "isso mesmo", "confirmo", "confirma", "confirmado", "claro", "yes", "y", "beleza"]);
const NO = new Set(["nao", "n", "nop", "nope", "cancela", "cancelar", "cancelado", "deixa pra la", "esquece", "no"]);

const YES_EMOJI = /^(?:👍|✅|👌)\p{Emoji_Modifier}?$/u;
const NO_EMOJI = /^(?:👎|❌)\p{Emoji_Modifier}?$/u;

/**
 * Lê a resposta à pergunta de confirmação. Só vale a mensagem **inteira** (depois de tirar acentos, caixa e
 * pontuação das pontas): "sim, mas me mostre as tarefas do Leo" não confirma nada.
 */
export function parseConfirmation(text: string): "yes" | "no" | null {
  const trimmed = text.trim();
  if (YES_EMOJI.test(trimmed)) return "yes";
  if (NO_EMOJI.test(trimmed)) return "no";
  const folded = trimmed
    .normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .replace(/\s+/g, " ");
  if (YES.has(folded)) return "yes";
  if (NO.has(folded)) return "no";
  return null;
}
