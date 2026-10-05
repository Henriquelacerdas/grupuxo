/** Elemento no índice, ou falha: os índices vêm sempre de iterações sobre o próprio array. */
export function at<T>(items: readonly T[], index: number): T {
  const value = items[index];
  if (value === undefined) throw new RangeError(`índice fora do intervalo: ${index}`);
  return value;
}

export function lastWhere<T>(items: readonly T[], predicate: (item: T) => boolean): T | undefined {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item !== undefined && predicate(item)) return item;
  }
  return undefined;
}

export function lastIndexWhere<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item !== undefined && predicate(item)) return i;
  }
  return -1;
}

/** Só espaços e quebras de linha Unicode (o `trimmingCharacters(in: .whitespacesAndNewlines)` do Foundation). */
export function isBlank(text: string): boolean {
  return /^\p{White_Space}*$/u.test(text);
}

export function trimmed(text: string): string {
  return text.replace(/^\p{White_Space}+/u, "").replace(/\p{White_Space}+$/u, "");
}

/** Ordem de texto por forma canônica (NFC), como o `<` de `String` no Swift. */
export function compareText(a: string, b: string): number {
  const left = a.normalize("NFC");
  const right = b.normalize("NFC");
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Índice por chave que falha em duplicatas (o `Dictionary(uniqueKeysWithValues:)` do Swift trava nesse caso). */
export function uniqueMap<T, K>(items: readonly T[], key: (item: T) => K): Map<K, T> {
  const result = new Map<K, T>();
  for (const item of items) {
    const k = key(item);
    if (result.has(k)) throw new Error(`chave duplicada: ${String(k)}`);
    result.set(k, item);
  }
  return result;
}
