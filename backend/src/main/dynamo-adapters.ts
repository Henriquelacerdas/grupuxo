import type { DynamoClient } from "../adapters/dynamodb/client.ts";
import { HouseStateStore } from "../adapters/dynamodb/house-state-store.ts";
import { DynamoPendingActionStore } from "../adapters/dynamodb/pending-action-store.ts";
import { DynamoRateCounter } from "../adapters/dynamodb/rate-counter.ts";
import { DynamoHouseRepository, DynamoRoomRepository, DynamoTaskRepository } from "../adapters/dynamodb/repositories.ts";
import { DynamoUserDirectory } from "../adapters/dynamodb/user-directory.ts";
import { DynamoInboxStore, DynamoLinkTokenStore, DynamoWhatsAppLinkStore } from "../adapters/dynamodb/whatsapp-stores.ts";
import type { CommandContext } from "../domain/commands/context.ts";
import { WhatsAppLinker, type LinkConfig } from "../whatsapp/linking/whatsapp-linker.ts";
import { dynamoRuntime, newAccessCode, newID, now } from "./runtime.ts";

// Retenções de TTL (só limpeza; a validade é decidida por condição). Valores da PLANO.md, T3.1.
const DAY_SECONDS = 24 * 60 * 60;
export const INBOX_RETENTION_SECONDS = 7 * DAY_SECONDS;
export const RATE_COUNTER_EXTRA_SECONDS = 5 * 60;
export const LINK_TOKEN_GRACE_SECONDS = 60 * 60;
export const PENDING_ACTION_GRACE_SECONDS = 60 * 60;

/** Adaptadores DynamoDB do domínio sobre o mesmo store, com a escrita acima de 100 ações dividida (atalho da trilha). */
export function houseAdapters(client: DynamoClient) {
  const ctx: CommandContext = { now, newID };
  const store = new HouseStateStore(client, dynamoRuntime, { oversizedWrites: "split" });
  return {
    store,
    houses: new DynamoHouseRepository(store, client, ctx, newAccessCode),
    rooms: new DynamoRoomRepository(store, ctx),
    tasks: new DynamoTaskRepository(store, ctx),
  };
}

/** Vínculo do WhatsApp: tokens de uso único e os itens `PHONE#`/`USER#…/WHATSAPP`. */
export function linkAdapters(client: DynamoClient, link: LinkConfig) {
  const links = new DynamoWhatsAppLinkStore({ client });
  const tokens = new DynamoLinkTokenStore({ client, graceSeconds: LINK_TOKEN_GRACE_SECONDS });
  return { links, linker: new WhatsAppLinker(link, tokens, links, now) };
}

export function whatsAppStores(client: DynamoClient, rateWindowSeconds: number) {
  return {
    inbox: new DynamoInboxStore({ client, retentionSeconds: INBOX_RETENTION_SECONDS }),
    rateCounter: new DynamoRateCounter({ client, retentionSeconds: rateWindowSeconds + RATE_COUNTER_EXTRA_SECONDS }),
    pending: new DynamoPendingActionStore({ client, graceSeconds: PENDING_ACTION_GRACE_SECONDS }),
  };
}

export function userDirectory(client: DynamoClient): DynamoUserDirectory {
  return new DynamoUserDirectory({ client, newID, now });
}
