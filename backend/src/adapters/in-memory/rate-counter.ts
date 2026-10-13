import type { Instant } from "../../domain/dates.ts";
import type { RateCounter } from "../../whatsapp/ports.ts";

/**
 * Contador em memória. Sem `await` entre ler e gravar, cada `increment` é atômico (como o `UpdateItem ... ADD`
 * do DynamoDB será). Janelas antigas não são apagadas: aceitável em dev e testes; no DynamoDB o TTL do item
 * as remove.
 */
export class InMemoryRateCounter implements RateCounter {
  private readonly counts = new Map<string, number>();
  /** Chamado depois de cada mudança (persistência local). */
  onChange: (() => void) | null = null;

  /** Pares `[chave da janela, contagem]` das janelas que começam em `keepFrom` ou depois. */
  snapshot(keepFrom: Instant): [string, number][] {
    return [...this.counts].filter(([id]) => Number(id.slice(0, id.indexOf("\u0000"))) >= keepFrom);
  }

  restore(entries: readonly (readonly [string, number])[]): void {
    this.counts.clear();
    for (const [id, count] of entries) this.counts.set(id, count);
  }

  async increment(key: string, windowStart: Instant): Promise<number> {
    const id = `${windowStart}\u0000${key}`;
    const next = (this.counts.get(id) ?? 0) + 1;
    this.counts.set(id, next);
    this.onChange?.();
    return next;
  }
}
