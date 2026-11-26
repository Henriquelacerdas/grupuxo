import { createHash } from "node:crypto";

/**
 * SHA-256 (hex minúsculo) do endpoint de Web Push: a chave do item `DEVICE#web#<digest>` (BACKEND.md seção 4). O
 * endpoint pode ter até 1024 caracteres e caracteres que não cabem bem numa chave; o digest tem tamanho fixo. O
 * adaptador DynamoDB não usa `node:*`, então recebe esta função por injeção.
 */
export function endpointDigest(endpoint: string): string {
  return createHash("sha256").update(endpoint, "utf8").digest("hex");
}
