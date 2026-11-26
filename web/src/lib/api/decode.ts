// Decodificadores escritos à mão: transformam `unknown` (JSON da `api`) em tipos, sem `as` (mesma regra do backend).
// Um campo errado lança `DecodeError` com o caminho, nunca com o valor.

export class DecodeError extends Error {
  readonly path: string;
  constructor(path: string, expected: string) {
    super(`Resposta inesperada da api em ${path} (esperado ${expected})`);
    this.name = "DecodeError";
    this.path = path;
  }
}

export type Decoder<T> = (value: unknown, path: string) => T;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const string: Decoder<string> = (value, path) => {
  if (typeof value !== "string") throw new DecodeError(path, "texto");
  return value;
};

export const number: Decoder<number> = (value, path) => {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new DecodeError(path, "número");
  return value;
};

export const boolean: Decoder<boolean> = (value, path) => {
  if (typeof value !== "boolean") throw new DecodeError(path, "booleano");
  return value;
};

/** Instante ISO 8601 (com milissegundos, como a `api` manda) em milissegundos desde a época. */
export const instant: Decoder<number> = (value, path) => {
  const text = string(value, path);
  const parsed = Date.parse(text);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(text) || Number.isNaN(parsed)) throw new DecodeError(path, "instante ISO");
  return parsed;
};

export function nullable<T>(decoder: Decoder<T>): Decoder<T | null> {
  return (value, path) => (value === null || value === undefined ? null : decoder(value, path));
}

export function array<T>(decoder: Decoder<T>): Decoder<readonly T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) throw new DecodeError(path, "lista");
    return value.map((item, index) => decoder(item, `${path}[${index}]`));
  };
}

/** Lista em que itens que não decodificam são descartados (ex.: avisos de um `kind` novo que o web não conhece). */
export function lenientArray<T>(decoder: Decoder<T>): Decoder<readonly T[]> {
  return (value, path) => {
    if (!Array.isArray(value)) throw new DecodeError(path, "lista");
    const out: T[] = [];
    value.forEach((item, index) => {
      try { out.push(decoder(item, `${path}[${index}]`)); } catch (error) { if (!(error instanceof DecodeError)) throw error; }
    });
    return out;
  };
}

export function literal<const T extends string>(options: readonly T[]): Decoder<T> {
  return (value, path) => {
    const found = options.find((option) => option === value);
    if (found === undefined) throw new DecodeError(path, options.join(" | "));
    return found;
  };
}

/** Como `literal`, mas um valor desconhecido vira `fallback` (enumerações que o servidor pode ampliar). */
export function literalOr<const T extends string>(options: readonly T[], fallback: T): Decoder<T> {
  return (value) => options.find((option) => option === value) ?? fallback;
}

export function object(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new DecodeError(path, "objeto");
  return value;
}

/** Lê `record[name]` com o decodificador, com o caminho certo no erro. */
export function field<T>(record: Record<string, unknown>, name: string, decoder: Decoder<T>, path: string): T {
  return decoder(record[name], `${path}.${name}`);
}

export function decode<T>(decoder: Decoder<T>, value: unknown): T {
  return decoder(value, "$");
}
