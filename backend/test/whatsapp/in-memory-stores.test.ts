import { InMemoryRateCounter } from "../../src/adapters/in-memory/rate-counter.ts";
import {
  InMemoryInboxStore, InMemoryLinkTokenStore, InMemoryWhatsAppLinkStore,
} from "../../src/adapters/in-memory/whatsapp.ts";
import { rateCounterContract } from "../contract/rate-counter.ts";
import { inboxStoreContract, linkTokenStoreContract, whatsAppLinkStoreContract } from "../contract/stores.ts";

inboxStoreContract("em memória", () => new InMemoryInboxStore());
whatsAppLinkStoreContract("em memória", () => new InMemoryWhatsAppLinkStore());
linkTokenStoreContract("em memória", () => new InMemoryLinkTokenStore());
rateCounterContract("em memória", () => new InMemoryRateCounter());
