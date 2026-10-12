import {
  DynamoConditionFailedError, DynamoTransactionCanceledError, MAX_BATCH_GET_KEYS, MAX_TRANSACT_ACTIONS,
  type DynamoCancellationReason, type DynamoClient, type DynamoDeleteInput, type DynamoGetInput, type DynamoItem,
  type DynamoKey, type DynamoPutInput, type DynamoQueryInput, type DynamoQueryOutput, type DynamoTransactAction,
  type DynamoUpdateInput, type DynamoValue, type ExpressionAttributes,
} from "../../src/adapters/dynamodb/client.ts";

// Cliente DynamoDB falso, em memória, que imita o que o adaptador usa: tabela `PK`/`SK` com índice `GSI1` esparso,
// expressões de condição, de atualização e de chave, `ConsistentRead` (ignorado: o fake é sempre consistente),
// paginação, `TransactWriteItems` atômico com motivo de cancelamento por ação e os limites de 100 ações/chaves.
// Cada operação cede a vez ao laço de eventos, para que pedidos concorrentes se intercalem como na rede.

type Names = Readonly<Record<string, string>>;
type Values = Readonly<Record<string, DynamoValue>>;

function isRecord(value: DynamoValue | undefined): value is DynamoItem {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: DynamoValue | undefined): value is readonly DynamoValue[] {
  return Array.isArray(value);
}

function sameValue(a: DynamoValue | undefined, b: DynamoValue | undefined): boolean {
  if (a === b) return true;
  if (isList(a)) return isList(b) && a.length === b.length && a.every((value, index) => sameValue(value, b[index]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]));
}

// ---------- Expressões ----------

const TOKEN = /\s*(<>|<=|>=|=|<|>|\(|\)|,|\+|-|#[A-Za-z0-9_]+|:[A-Za-z0-9_]+|[A-Za-z_][A-Za-z0-9_]*)/y;

function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < expression.length) {
    if (/^\s*$/.test(expression.slice(TOKEN.lastIndex))) break;
    const match = TOKEN.exec(expression);
    if (match === null) throw new Error(`ValidationException: expressão inválida: ${expression}`);
    tokens.push(match[1] ?? "");
  }
  return tokens;
}

class Cursor {
  private index = 0;
  private readonly tokens: readonly string[];
  constructor(tokens: readonly string[]) {
    this.tokens = tokens;
  }
  peek(): string | undefined {
    return this.tokens[this.index];
  }
  next(): string {
    const token = this.tokens[this.index];
    if (token === undefined) throw new Error("ValidationException: expressão incompleta");
    this.index += 1;
    return token;
  }
  accept(expected: string): boolean {
    if (this.peek()?.toUpperCase() === expected.toUpperCase()) {
      this.index += 1;
      return true;
    }
    return false;
  }
  expect(expected: string): void {
    if (!this.accept(expected)) throw new Error(`ValidationException: esperado ${expected}`);
  }
  get done(): boolean {
    return this.index >= this.tokens.length;
  }
}

interface Scope {
  readonly item: DynamoItem | undefined;
  readonly names: Names;
  readonly values: Values;
}

function attributeName(token: string, scope: Scope): string {
  if (token.startsWith("#")) {
    const name = scope.names[token];
    if (name === undefined) throw new Error(`ValidationException: nome ${token} não definido`);
    return name;
  }
  return token;
}

function attributeValue(token: string, scope: Scope): DynamoValue | undefined {
  if (token.startsWith(":")) {
    const value = scope.values[token];
    if (value === undefined) throw new Error(`ValidationException: valor ${token} não definido`);
    return value;
  }
  const name = attributeName(token, scope);
  return scope.item !== undefined && Object.hasOwn(scope.item, name) ? scope.item[name] : undefined;
}

function compare(op: string, left: DynamoValue | undefined, right: DynamoValue | undefined): boolean {
  if (op === "=") return left !== undefined && sameValue(left, right);
  if (op === "<>") return left === undefined || !sameValue(left, right);
  if (typeof left === "number" && typeof right === "number") {
    return op === "<" ? left < right : op === "<=" ? left <= right : op === ">" ? left > right : left >= right;
  }
  if (typeof left === "string" && typeof right === "string") {
    return op === "<" ? left < right : op === "<=" ? left <= right : op === ">" ? left > right : left >= right;
  }
  return false;
}

