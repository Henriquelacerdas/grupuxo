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
    if ((await inbox.claim(message.wamid, message.receivedAt)) !== "claimed") return;

    // Antes do vínculo e do Gemini, para um número que exagera não gerar consulta, chamada ao modelo nem resposta.
    // Mensagem barrada conta como processada (não vai para nova tentativa nem DLQ); só a primeira da janela é avisada.
    // Limitação conhecida: uma nova tentativa depois de falha conta de novo na janela.
    const decision = await rateLimiter.check(message.phoneE164, now());
    if (decision !== "allowed") {
      if (decision === "limitedFirst") await sender.send(WhatsAppWorker.rateLimitedReply, message.phoneE164);
      await inbox.markProcessed(message.wamid, now());
      return;
    }

    let reply: string;
    const linkReply = await linker.handle(message);
    if (linkReply !== null) {
      reply = linkReply;
    } else {
      const link = await links.linkForPhone(message.phoneE164);
      reply = link !== null ? await responder.reply(message.text, link.userID) : WhatsAppWorker.unlinkedReply;
    }
    await sender.send(reply, message.phoneE164);
    await inbox.markProcessed(message.wamid, now());
  }
}
