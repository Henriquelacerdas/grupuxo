import type { Instant } from "../../domain/dates.ts";
import type { UserID } from "../../domain/ids.ts";
import type { PendingActionStore, PendingCompletion } from "../../whatsapp/ports.ts";

/**
 * Pedidos pendentes em memória. Sem `await` entre ler e gravar, cada operação é atômica (como o `UpdateItem`
 * condicional do DynamoDB será). Pedidos vencidos não são apagados: aceitável em dev e testes; no DynamoDB o
 * `ttl` os remove, e a validade é decidida pela condição `expiresAt > at`, nunca pela presença do item.
 */
export class InMemoryPendingActionStore implements PendingActionStore {
  private readonly byUser = new Map<UserID, PendingCompletion>();
  /** Chamado depois de cada mudança (persistência local). */
  onChange: (() => void) | null = null;

  snapshot(): PendingCompletion[] {
    return [...this.byUser.values()];
  }

  restore(pendings: readonly PendingCompletion[]): void {
    this.byUser.clear();
    for (const pending of pendings) this.byUser.set(pending.userID, pending);
  }

  async save(pending: PendingCompletion): Promise<void> {
    this.byUser.set(pending.userID, { ...pending, confirmedByWamid: null });
    this.onChange?.();
  }

  async confirm(userID: UserID, wamid: string, at: Instant): Promise<PendingCompletion | null> {
    const pending = this.byUser.get(userID);
    if (pending === undefined || !(pending.expiresAt > at)) return null;
    if (pending.confirmedByWamid !== null && pending.confirmedByWamid !== wamid) return null;
    const confirmed: PendingCompletion = { ...pending, confirmedByWamid: wamid };
    this.byUser.set(userID, confirmed);
    this.onChange?.();
    return confirmed;
  }

  async discard(userID: UserID): Promise<void> {
    this.byUser.delete(userID);
    this.onChange?.();
  }
}
