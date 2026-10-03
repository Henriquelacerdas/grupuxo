import {
  InMemoryInboxStore, InMemoryLinkTokenStore, InMemoryWhatsAppLinkStore,
} from "../../src/adapters/in-memory/whatsapp.ts";
import { inboxStoreContract, linkTokenStoreContract, whatsAppLinkStoreContract } from "../contract/stores.ts";

inboxStoreContract("em memória", () => new InMemoryInboxStore());
whatsAppLinkStoreContract("em memória", () => new InMemoryWhatsAppLinkStore());
linkTokenStoreContract("em memória", () => new InMemoryLinkTokenStore());
