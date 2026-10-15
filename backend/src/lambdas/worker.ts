import { parseIncomingMessage } from "../whatsapp/incoming-message.ts";
import type { WhatsAppWorker } from "../whatsapp/worker.ts";
import { parseSqsEvent } from "./events.ts";

export interface SqsBatchResponse {
  readonly batchItemFailures: readonly { readonly itemIdentifier: string }[];
}

const SAFE_LABEL = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * Descrição de uma falha para o log: só o nome da classe e, se existirem, `code` (texto) e `status` (número) do erro,
 * que no projeto são constantes. Nunca a mensagem, o corpo, o telefone, o `wamid` nem o texto do morador.
 */
export function describeFailure(error: unknown): string {
  if (typeof error !== "object" || error === null) return "falha desconhecida";
  const fields = Object.fromEntries(Object.entries(error));
  const name = error instanceof Error && SAFE_LABEL.test(error.name) ? error.name : "Error";
  const code = typeof fields["code"] === "string" && SAFE_LABEL.test(fields["code"]) ? ` code=${fields["code"]}` : "";
  const status = typeof fields["status"] === "number" && Number.isInteger(fields["status"]) ? ` status=${fields["status"]}` : "";
  return `${name}${code}${status}`;
}

/**
 * Lambda `whatsapp-worker` (gatilho SQS FIFO com `ReportBatchItemFailures`). Processa os registros na ordem. Um
 * registro que falha (inclusive corpo inválido, que depois de esgotadas as tentativas vai para a DLQ) é
 * reportado em `batchItemFailures`, e os seguintes do mesmo `MessageGroupId` também, sem serem processados:
 * assim a ordem por telefone se mantém. Outros grupos seguem. O conteúdo das mensagens nunca é registrado.
 *
 * Cada falha chama `onFailure` com `describeFailure` (sem conteúdo), para o erro não ficar mudo no CloudWatch.
 *
 * Evento que não é um lote do SQS lança erro: a invocação falha e o SQS devolve o lote inteiro.
 */
export function createWorkerHandler(
  worker: Pick<WhatsAppWorker, "process">,
  onFailure: (description: string) => void = () => {},
): (event: unknown) => Promise<SqsBatchResponse> {
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
      } catch (error) {
        onFailure(describeFailure(error));
        failedGroups.add(group);
        failures.push({ itemIdentifier: record.messageId });
      }
    }
    return { batchItemFailures: failures };
  };
}
