import type { IncomingMessage } from "../../whatsapp/incoming-message.ts";
import type { MessageQueue } from "../../whatsapp/ports.ts";

export interface InProcessQueueOptions {
  /** Processa uma mensagem (o `WhatsAppWorker.process`). Lançar = tentar de novo. */
  readonly process: (message: IncomingMessage) => Promise<void>;
  /** Chamado quando as tentativas se esgotam e a mensagem é descartada. Nunca recebe o conteúdo. */
  readonly onDropped: () => void;
  /** Total de tentativas por mensagem (padrão 3, como o `maxReceiveCount` da fila SQS). */
  readonly attempts?: number;
  readonly retryDelayMs?: number;
}

const wait = (milliseconds: number): Promise<void> =>
  milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();

/**
 * Fila em processo no lugar do SQS FIFO: mensagens do mesmo telefone rodam em ordem, uma por vez; telefones
 * diferentes andam em paralelo. `enqueue` só agenda (o webhook responde 200 logo). Sem persistência: uma
 * queda do processo no meio perde as mensagens pendentes (a Meta reentrega as que não receberam 200).
 */
export class InProcessMessageQueue implements MessageQueue {
  private readonly options: InProcessQueueOptions;
  private readonly tails = new Map<string, Promise<void>>();

  constructor(options: InProcessQueueOptions) {
    this.options = options;
  }

  async enqueue(message: IncomingMessage): Promise<void> {
    const previous = this.tails.get(message.phoneE164) ?? Promise.resolve();
    const next = previous.then(() => this.run(message));
    this.tails.set(message.phoneE164, next);
    void next.then(() => {
      if (this.tails.get(message.phoneE164) === next) this.tails.delete(message.phoneE164);
    });
  }

  /** Resolve quando tudo o que foi enfileirado até agora terminou (desligamento e testes). */
  async idle(): Promise<void> {
    while (this.tails.size > 0) await Promise.all([...this.tails.values()]);
  }

  private async run(message: IncomingMessage): Promise<void> {
    const attempts = this.options.attempts ?? 3;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        await this.options.process(message);
        return;
      } catch {
        if (attempt < attempts) await wait(this.options.retryDelayMs ?? 1000);
      }
    }
    this.options.onDropped();
  }
}
