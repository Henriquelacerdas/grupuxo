import type { SecretsManagerClient, SqsClient, SqsSendMessageInput } from "../../src/adapters/aws/clients.ts";

/** Cliente SQS falso: guarda os envios, sem rede. `failWith` faz o próximo envio falhar. */
export class FakeSqsClient implements SqsClient {
  readonly sent: SqsSendMessageInput[] = [];
  failWith: Error | null = null;

  async sendMessage(input: SqsSendMessageInput): Promise<void> {
    if (this.failWith !== null) throw this.failWith;
    this.sent.push(input);
  }
}

/** Cliente do Secrets Manager falso: conta as buscas e devolve a resposta configurada. */
export class FakeSecretsClient implements SecretsManagerClient {
  calls = 0;
  readonly requested: string[] = [];
  readonly response: () => Promise<string | undefined>;

  constructor(response: () => Promise<string | undefined> = async () => undefined) {
    this.response = response;
  }

  async getSecretString(secretID: string): Promise<string | undefined> {
    this.calls += 1;
    this.requested.push(secretID);
    return this.response();
  }
}
