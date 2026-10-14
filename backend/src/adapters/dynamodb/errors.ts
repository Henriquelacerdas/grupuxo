export type DynamoStoreErrorCode =
  /** Item lido não tem o formato esperado, ou valor a gravar fora das regras do modelo. */
  | "invalidItem"
  /** O comando geraria mais ações do que cabem numa transação: nada foi gravado. */
  | "tooManyWrites"
  /** O comando de domínio alterou algo que o modelo não persiste (por exemplo, a lista de casas). */
  | "unsupportedChange"
  /** Outro pedido gravou a casa durante todas as tentativas: nada foi aplicado. */
  | "conflict"
  /** Escrita dividida (`oversizedWrites: "split"`): a primeira transação foi aplicada e uma seguinte falhou. */
  | "partialWrite"
  /** Semeadura: já existe uma casa com este ID. */
  | "houseExists"
  /** Semeadura: o código de acesso já é de outra casa. */
  | "accessCodeTaken";

const MESSAGES: Readonly<Record<DynamoStoreErrorCode, string>> = {
  invalidItem: "Item do DynamoDB inválido",
  tooManyWrites: "Comando gera escritas demais para uma transação",
  unsupportedChange: "Alteração não suportada pelo modelo de itens",
  conflict: "Conflito de escrita concorrente na casa",
  partialWrite: "Escrita dividida interrompida: a casa pode estar parcialmente atualizada",
  houseExists: "Já existe uma casa com este ID",
  accessCodeTaken: "Código de acesso já em uso",
};

/** Mensagem fixa: nunca carrega valores de itens, telefone, `wamid`, ID de segredo nem texto de mensagem. */
export class DynamoStoreError extends Error {
  readonly code: DynamoStoreErrorCode;

  constructor(code: DynamoStoreErrorCode) {
    super(MESSAGES[code]);
    this.name = "DynamoStoreError";
    this.code = code;
  }
}
