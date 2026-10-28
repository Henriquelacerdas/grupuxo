import { measure, noLatency, recordAge, type LatencyObserver } from "../latency.ts";
import type { Instant } from "../domain/dates.ts";
import type { IncomingMessage } from "./incoming-message.ts";
import type { WhatsAppLinker } from "./linking/whatsapp-linker.ts";
import type { InboxStore, MessageResponder, WhatsAppLinkStore, WhatsAppSender } from "./ports.ts";
import type { MessageRateLimiter } from "./rate-limit.ts";

export interface WhatsAppWorkerDependencies {
  readonly inbox: InboxStore;
  readonly links: WhatsAppLinkStore;
  readonly linker: Pick<WhatsAppLinker, "handle">;
  readonly responder: MessageResponder;
  readonly sender: WhatsAppSender;
  /** Limite de mensagens por número (BACKEND.md 7.3). Obrigatório: não existe worker sem controle de custo. */
  readonly rateLimiter: Pick<MessageRateLimiter, "check">;
  readonly now: () => Instant;
  readonly latency?: LatencyObserver;
}

/**
 * Lógica da Lambda `whatsapp-worker`, uma mensagem por vez (o SQS FIFO garante a ordem por telefone). Erros são
 * propagados: o SQS tenta de novo e, esgotadas as tentativas, envia para a DLQ. Não persiste o texto da mensagem
 * nem o registra em log: só `wamid` e horários vão para a caixa de entrada.
 */
export class WhatsAppWorker {
  static readonly unlinkedReply =
    "Não encontrei seu número no Grupuxo. Abra o app, vá em Perfil e toque em Conectar WhatsApp.";
  static readonly rateLimitedReply = "Você está enviando mensagens rápido demais. Espere um pouco e tente de novo.";

  private readonly deps: WhatsAppWorkerDependencies;

  constructor(deps: WhatsAppWorkerDependencies) {
    this.deps = deps;
  }

  async process(message: IncomingMessage): Promise<void> {
    const { inbox, links, linker, responder, sender, rateLimiter, now } = this.deps;
    const latency = this.deps.latency ?? noLatency;
    if ((await measure(latency, "claimMs", () => inbox.claim(message.wamid, message.receivedAt))) !== "claimed") {
      latency.outcome("duplicate");
      return;
    }

    // Antes do vínculo e do Gemini, para um número que exagera não gerar consulta, chamada ao modelo nem resposta.
    // Mensagem barrada conta como processada (não vai para nova tentativa nem DLQ); só a primeira da janela é avisada.
    // Limitação conhecida: uma nova tentativa depois de falha conta de novo na janela.
    const decision = await measure(latency, "rateLimitMs", () => rateLimiter.check(message.phoneE164, now()));
    if (decision !== "allowed") {
      if (decision === "limitedFirst") {
        await sender.send(WhatsAppWorker.rateLimitedReply, message.phoneE164);
        recordAge(latency, "sourceToGraphMs", now(), message.receivedAt);
      }
      await measure(latency, "markProcessedMs", () => inbox.markProcessed(message.wamid, now()));
      latency.outcome("limited");
      return;
    }

    let reply: string;
    const linkReply = await measure(latency, "linkMs", () => linker.handle(message));
    if (linkReply !== null) {
      reply = linkReply;
    } else {
      const link = await measure(latency, "linkMs", () => links.linkForPhone(message.phoneE164));
      reply = link !== null ? await measure(latency, "responderMs", () => responder.reply(message.text, link.userID, { wamid: message.wamid })) : WhatsAppWorker.unlinkedReply;
    }
    await sender.send(reply, message.phoneE164);
    recordAge(latency, "sourceToGraphMs", now(), message.receivedAt);
    await measure(latency, "markProcessedMs", () => inbox.markProcessed(message.wamid, now()));
    latency.outcome("success");
  }
}