function parseOr(cursor: Cursor, scope: Scope): boolean {
  let result = parseAnd(cursor, scope);
  while (cursor.accept("OR")) {
    const right = parseAnd(cursor, scope);
    result = result || right;
  }
  return result;
}

function parseAnd(cursor: Cursor, scope: Scope): boolean {
  let result = parsePrimary(cursor, scope);
  while (cursor.accept("AND")) {
    const right = parsePrimary(cursor, scope);
    result = result && right;
  }
  return result;
}

function parsePrimary(cursor: Cursor, scope: Scope): boolean {
  if (cursor.accept("(")) {
    const inner = parseOr(cursor, scope);
    cursor.expect(")");
    return inner;
  }
  const head = cursor.next();
  const lowered = head.toLowerCase();
  if (lowered === "attribute_exists" || lowered === "attribute_not_exists") {
    cursor.expect("(");
    const present = attributeValue(cursor.next(), scope) !== undefined;
    cursor.expect(")");
    return lowered === "attribute_exists" ? present : !present;
  }
  if (lowered === "begins_with") {
    cursor.expect("(");
    const target = attributeValue(cursor.next(), scope);
    cursor.expect(",");
    const prefix = attributeValue(cursor.next(), scope);
    cursor.expect(")");
    return typeof target === "string" && typeof prefix === "string" && target.startsWith(prefix);
  }
  const op = cursor.next();
  if (!["=", "<>", "<", "<=", ">", ">="].includes(op)) throw new Error(`ValidationException: operador inválido ${op}`);
  return compare(op, attributeValue(head, scope), attributeValue(cursor.next(), scope));
}

/** Avalia uma expressão de condição (ou de chave) sobre `item` (`undefined` = item inexistente). */
function evaluate(expression: string, item: DynamoItem | undefined, attributes: ExpressionAttributes): boolean {
  const cursor = new Cursor(tokenize(expression));
  const result = parseOr(cursor, { item, names: attributes.names ?? {}, values: attributes.values ?? {} });
  if (!cursor.done) throw new Error("ValidationException: sobra de expressão");
  return result;
}

function numberOf(value: DynamoValue | undefined): number {
  if (typeof value !== "number") throw new Error("ValidationException: operando não numérico");
  return value;
}

/** Aplica `SET a = b [+|-] c, ...` e `ADD a :n`; devolve o novo item e os atributos tocados. */
function applyUpdate(expression: string, current: DynamoItem, attributes: ExpressionAttributes): { item: DynamoItem; touched: DynamoItem } {
  const cursor = new Cursor(tokenize(expression));
  const scope: Scope = { item: current, names: attributes.names ?? {}, values: attributes.values ?? {} };
  const next: Record<string, DynamoValue> = { ...current };
  const touched: Record<string, DynamoValue> = {};
  const assign = (name: string, value: DynamoValue): void => {
    next[name] = value;
    touched[name] = value;
  };
  while (!cursor.done) {
    if (cursor.accept("SET")) {
      do {
        const name = attributeName(cursor.next(), scope);
        cursor.expect("=");
        const left = attributeValue(cursor.next(), scope);
        if (cursor.accept("+")) assign(name, numberOf(left) + numberOf(attributeValue(cursor.next(), scope)));
        else if (cursor.accept("-")) assign(name, numberOf(left) - numberOf(attributeValue(cursor.next(), scope)));
        else if (left === undefined) throw new Error("ValidationException: valor ausente no SET");
        else assign(name, left);
      } while (cursor.accept(","));
    } else if (cursor.accept("ADD")) {
      do {
        const name = attributeName(cursor.next(), scope);
        const amount = numberOf(attributeValue(cursor.next(), scope));
        const existing = Object.hasOwn(next, name) ? next[name] : undefined;
        assign(name, (existing === undefined ? 0 : numberOf(existing)) + amount);
      } while (cursor.accept(","));
    } else {
      throw new Error("ValidationException: cláusula de atualização não suportada");
    }
  }
  return { item: next, touched };
}

