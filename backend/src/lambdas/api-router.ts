// Tabela de rotas da `api` (BACKEND.md, seção 6.1). Caminho com parâmetro só casa se o parâmetro for um UUID em
// minúsculo (estreitamento escrito à mão): ID malformado é igual a rota que não existe (404), nunca chega ao domínio.

export type Method = "GET" | "POST" | "DELETE";

export type RouteName =
  | "registerAccount" | "issueWhatsAppLink" | "whatsAppStatus" | "unlinkWhatsApp"
  | "myHouse" | "leaveHouse" | "createHouse" | "joinHouse"
  | "createRoom" | "roomParticipation" | "addRoomMember" | "removeRoomMember"
  | "myTasks" | "roomTasks" | "createTask" | "taskDefinition" | "endTask"
  | "completeOccurrence" | "reopenOccurrence";

/** Rotas de conta e de WhatsApp (tratadas em `api.ts`); as demais são de casa, cômodo, tarefa e ocorrência. */
export type AccountRouteName = "registerAccount" | "issueWhatsAppLink" | "whatsAppStatus" | "unlinkWhatsApp";
export type AppRouteName = Exclude<RouteName, AccountRouteName>;

export type RouteParam = "houseID" | "roomID" | "userID" | "taskID" | "occurrenceID";

type Segment = string | { readonly param: RouteParam };

interface RouteDefinition {
  readonly name: RouteName;
  readonly method: Method;
  readonly pattern: readonly Segment[];
}

const param = (name: RouteParam): Segment => ({ param: name });

/** A ordem importa só para o cabeçalho `allow` do 405 (métodos na ordem desta tabela). */
const ROUTES: readonly RouteDefinition[] = [
  { name: "registerAccount", method: "POST", pattern: ["me"] },
  { name: "issueWhatsAppLink", method: "POST", pattern: ["me", "whatsapp", "link"] },
  { name: "whatsAppStatus", method: "GET", pattern: ["me", "whatsapp"] },
  { name: "unlinkWhatsApp", method: "DELETE", pattern: ["me", "whatsapp"] },
  { name: "myHouse", method: "GET", pattern: ["me", "house"] },
  { name: "leaveHouse", method: "DELETE", pattern: ["me", "house"] },
  { name: "myTasks", method: "GET", pattern: ["me", "tasks"] },
  { name: "createHouse", method: "POST", pattern: ["houses"] },
  { name: "joinHouse", method: "POST", pattern: ["houses", "join"] },
  { name: "createRoom", method: "POST", pattern: ["houses", param("houseID"), "rooms"] },
  { name: "roomParticipation", method: "GET", pattern: ["rooms", param("roomID")] },
  { name: "addRoomMember", method: "POST", pattern: ["rooms", param("roomID"), "members"] },
  { name: "removeRoomMember", method: "DELETE", pattern: ["rooms", param("roomID"), "members", param("userID")] },
  { name: "roomTasks", method: "GET", pattern: ["rooms", param("roomID"), "tasks"] },
  { name: "createTask", method: "POST", pattern: ["rooms", param("roomID"), "tasks"] },
  { name: "taskDefinition", method: "GET", pattern: ["rooms", param("roomID"), "tasks", param("taskID")] },
  { name: "endTask", method: "POST", pattern: ["rooms", param("roomID"), "tasks", param("taskID"), "end"] },
  { name: "completeOccurrence", method: "POST", pattern: ["occurrences", param("occurrenceID"), "complete"] },
  { name: "reopenOccurrence", method: "POST", pattern: ["occurrences", param("occurrenceID"), "reopen"] },
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type RouteParams = Readonly<Partial<Record<RouteParam, string>>>;

export type RouteMatch =
  | { readonly kind: "found"; readonly name: RouteName; readonly params: RouteParams }
  | { readonly kind: "methodNotAllowed"; readonly allow: readonly Method[] }
  | { readonly kind: "notFound" };

function matchPattern(pattern: readonly Segment[], segments: readonly string[]): RouteParams | null {
  if (pattern.length !== segments.length) return null;
  const params: Partial<Record<RouteParam, string>> = {};
  for (const [index, expected] of pattern.entries()) {
    const actual = segments[index];
    if (actual === undefined) return null;
    if (typeof expected === "string") {
      if (actual !== expected) return null;
    } else if (UUID.test(actual)) {
      params[expected.param] = actual;
    } else {
      return null;
    }
  }
  return params;
}

/** Casa método e caminho (`rawPath`) com a tabela. O método é comparado em maiúsculas. */
export function matchRoute(method: string, path: string): RouteMatch {
  const parts = path.split("/");
  const [root, version, ...segments] = parts;
  if (root !== "" || version !== "v1" || segments.length === 0 || segments.some((segment) => segment === "")) {
    return { kind: "notFound" };
  }
  const upper = method.toUpperCase();
  const allow: Method[] = [];
  for (const route of ROUTES) {
    const params = matchPattern(route.pattern, segments);
    if (params === null) continue;
    if (route.method === upper) return { kind: "found", name: route.name, params };
    allow.push(route.method);
  }
  return allow.length === 0 ? { kind: "notFound" } : { kind: "methodNotAllowed", allow };
}

/** Parâmetro do caminho; só falta se a tabela e o tratamento da rota divergirem (erro de programação → 500). */
export function requireParam(params: RouteParams, name: RouteParam): string {
  const value = params[name];
  if (value === undefined) throw new Error(`parâmetro de rota ausente: ${name}`);
  return value;
}
