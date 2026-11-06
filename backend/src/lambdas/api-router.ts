// Tabela de rotas da `api` (BACKEND.md, seção 6.1). Caminho com parâmetro só casa se o parâmetro for um UUID em
// minúsculo (estreitamento escrito à mão): ID malformado é igual a rota que não existe (404), nunca chega ao domínio.

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type RouteName =
  | "registerAccount" | "myAccount" | "updateAccount" | "deleteAccount" | "requestPhotoUpload" | "confirmPhoto" | "deletePhoto" | "registerDevice" | "removeDevice" | "getPreferences" | "setPreferences" | "issueWhatsAppLink" | "whatsAppStatus" | "unlinkWhatsApp"
  | "houseSnapshot" | "myHouse" | "leaveHouse" | "createHouse" | "joinHouse" | "renameHouse"
  | "myVacation" | "startVacation" | "endVacation" | "myPendingRatings" | "myRatingSummary" | "rateRoom"
  | "createRoom" | "roomParticipation" | "updateRoom" | "deleteRoom" | "addRoomMember" | "removeRoomMember"
  | "myRoomAccessRequests" | "roomAccessRequests" | "requestRoomAccess" | "cancelRoomAccess" | "approveRoomAccess" | "denyRoomAccess"
  | "myTasks" | "roomTasks" | "createTask" | "taskDefinition" | "updateTask" | "deleteTask" | "endTask"
  | "completeOccurrence" | "reopenOccurrence"
  | "mySporadicTasks" | "claimOccurrence" | "releaseOccurrence"
  | "swapCandidates" | "createSwap" | "mySwaps" | "acceptSwap" | "rejectSwap" | "cancelSwap"
  | "myNotifications" | "readNotification";

/** Rotas de conta e de WhatsApp (tratadas em `api.ts`); as demais são de casa, cômodo, tarefa e ocorrência. */
export type AccountRouteName =
  | "registerDevice" | "removeDevice" | "getPreferences" | "setPreferences"
  | "registerAccount" | "myAccount" | "updateAccount" | "deleteAccount" | "requestPhotoUpload" | "confirmPhoto" | "deletePhoto" | "issueWhatsAppLink" | "whatsAppStatus" | "unlinkWhatsApp";
export type AppRouteName = Exclude<RouteName, AccountRouteName>;