// ---------- Tabela ----------

function keyOf(key: DynamoKey): string {
  return `${key.PK}\u0000${key.SK}`;
}

function assertValue(value: unknown, path: string): void {
  if (value === undefined) throw new Error(`ValidationException: valor undefined em ${path}`);
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`ValidationException: número inválido em ${path}`);
  if (Array.isArray(value)) value.forEach((entry, index) => assertValue(entry, `${path}[${index}]`));
  else if (typeof value === "object" && value !== null) {
    for (const [name, entry] of Object.entries(value)) assertValue(entry, `${path}.${name}`);
  }
}

function checkedItem(item: DynamoItem): DynamoItem {
  assertValue(item, "item");
  if (typeof item["PK"] !== "string" || typeof item["SK"] !== "string") throw new Error("ValidationException: item sem PK/SK");
  if (JSON.stringify(item).length > 400_000) throw new Error("ValidationException: item grande demais");
  return structuredClone(item);
}

function keyFields(key: DynamoKey): DynamoItem {
  return { PK: key.PK, SK: key.SK };
}

export interface FakeDynamoOptions {
  /** Itens por página de `query` (para exercitar a paginação). */
  readonly pageSize?: number;
}

export class FakeDynamoClient implements DynamoClient {
  private readonly table = new Map<string, DynamoItem>();
  private readonly pageSize: number;

  /** Chamadas que gravaram algo (`put`, `update`, `delete`, `transactWrite` que não falhou). */
  writes = 0;
  readonly transactions: (readonly DynamoTransactAction[])[] = [];
  /** Roda antes de cada `transactWrite` (simula outro escritor ou falha). */
  beforeTransact: ((actions: readonly DynamoTransactAction[]) => Promise<void>) | undefined;
  /** Faz a próxima operação do tipo indicado falhar com este erro. */
  failNext: { operation: string; error: Error } | undefined;
  /** Chamadas de leitura por operação. */
  readonly reads = { get: 0, query: 0, batchGet: 0 };

  constructor(options: FakeDynamoOptions = {}) {
    this.pageSize = options.pageSize ?? 25;
  }

