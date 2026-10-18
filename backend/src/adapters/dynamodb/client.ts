//// Cliente mínimo do DynamoDB. O runtime do backend não importa o AWS SDK: o ponto de entrada de cada Lambda
//// embrulha o SDK real (`@aws-sdk/lib-dynamodb`, que já vem no runtime Node 22 da Lambda) nesta interface, e os
//// testes usam um cliente falso em memória. O cliente é **ligado a uma tabela** (`TABLE_NAME` é assunto do ponto
//// de entrada), então nenhuma operação carrega o nome da tabela.
////
//// Contrato de quem implementa:
//// - Itens são JSON puro (`DynamoItem`); atributo ausente é ausente (nunca `undefined`), nulo é `null`.
//// - Condição falhou em `put`/`update`/`delete`: lançar `DynamoConditionFailedError`.
//// - `transactWrite` cancelada: lançar `DynamoTransactionCanceledError` com **um motivo por ação, na ordem**
////   (`CancellationReasons` do SDK). Qualquer outra falha propaga como exceção, sem tradução.
//// - `query` e `batchGet` não devolvem resultado parcial silencioso: `batchGet` repete as chaves não processadas.
//
//export type DynamoValue =
//  | string
//  | number
//  | boolean
//  | null
//  | readonly DynamoValue[]
//  | { readonly [attribute: string]: DynamoValue };
//
//export interface DynamoItem {
//  readonly [attribute: string]: DynamoValue;
//}
//
//export interface DynamoKey {
//  readonly PK: string;
//  readonly SK: string;
//}
//
///** Nomes (`#n`) e valores (`:v`) usados nas expressões. */
//export interface ExpressionAttributes {
//  readonly names?: Readonly<Record<string, string>>;
//  readonly values?: Readonly<Record<string, DynamoValue>>;
//}
//
//export interface DynamoGetInput {
//  readonly key: DynamoKey;
//  readonly consistentRead: boolean;
//}
//
//export interface DynamoQueryInput extends ExpressionAttributes {
//  /** `undefined` = tabela; `"GSI1"` = índice global (nunca consistente). */
//  readonly indexName?: string;
//  readonly keyCondition: string;
//  readonly consistentRead: boolean;
//  /** `false` = ordem decrescente da chave de ordenação. */
//  readonly scanForward: boolean;
//  /** `lastKey` da página anterior. */
//  readonly startKey?: DynamoItem;
//}
//
//export interface DynamoQueryOutput {
//  readonly items: readonly DynamoItem[];
//  /** Presente enquanto houver mais páginas. */
//  readonly lastKey?: DynamoItem;
//}
//
//export interface DynamoPutInput extends ExpressionAttributes {
//  readonly item: DynamoItem;
//  readonly condition?: string;
//}
//
//export type DynamoReturnValues = "ALL_NEW" | "UPDATED_NEW";
//
//export interface DynamoUpdateInput extends ExpressionAttributes {
//  readonly key: DynamoKey;
//  /** Por exemplo `SET #a = :v ADD #count :one`. */
//  readonly update: string;
//  readonly condition?: string;
//  readonly returnValues: DynamoReturnValues;
//}
//
//export interface DynamoDeleteInput extends ExpressionAttributes {
//  readonly key: DynamoKey;
//  readonly condition?: string;
//}
//
//export type DynamoTransactAction =
//  | ({ readonly kind: "put" } & DynamoPutInput)
//  | ({ readonly kind: "delete" } & DynamoDeleteInput)
//  | ({ readonly kind: "update" } & Omit<DynamoUpdateInput, "returnValues">);
//
//export interface DynamoClient {
//  /** `undefined` se o item não existir. */
//  get(input: DynamoGetInput): Promise<DynamoItem | undefined>;
//  query(input: DynamoQueryInput): Promise<DynamoQueryOutput>;
//  put(input: DynamoPutInput): Promise<void>;
//  /** Devolve o item novo (`ALL_NEW`) ou só os atributos alterados (`UPDATED_NEW`). */
//  update(input: DynamoUpdateInput): Promise<DynamoItem>;
//  delete(input: DynamoDeleteInput): Promise<void>;
//  /** Leitura consistente; no máximo 100 chaves por chamada. Chaves sem item não aparecem no resultado. */
//  batchGet(keys: readonly DynamoKey[]): Promise<readonly DynamoItem[]>;
//  /** Atômico; no máximo 100 ações por chamada. */
//  transactWrite(actions: readonly DynamoTransactAction[]): Promise<void>;
//}
//
//export const MAX_TRANSACT_ACTIONS = 100;
//export const MAX_BATCH_GET_KEYS = 100;
//
//export class DynamoConditionFailedError extends Error {
//  constructor() {
//    super("Condição da escrita não satisfeita");
//    this.name = "DynamoConditionFailedError";
//  }
//}
//
//export type DynamoCancellationReason = "ConditionalCheckFailed" | "Other";
//
//export class DynamoTransactionCanceledError extends Error {
//  /** Um motivo por ação da transação, na mesma ordem. */
//  readonly reasons: readonly DynamoCancellationReason[];
//
//  constructor(reasons: readonly DynamoCancellationReason[]) {
//    super("Transação cancelada");
//    this.name = "DynamoTransactionCanceledError";
//    this.reasons = reasons;
//  }
//}
//
///** Todas as páginas de uma consulta. */
//export async function queryAll(client: DynamoClient, input: Omit<DynamoQueryInput, "startKey">): Promise<DynamoItem[]> {
//  const items: DynamoItem[] = [];
//  let startKey: DynamoItem | undefined;
//  do {
//    const page = await client.query(startKey === undefined ? input : { ...input, startKey });
//    items.push(...page.items);
//    startKey = page.lastKey;
//  } while (startKey !== undefined);
//  return items;
//}






// client.ts
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const isLocal = process.env.DYNAMODB_LOCAL === "true";

export const dynamoDbClient = new DynamoDBClient({
  region: process.env.AWS_REGION || "us-east-1",
  ...(isLocal && { endpoint: "http://localhost:8000" })
});

export const dynamoDbDocumentClient = DynamoDBDocumentClient.from(dynamoDbClient);
