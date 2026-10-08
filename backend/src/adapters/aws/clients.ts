// Clientes mínimos da AWS. O runtime do domínio não importa o AWS SDK: o ponto de entrada de cada Lambda
// embrulha o SDK real (`SendMessageCommand`, `GetSecretValueCommand`) nestas interfaces, e os testes usam
// clientes falsos. Quem implementa deve propagar qualquer falha como exceção.

export interface SqsSendMessageInput {
  readonly queueURL: string;
  readonly body: string;
  /** `MessageGroupId` da fila FIFO. */
  readonly messageGroupID: string;
  /** `MessageDeduplicationId` da fila FIFO. */
  readonly messageDeduplicationID: string;
}

export interface SqsClient {
  sendMessage(input: SqsSendMessageInput): Promise<void>;
}

export interface SecretsManagerClient {
  /** `SecretString` do segredo; `undefined` se o segredo existir sem `SecretString` (por exemplo, binário). */
  getSecretString(secretID: string): Promise<string | undefined>;
}