  /** Cópia dos itens, ordenados por chave (para asserções). */
  snapshot(): DynamoItem[] {
    return [...this.table.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, item]) => structuredClone(item));
  }

  /** Grava direto, fora das regras (preparação de testes). */
  seedItem(item: DynamoItem): void {
    const checked = checkedItem(item);
    this.table.set(keyOf({ PK: String(checked["PK"]), SK: String(checked["SK"]) }), checked);
  }

  peek(key: DynamoKey): DynamoItem | undefined {
    const item = this.table.get(keyOf(key));
    return item === undefined ? undefined : structuredClone(item);
  }

  private async turn(operation: string): Promise<void> {
    await Promise.resolve();
    if (this.failNext?.operation === operation) {
      const { error } = this.failNext;
      this.failNext = undefined;
      throw error;
    }
  }

  async get(input: DynamoGetInput): Promise<DynamoItem | undefined> {
    await this.turn("get");
    this.reads.get += 1;
    return this.peek(input.key);
  }

  async query(input: DynamoQueryInput): Promise<DynamoQueryOutput> {
    await this.turn("query");
    this.reads.query += 1;
    if (input.indexName !== undefined && input.indexName !== "GSI1") throw new Error("ValidationException: índice desconhecido");
    const partition = input.indexName === undefined ? "PK" : "GSI1PK";
    const sort = input.indexName === undefined ? "SK" : "GSI1SK";
    const matches = [...this.table.values()]
      .filter((item) => typeof item[partition] === "string" && typeof item[sort] === "string")
      .filter((item) => evaluate(input.keyCondition, item, input))
      .sort((a, b) => {
        const byIndex = String(a[sort]).localeCompare(String(b[sort]), "en");
        return byIndex !== 0 ? byIndex : keyOf({ PK: String(a["PK"]), SK: String(a["SK"]) }).localeCompare(keyOf({ PK: String(b["PK"]), SK: String(b["SK"]) }), "en");
      });
    if (!input.scanForward) matches.reverse();
    const start = input.startKey === undefined
      ? 0
      : matches.findIndex((item) => item["PK"] === input.startKey?.["PK"] && item["SK"] === input.startKey?.["SK"]) + 1;
    const page = matches.slice(start, start + this.pageSize);
    const last = page[page.length - 1];
    const more = start + this.pageSize < matches.length;
    const items = page.map((item) => structuredClone(item));
    if (!more || last === undefined) return { items };
    const lastKey: DynamoItem = input.indexName === undefined
      ? { PK: String(last["PK"]), SK: String(last["SK"]) }
      : { PK: String(last["PK"]), SK: String(last["SK"]), GSI1PK: String(last["GSI1PK"]), GSI1SK: String(last["GSI1SK"]) };
    return { items, lastKey };
  }

  async put(input: DynamoPutInput): Promise<void> {
    await this.turn("put");
    const item = checkedItem(input.item);
    const key = keyOf({ PK: String(item["PK"]), SK: String(item["SK"]) });
    if (input.condition !== undefined && !evaluate(input.condition, this.table.get(key), input)) {
      throw new DynamoConditionFailedError();
    }
    this.table.set(key, item);
    this.writes += 1;
  }

  async update(input: DynamoUpdateInput): Promise<DynamoItem> {
    await this.turn("update");
    const key = keyOf(input.key);
    const existing = this.table.get(key);
    if (input.condition !== undefined && !evaluate(input.condition, existing, input)) throw new DynamoConditionFailedError();
    const result = applyUpdate(input.update, existing ?? keyFields(input.key), input);
    const item = checkedItem(result.item);
    this.table.set(key, item);
    this.writes += 1;
    return structuredClone(input.returnValues === "ALL_NEW" ? item : result.touched);
  }

  async delete(input: DynamoDeleteInput): Promise<void> {
    await this.turn("delete");
    const key = keyOf(input.key);
    if (input.condition !== undefined && !evaluate(input.condition, this.table.get(key), input)) {
      throw new DynamoConditionFailedError();
    }
    this.table.delete(key);
    this.writes += 1;
  }

  async batchGet(keys: readonly DynamoKey[]): Promise<readonly DynamoItem[]> {
    await this.turn("batchGet");
    this.reads.batchGet += 1;
    if (keys.length > MAX_BATCH_GET_KEYS) throw new Error("ValidationException: chaves demais no batchGet");
    return keys.flatMap((key) => {
      const item = this.peek(key);
      return item === undefined ? [] : [item];
    });
  }

  async transactWrite(actions: readonly DynamoTransactAction[]): Promise<void> {
    await this.turn("transactWrite");
    if (this.beforeTransact !== undefined) await this.beforeTransact(actions);
    if (actions.length === 0 || actions.length > MAX_TRANSACT_ACTIONS) throw new Error("ValidationException: número de ações inválido");
    const targets = actions.map((action) => {
      if (action.kind === "put") {
        const item = checkedItem(action.item);
        return keyOf({ PK: String(item["PK"]), SK: String(item["SK"]) });
      }
      return keyOf(action.key);
    });
    if (new Set(targets).size !== targets.length) throw new Error("ValidationException: duas ações no mesmo item");
    const reasons: DynamoCancellationReason[] = actions.map((action, index) => {
      const target = targets[index] ?? "";
      return action.condition === undefined || evaluate(action.condition, this.table.get(target), action) ? "Other" : "ConditionalCheckFailed";
    });
    if (reasons.includes("ConditionalCheckFailed")) throw new DynamoTransactionCanceledError(reasons);
    // Tudo validado: aplica (se uma atualização falhar na avaliação, nada foi alterado ainda porque calculamos antes).
    const staged = new Map<string, DynamoItem | null>();
    actions.forEach((action, index) => {
      const target = targets[index] ?? "";
      if (action.kind === "put") staged.set(target, checkedItem(action.item));
      else if (action.kind === "delete") staged.set(target, null);
      else staged.set(target, checkedItem(applyUpdate(action.update, this.table.get(target) ?? keyFields(action.key), action).item));
    });
    for (const [target, item] of staged) {
      if (item === null) this.table.delete(target);
      else this.table.set(target, item);
    }
    this.writes += 1;
    this.transactions.push(actions);
  }
}
