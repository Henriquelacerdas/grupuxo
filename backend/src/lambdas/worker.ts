import { parseIncomingMessage } from "../whatsapp/incoming-message.ts";
import type { WhatsAppWorker } from "../whatsapp/worker.ts";
import { parseSqsEvent } from "./events.ts";

export interface SqsBatchResponse {
  readonly batchItemFailures: readonly { readonly itemIdentifier: string }[];
}

/**
 * Lambda `whatsapp-worker` (gatilho SQS FIFO com `ReportBatchItemFailures`). Processa os registros na ordem. Um
 * registro que falha (inclusive corpo inválido, que depois de esgotadas as tentativas vai para a DLQ) é
 * reportado em `batchItemFailures`, e os seguintes do mesmo `MessageGroupId` também, sem serem processados:
 * assim a ordem por telefone se mantém. Outros grupos seguem. O conteúdo das mensagens nunca é registrado.
 *
 * Evento que não é um lote do SQS lança erro: a invocação falha e o SQS devolve o lote inteiro.
 */
export function createWorkerHandler(worker: Pick<WhatsAppWorker, "process">): (event: unknown) => Promise<SqsBatchResponse> {
  return async (event) => {
    const records = parseSqsEvent(event);
    if (records === null) throw new TypeError("evento SQS inválido");
    const failedGroups = new Set<string>();
    const failures: { itemIdentifier: string }[] = [];
    for (const record of records) {
      // Sem grupo (fila padrão), cada mensagem é o seu próprio grupo.
      const group = record.messageGroupId ?? `message:${record.messageId}`;
      if (failedGroups.has(group)) {
        failures.push({ itemIdentifier: record.messageId });
        continue;
      }
      try {
        const body: unknown = JSON.parse(record.body);
        await worker.process(parseIncomingMessage(body));
      } catch {
        failedGroups.add(group);
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}
