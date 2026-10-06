import type { Instant } from "../domain/dates.ts";
import type { RateCounter } from "./ports.ts";

export class RateLimitConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitConfigError";
  }
}

export type RateLimitDecision =
  /** Dentro do limite: processar. */
  | "allowed"
  /** Primeira mensagem barrada da janela: o bot avisa uma vez. */
  | "limitedFirst"
  /** Demais mensagens barradas da janela: descartar em silêncio. */
  | "limited";

export interface MessageRateLimiterOptions {
  readonly counter: RateCounter;
  /** Mensagens permitidas por janela e por número. Sem padrão: vem da configuração do ambiente. */
  readonly limit: number;
  /** Duração da janela fixa, em segundos. Sem padrão. */
  readonly windowSeconds: number;
}

/**
 * Limite de taxa por número (BACKEND.md 7.3), em janela fixa: o instante é arredondado para baixo ao início da
 * janela e o `RateCounter` conta as mensagens. Uma rajada na virada da janela pode somar até o dobro do limite;
 * é aceitável para controlar custo. Só traduz contagem em decisão: o armazenamento é do port.
 */
export class MessageRateLimiter {
  private readonly counter: RateCounter;
  private readonly limit: number;
  private readonly windowMs: number;

  constructor(options: MessageRateLimiterOptions) {
    const { limit, windowSeconds } = options;
    if (!Number.isInteger(limit) || limit <= 0) throw new RateLimitConfigError("limite de mensagens inválido");
    if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) throw new RateLimitConfigError("janela do limite inválida");
    this.counter = options.counter;
    this.limit = limit;
    this.windowMs = windowSeconds * 1000;
  }

  async check(phoneE164: string, at: Instant): Promise<RateLimitDecision> {
    const windowStart = Math.floor(at / this.windowMs) * this.windowMs;
    const count = await this.counter.increment(phoneE164, windowStart);
    if (count <= this.limit) return "allowed";
    return count === this.limit + 1 ? "limitedFirst" : "limited";
  }
}
