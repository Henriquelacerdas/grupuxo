import type { Room } from "../domain/entities.ts";
import { compareIDs } from "../domain/ids.ts";
import type { TaskRange } from "../domain/use-cases/tasks.ts";
import type { GeminiFunctionDeclaration } from "./gemini-client.ts";

// Ferramentas de leitura expostas ao Gemini. Nenhuma declaração tem parâmetro de usuário ou de casa: o
// `GeminiMessageResponder` injeta os dois a partir do vínculo do número. Tudo o que o modelo devolve (nome da
// ferramenta e argumentos) é entrada não confiável e passa por `parseToolCall`.

export const LIST_MY_TASKS = "list_my_tasks";
export const LIST_ROOM_TASKS = "list_room_tasks";
export const LIST_SPORADIC_TASKS = "list_sporadic_tasks";

export const READ_ONLY_FUNCTIONS: readonly GeminiFunctionDeclaration[] = [
  {
    name: LIST_MY_TASKS,
    description: "Lista as tarefas do próprio morador que enviou a mensagem.",
    parameters: {
      type: "OBJECT",
      properties: {
        range: {
          type: "STRING",
          description: "`week` para as tarefas da semana atual (padrão); `all` para todas as que já estão disponíveis.",
          enum: ["week", "all"],
        },
      },
      required: ["range"],
    },
  },
  {
    name: LIST_ROOM_TASKS,
    description: "Lista as tarefas de um cômodo da casa.",
    parameters: {
      type: "OBJECT",
      properties: {
        room_name: { type: "STRING", description: "Nome do cômodo, como o morador escreveu (por exemplo: cozinha)." },
      },
      required: ["room_name"],
    },
  },
  {
    name: LIST_SPORADIC_TASKS,
    description: "Lista as tarefas avulsas (esporádicas) da casa, que qualquer morador elegível pode assumir.",
  },
];

export type ToolInvocation =
  | { readonly tool: typeof LIST_MY_TASKS; readonly range: TaskRange }
  | { readonly tool: typeof LIST_ROOM_TASKS; readonly roomName: string }
  | { readonly tool: typeof LIST_SPORADIC_TASKS };

/** Motivos fixos (sem eco do que o modelo mandou): voltam ao modelo como dado quando ele pode corrigir a chamada. */
export type ToolProblem = "unknown_tool" | "invalid_range" | "invalid_room_name";

export type ToolParseResult =
  | { readonly ok: true; readonly invocation: ToolInvocation }
  | { readonly ok: false; readonly problem: ToolProblem };

export const MAX_ROOM_NAME_CHARS = 80;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function argument(args: unknown, name: string): unknown {
  return isRecord(args) && Object.hasOwn(args, name) ? args[name] : undefined;
}

/**
 * Valida a chamada pedida pelo modelo. Só os parâmetros declarados são lidos: qualquer outro argumento (por
 * exemplo um `user_id` inventado) é ignorado, então o modelo não tem como escolher o morador nem a casa.
 */
export function parseToolCall(name: string, args: unknown): ToolParseResult {
  switch (name) {
    case LIST_MY_TASKS: {
      const range = argument(args, "range");
      if (range === undefined) return { ok: true, invocation: { tool: LIST_MY_TASKS, range: "week" } };
      if (range === "week" || range === "all") return { ok: true, invocation: { tool: LIST_MY_TASKS, range } };
      return { ok: false, problem: "invalid_range" };
    }
    case LIST_ROOM_TASKS: {
      const roomName = argument(args, "room_name");
      if (typeof roomName !== "string") return { ok: false, problem: "invalid_room_name" };
      const trimmedName = roomName.trim();
      if (trimmedName === "" || Array.from(trimmedName).length > MAX_ROOM_NAME_CHARS) return { ok: false, problem: "invalid_room_name" };
      return { ok: true, invocation: { tool: LIST_ROOM_TASKS, roomName: trimmedName } };
    }
    case LIST_SPORADIC_TASKS:
      return { ok: true, invocation: { tool: LIST_SPORADIC_TASKS } };
    default:
      return { ok: false, problem: "unknown_tool" };
  }
}

/** Chave estável da chamada, para não responder duas vezes à mesma consulta. */
export function invocationKey(invocation: ToolInvocation): string {
  switch (invocation.tool) {
    case LIST_MY_TASKS:
      return `${LIST_MY_TASKS}:${invocation.range}`;
    case LIST_ROOM_TASKS:
      return `${LIST_ROOM_TASKS}:${normalizeRoomName(invocation.roomName)}`;
    case LIST_SPORADIC_TASKS:
      return LIST_SPORADIC_TASKS;
  }
}

const LEADING_ARTICLE = /^(a|o|as|os|da|do|das|dos|na|no|nas|nos)\s+/;

/** Minúsculas, sem acentos nem espaços repetidos, sem artigo inicial: "A Cozinha " e "cozinha" são o mesmo cômodo. */
export function normalizeRoomName(name: string): string {
  const folded = name.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
  const stripped = folded.replace(LEADING_ARTICLE, "");
  return stripped === "" ? folded : stripped;
}

export type RoomResolution =
  | { readonly kind: "found"; readonly room: Room }
  | { readonly kind: "notFound" }
  /** Vários cômodos de nomes diferentes combinam com o pedido: melhor perguntar do que escolher um. */
  | { readonly kind: "ambiguous"; readonly rooms: readonly Room[] };

const MIN_PARTIAL_MATCH_CHARS = 3;

/**
 * Resolve o nome pedido contra os cômodos que o morador já enxerga (`rooms` vem do repositório, com a
 * visibilidade aplicada). Primeiro igualdade normalizada; depois um nome que contém o outro. Cômodos com o
 * mesmo nome normalizado são desempatados pelo menor ID; nomes diferentes na busca parcial são ambíguos.
 */
export function resolveRoom(rooms: readonly Room[], requestedName: string): RoomResolution {
  const wanted = normalizeRoomName(requestedName);
  if (wanted === "") return { kind: "notFound" };
  const byID = [...rooms].sort((a, b) => compareIDs(a.id, b.id));
  const exact = byID.filter((room) => normalizeRoomName(room.name) === wanted);
  const [firstExact] = exact;
  if (firstExact !== undefined) return { kind: "found", room: firstExact };
  if (wanted.length < MIN_PARTIAL_MATCH_CHARS) return { kind: "notFound" };
  const partial = byID.filter((room) => {
    const name = normalizeRoomName(room.name);
    return name.length >= MIN_PARTIAL_MATCH_CHARS && (name.includes(wanted) || wanted.includes(name));
  });
  const [firstPartial] = partial;
  if (firstPartial === undefined) return { kind: "notFound" };
  const distinctNames = new Set(partial.map((room) => normalizeRoomName(room.name)));
  return distinctNames.size === 1 ? { kind: "found", room: firstPartial } : { kind: "ambiguous", rooms: partial };
}
