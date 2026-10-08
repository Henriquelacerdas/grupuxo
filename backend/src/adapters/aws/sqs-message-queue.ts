import type { IncomingMessage } from "../../whatsapp/incoming-message.ts";
import type { MessageQueue } from "../../whatsapp/ports.ts";
import { LambdaConfigError } from "../../lambdas/config.ts";
import type { SqsClient } from "./clients.ts";

// `MessageQueue` sobre uma fila SQS FIFO. `MessageGroupId` = telefone (ordem por morador) e
// `MessageDeduplicationId` = `wamid`. Nenhuma mensagem de erro carrega o texto, o telefone, o `wamid`, a URL da
// fila nem a mensagem do erro original.

export type MessageQueueErrorCode =
  /** `wamid` ou telefone não servem de ID do SQS FIFO: nada foi enviado. */
  | "invalidMessage"
  /** O cliente falhou (rede, permissão, limite, fila inexistente...). */
  | "sendFailed";

const QUEUE_ERROR_MESSAGES: Readonly<Record<MessageQueueErrorCode, string>> = {
  invalidMessage: "Mensagem inválida para a fila",
  sendFailed: "Falha ao enfileirar a mensagem",
};

export class MessageQueueError extends Error {
  readonly code: MessageQueueErrorCode;
  /** `name` do erro original (por exemplo `ThrottlingException`), sem a mensagem. `null` se não houver. */
  readonly causeName: string | null;

  constructor(code: MessageQueueErrorCode, causeName: string | null = null) {
    super(QUEUE_ERROR_MESSAGES[code]);
    this.name = "MessageQueueError";
    this.code = code;
    this.causeName = causeName;
  }
}

// Até 128 caracteres: alfanuméricos e pontuação ASCII (regra de `MessageGroupId` e `MessageDeduplicationId`).
const FIFO_ID_PATTERN = /^[A-Za-z0-9!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]{1,128}$/;

export interface SqsMessageQueueOptions {
  readonly client: SqsClient;
  /** URL da fila FIFO (variável de ambiente da Lambda `webhook`). Sem valor, a fila não é criada. */
  readonly queueURL: string | undefined;
}

export class SqsMessageQueue implements MessageQueue {
  private readonly client: SqsClient;
  private readonly queueURL: string;

  constructor(options: SqsMessageQueueOptions) {
    if (options.queueURL === undefined || options.queueURL === "") throw new LambdaConfigError("QUEUE_URL", "missing");
    this.client = options.client;
    this.queueURL = options.queueURL;
  }

  async enqueue(message: IncomingMessage): Promise<void> {
    if (!FIFO_ID_PATTERN.test(message.phoneE164) || !FIFO_ID_PATTERN.test(message.wamid)) {
      throw new MessageQueueError("invalidMessage");
    }
    // Campos explícitos: o corpo é exatamente o que `parseIncomingMessage` lê no worker.
    const body = JSON.stringify({
      wamid: message.wamid, phoneE164: message.phoneE164, text: message.text, receivedAt: message.receivedAt,
    });
    try {
      await this.client.sendMessage({
        queueURL: this.queueURL, body, messageGroupID: message.phoneE164, messageDeduplicationID: message.wamid,
      });
    } catch (error) {
      throw new MessageQueueError("sendFailed", error instanceof Error ? error.name : null);
    }
  }
}
