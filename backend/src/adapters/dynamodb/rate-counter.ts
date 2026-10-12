import type { Instant } from "../../domain/dates.ts";
import type { RateCounter } from "../../whatsapp/ports.ts";
import type { DynamoClient } from "./client.ts";
import { ratePK, ttlSeconds } from "./keys.ts";
import { integer } from "./reader.ts";

export interface RateCounterOptions {
  readonly client: DynamoClient;
  /** Quanto tempo depois do início da janela o contador pode ser apagado (só limpeza; sem valor padrão). */
  readonly retentionSeconds: number;
}

/** Item `RATE#<key>`/`<windowStart>`: `UpdateItem ADD` atômico; a janela está na chave, o TTL só limpa. */
export class DynamoRateCounter implements RateCounter {
  private readonly client: DynamoClient;
  private readonly retentionSeconds: number;

  constructor(options: RateCounterOptions) {
    this.client = options.client;
    this.retentionSeconds = options.retentionSeconds;
  }

  async increment(key: string, windowStart: Instant): Promise<number> {
    const updated = await this.client.update({
      key: { PK: ratePK(key), SK: String(windowStart) }, update: "SET #ttl = :ttl ADD #count :one",
      names: { "#count": "count", "#ttl": "ttl" },
      values: { ":one": 1, ":ttl": ttlSeconds(windowStart, this.retentionSeconds) }, returnValues: "UPDATED_NEW",
    });
    return integer(updated, "count");
  }
}
