import { DynamoStoreError } from "./errors.ts";
import type { DynamoItem, DynamoValue } from "./client.ts";

// Estreitamento à mão de itens lidos do DynamoDB (dado externo): `unknown`/`DynamoValue` em, tipo do domínio
// fora, sem `as`. Qualquer campo ausente ou do tipo errado vira `DynamoStoreError("invalidItem")`, de mensagem
// fixa (nunca com o valor).

export function invalid(): never {
  throw new DynamoStoreError("invalidItem");
}

function field(item: DynamoItem, name: string): DynamoValue {
  const value = Object.hasOwn(item, name) ? item[name] : undefined;
  return value === undefined ? invalid() : value;
}

export function isRecord(value: DynamoValue | undefined): value is DynamoItem {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isList(value: DynamoValue | undefined): value is readonly DynamoValue[] {
  return Array.isArray(value);
}

export function str(item: DynamoItem, name: string): string {
  const value = field(item, name);
  return typeof value === "string" ? value : invalid();
}

export function num(item: DynamoItem, name: string): number {
  const value = field(item, name);
  return typeof value === "number" && Number.isFinite(value) ? value : invalid();
}

export function integer(item: DynamoItem, name: string): number {
  const value = num(item, name);
  return Number.isSafeInteger(value) ? value : invalid();
}

export function bool(item: DynamoItem, name: string): boolean {
  const value = field(item, name);
  return typeof value === "boolean" ? value : invalid();
}

export function nullableNum(item: DynamoItem, name: string): number | null {
  return field(item, name) === null ? null : num(item, name);
}

export function nullableStr(item: DynamoItem, name: string): string | null {
  return field(item, name) === null ? null : str(item, name);
}

export function nullableBool(item: DynamoItem, name: string): boolean | null {
  return field(item, name) === null ? null : bool(item, name);
}

export function oneOf<T extends string>(item: DynamoItem, name: string, allowed: readonly T[]): T {
  const value = str(item, name);
  return allowed.find((candidate) => candidate === value) ?? invalid();
}

export function list(item: DynamoItem, name: string): readonly DynamoValue[] {
  const value = field(item, name);
  return isList(value) ? value : invalid();
}

export function nullableList(item: DynamoItem, name: string): readonly DynamoValue[] | null {
  return field(item, name) === null ? null : list(item, name);
}

export function record(item: DynamoItem, name: string): DynamoItem {
  const value = field(item, name);
  return isRecord(value) ? value : invalid();
}

export function nullableRecord(item: DynamoItem, name: string): DynamoItem | null {
  return field(item, name) === null ? null : record(item, name);
}

export function asRecord(value: DynamoValue): DynamoItem {
  return isRecord(value) ? value : invalid();
}

export function asString(value: DynamoValue): string {
  return typeof value === "string" ? value : invalid();
}

export function asNumber(value: DynamoValue): number {
  return typeof value === "number" && Number.isFinite(value) ? value : invalid();
}

/** Mapa de texto → número (por exemplo `taskRoles`, `completionDebtImpacts`). */
export function numberMap(item: DynamoItem, name: string): Record<string, number> {
  const source = record(item, name);
  const result: Record<string, number> = {};
  for (const key of Object.keys(source).sort()) result[key] = asNumber(field(source, key));
  return result;
}

/** Aplica `decode` e converte qualquer falha de decodificação (por exemplo UUID inválido) em `invalidItem`. */
export function decoding<T>(decode: () => T): T {
  try {
    return decode();
  } catch (error) {
    if (error instanceof DynamoStoreError) throw error;
    return invalid();
  }
}
