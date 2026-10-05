import type { Instant } from "../../domain/dates.ts";
import type { RateCounter } from "../../whatsapp/ports.ts";

/**
 * Contador em memória. Sem `await` entre ler e gravar, cada `increment` é atômico (como o `ON CONFLICT DO UPDATE`
 * do SQL será). Janelas antigas não são apagadas: aceitável em dev e testes; o armazenamento real limpa por
 * `window_start`.
 */
export class InMemoryRateCounter implements RateCounter {
  private readonly counts = new Map<string, number>();

  async increment(key: string, windowStart: Instant): Promise<number> {
    const id = `${windowStart}\u0000${key}`;
    const next = (this.counts.get(id) ?? 0) + 1;
    this.counts.set(id, next);
    return next;
  }
}
