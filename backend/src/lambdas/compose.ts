import { HttpGeminiClient } from "../assistant/gemini-client.ts";
import { GeminiMessageResponder, type GeminiMessageResponderDependencies } from "../assistant/gemini-responder.ts";
import { CognitoJwtVerifier, cognitoJwksURL } from "../auth/cognito-jwt-verifier.ts";
import { HttpJwksSource } from "../auth/jwks.ts";
import type { Instant } from "../domain/dates.ts";
import type { HttpFetch } from "../http.ts";
import { GraphWhatsAppSender } from "../whatsapp/graph-sender.ts";
import type { WhatsAppLinker } from "../whatsapp/linking/whatsapp-linker.ts";
import type { InboxStore, RateCounter, WhatsAppLinkStore } from "../whatsapp/ports.ts";
import { MessageRateLimiter } from "../whatsapp/rate-limit.ts";
import { WhatsAppWorker } from "../whatsapp/worker.ts";
import type { ApiSettings, WorkerSecrets, WorkerSettings } from "./config.ts";

// Funções de composição: montam os objetos reais a partir de configuração já lida e dependências injetadas.
// Não leem `process.env`, não conhecem AWS e não escolhem o armazenamento (inbox, vínculos e contador entram
// por port).

export interface WorkerCompositionDependencies {
  readonly settings: WorkerSettings;
  readonly secrets: WorkerSecrets;
  readonly http: HttpFetch;
  readonly now: () => Instant;
  readonly inbox: InboxStore;
  readonly links: WhatsAppLinkStore;
  readonly linker: Pick<WhatsAppLinker, "handle">;
  readonly rateCounter: RateCounter;
  /** Casos de uso e repositórios de leitura do domínio que o assistente consulta. */
  readonly assistant: Omit<GeminiMessageResponderDependencies, "gemini" | "now">;
}

/**
 * `WhatsAppWorker` definitivo: `GeminiMessageResponder` + `GraphWhatsAppSender` + limite de taxa. Falha fechada se
 * `GEMINI_MODEL`, a versão da Graph API ou qualquer segredo estiver ausente ou inválido (lança na criação).
 */
export function composeWhatsAppWorker(deps: WorkerCompositionDependencies): WhatsAppWorker {
  const { settings, secrets, http, now } = deps;
  const gemini = new HttpGeminiClient({ apiKey: secrets.geminiApiKey, model: settings.geminiModel, http });
  const sender = new GraphWhatsAppSender({
    accessToken: secrets.whatsappToken, phoneNumberID: secrets.phoneNumberID, apiVersion: settings.graphVersion, http,
  });
  return new WhatsAppWorker({
    inbox: deps.inbox,
    links: deps.links,
    linker: deps.linker,
    responder: new GeminiMessageResponder({ ...deps.assistant, gemini, now }),
    sender,
    rateLimiter: new MessageRateLimiter({ counter: deps.rateCounter, ...settings.rateLimit }),
    now,
  });
}

/** Verificador do access token do Cognito, com as chaves buscadas por HTTPS (`HttpJwksSource`, com cache). */
export function composeCognitoVerifier(settings: ApiSettings, http: HttpFetch, now: () => Instant): CognitoJwtVerifier {
  return new CognitoJwtVerifier(settings.cognito, { jwks: new HttpJwksSource(cognitoJwksURL(settings.cognito.userPoolID), http), now });
}
