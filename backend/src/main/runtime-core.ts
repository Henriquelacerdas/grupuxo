import { randomInt, randomUUID } from "node:crypto";
import type { Instant } from "../domain/dates.ts";
import type { IDGenerator } from "../domain/ids.ts";
import type { HttpFetch } from "../http.ts";
import type { Environment } from "../lambdas/config.ts";

// Relógio, aleatoriedade, ambiente e rede globais, sem AWS: compartilhado pelas Lambdas (`runtime.ts`) e pelo
// servidor local (`server.ts`). Nada aqui registra em log.

export function environment(): Environment {
  return process.env;
}

export const now = (): Instant => Date.now();

/** UUID v4 em minúsculo (texto canônico dos IDs). */
export const newID: IDGenerator = () => randomUUID();

// Sem caracteres ambíguos (0/O, 1/I/L): o código é digitado pelo morador.
const ACCESS_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const ACCESS_CODE_LENGTH = 6;

/** Código de convite da casa (`^[A-Z0-9]{4,16}$`), de `crypto`. */
export function newAccessCode(): string {
  return Array.from({ length: ACCESS_CODE_LENGTH }, () => ACCESS_CODE_ALPHABET[randomInt(ACCESS_CODE_ALPHABET.length)]).join("");
}

/** O `fetch` global do Node, que já satisfaz `HttpFetch`. */
export const http: HttpFetch = (url, init) => fetch(url, init);
