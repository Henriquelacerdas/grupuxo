import type { Instant } from "../../domain/dates.ts";

// Chaves e prefixos do modelo de itens (docs/BACKEND.md seção 4). Único lugar que monta ou desmonta chaves.

export const GSI1 = "GSI1";

export const META_SK = "META";
export const PROFILE_SK = "PROFILE";
export const WHATSAPP_USER_SK = "WHATSAPP";
export const PHONE_LINK_SK = "LINK";
export const LINK_TOKEN_SK = "LINKTOKEN";
export const INBOX_SK = "INBOX";
export const COGNITO_SK = "COGNITO";
export const ACCESS_CODE_SK = "ACCESSCODE";
export const PENDING_SK = "COMPLETE";

/** Prefixos de `SK` dentro da partição `HOUSE#<id>`. */
export const SK_PREFIX = {
  membership: "MEMBER#",
  room: "ROOM#",
  roomMembership: "ROOMMEMBER#",
  definition: "TASKDEF#",
  occurrence: "OCC#",
  assignment: "ASSIGN#",
  swap: "SWAP#",
  notification: "NOTIF#",
  absence: "ABSENCE#",
} as const;

export const housePK = (houseID: string): string => `HOUSE#${houseID}`;
export const userPK = (userID: string): string => `USER#${userID}`;
export const phonePK = (phoneE164: string): string => `PHONE#${phoneE164}`;
export const cognitoPK = (sub: string): string => `COGNITO#${sub}`;
export const accessCodePK = (code: string): string => `ACCESSCODE#${code}`;
export const linkTokenPK = (tokenHash: string): string => `LINKTOKEN#${tokenHash}`;
export const inboxPK = (wamid: string): string => `WAMID#${wamid}`;
export const ratePK = (key: string): string => `RATE#${key}`;
export const pendingPK = (userID: string): string => `PENDING#${userID}`;

/** `GSI1SK` das notificações: ordem cronológica por `createdAt` (16 dígitos) e depois pelo ID. */
export function notificationGSISK(createdAt: Instant, id: string): string {
  return `${SK_PREFIX.notification}${String(createdAt).padStart(16, "0")}#${id}`;
}

/** O ID de uma entidade da casa é o que vem depois do prefixo do `SK`. */
export function idFromSK(sk: string, prefix: string): string {
  return sk.slice(prefix.length);
}

/** Casa de uma entidade pelo ID (`GSI1PK` = `ROOM#`/`OCC#`/`SWAP#<id>`, `GSI1SK` = `HOUSE#<houseId>`). */
export const lookupPK = {
  room: (id: string): string => `ROOM#${id}`,
  occurrence: (id: string): string => `OCC#${id}`,
  swap: (id: string): string => `SWAP#${id}`,
} as const;

/** TTL em segundos da época Unix, a partir de um instante em milissegundos mais uma retenção em segundos. */
export function ttlSeconds(instant: Instant, retentionSeconds: number): number {
  return Math.floor(instant / 1000) + retentionSeconds;
}