export type RouteParam = "houseID" | "roomID" | "userID" | "taskID" | "occurrenceID" | "swapID" | "notificationID";

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
  { name: "myAccount", method: "GET", pattern: ["me"] },
  { name: "updateAccount", method: "PATCH", pattern: ["me"] },
  { name: "requestPhotoUpload", method: "POST", pattern: ["me", "photo"] },
  { name: "confirmPhoto", method: "PUT", pattern: ["me", "photo"] },
  { name: "deletePhoto", method: "DELETE", pattern: ["me", "photo"] },
  { name: "registerDevice", method: "PUT", pattern: ["me", "devices"] },
  { name: "removeDevice", method: "DELETE", pattern: ["me", "devices"] },
  { name: "getPreferences", method: "GET", pattern: ["me", "notification-preferences"] },
  { name: "setPreferences", method: "PUT", pattern: ["me", "notification-preferences"] },
  { name: "deleteAccount", method: "DELETE", pattern: ["me"] },
  { name: "issueWhatsAppLink", method: "POST", pattern: ["me", "whatsapp", "link"] },
  { name: "whatsAppStatus", method: "GET", pattern: ["me", "whatsapp"] },
  { name: "unlinkWhatsApp", method: "DELETE", pattern: ["me", "whatsapp"] },
  { name: "houseSnapshot", method: "GET", pattern: ["me", "house", "snapshot"] },
  { name: "myHouse", method: "GET", pattern: ["me", "house"] },
  { name: "leaveHouse", method: "DELETE", pattern: ["me", "house"] },
  { name: "myTasks", method: "GET", pattern: ["me", "tasks"] },
  { name: "myVacation", method: "GET", pattern: ["me", "vacation"] },
  { name: "myPendingRatings", method: "GET", pattern: ["me", "ratings", "pending"] },
  { name: "myRatingSummary", method: "GET", pattern: ["me", "ratings", "summary"] },
  { name: "startVacation", method: "PUT", pattern: ["me", "vacation"] },
  { name: "endVacation", method: "DELETE", pattern: ["me", "vacation"] },
  { name: "createHouse", method: "POST", pattern: ["houses"] },
  { name: "joinHouse", method: "POST", pattern: ["houses", "join"] },
  { name: "renameHouse", method: "PATCH", pattern: ["houses", param("houseID")] },
  { name: "createRoom", method: "POST", pattern: ["houses", param("houseID"), "rooms"] },
  { name: "roomParticipation", method: "GET", pattern: ["rooms", param("roomID")] },
  { name: "rateRoom", method: "POST", pattern: ["rooms", param("roomID"), "ratings"] },
  { name: "updateRoom", method: "PATCH", pattern: ["rooms", param("roomID")] },
  { name: "deleteRoom", method: "DELETE", pattern: ["rooms", param("roomID")] },
  { name: "myRoomAccessRequests", method: "GET", pattern: ["me", "room-access-requests"] },
  { name: "roomAccessRequests", method: "GET", pattern: ["rooms", param("roomID"), "access-requests"] },
  { name: "requestRoomAccess", method: "POST", pattern: ["rooms", param("roomID"), "access-requests"] },
  { name: "cancelRoomAccess", method: "DELETE", pattern: ["rooms", param("roomID"), "access-requests"] },
  { name: "approveRoomAccess", method: "POST", pattern: ["rooms", param("roomID"), "access-requests", param("userID"), "approve"] },
  { name: "denyRoomAccess", method: "POST", pattern: ["rooms", param("roomID"), "access-requests", param("userID"), "deny"] },
  { name: "addRoomMember", method: "POST", pattern: ["rooms", param("roomID"), "members"] },
  { name: "removeRoomMember", method: "DELETE", pattern: ["rooms", param("roomID"), "members", param("userID")] },
  { name: "roomTasks", method: "GET", pattern: ["rooms", param("roomID"), "tasks"] },
  { name: "createTask", method: "POST", pattern: ["rooms", param("roomID"), "tasks"] },
  { name: "taskDefinition", method: "GET", pattern: ["rooms", param("roomID"), "tasks", param("taskID")] },
  { name: "updateTask", method: "PATCH", pattern: ["rooms", param("roomID"), "tasks", param("taskID")] },
  { name: "deleteTask", method: "DELETE", pattern: ["rooms", param("roomID"), "tasks", param("taskID")] },
  { name: "endTask", method: "POST", pattern: ["rooms", param("roomID"), "tasks", param("taskID"), "end"] },
  { name: "completeOccurrence", method: "POST", pattern: ["occurrences", param("occurrenceID"), "complete"] },
  { name: "reopenOccurrence", method: "POST", pattern: ["occurrences", param("occurrenceID"), "reopen"] },
  { name: "mySporadicTasks", method: "GET", pattern: ["me", "sporadic-tasks"] },
  { name: "claimOccurrence", method: "POST", pattern: ["occurrences", param("occurrenceID"), "claim"] },
  { name: "releaseOccurrence", method: "POST", pattern: ["occurrences", param("occurrenceID"), "release"] },
  { name: "swapCandidates", method: "GET", pattern: ["occurrences", param("occurrenceID"), "swap-candidates"] },
  { name: "createSwap", method: "POST", pattern: ["swaps"] },
  { name: "mySwaps", method: "GET", pattern: ["me", "swaps"] },
  { name: "acceptSwap", method: "POST", pattern: ["swaps", param("swapID"), "accept"] },
  { name: "rejectSwap", method: "POST", pattern: ["swaps", param("swapID"), "reject"] },
  { name: "cancelSwap", method: "POST", pattern: ["swaps", param("swapID"), "cancel"] },
  { name: "myNotifications", method: "GET", pattern: ["me", "notifications"] },
  { name: "readNotification", method: "POST", pattern: ["notifications", param("notificationID"), "read"] },
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
