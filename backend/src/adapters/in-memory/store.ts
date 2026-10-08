import { cloneStoreState, type StoreState } from "../../domain/store-state.ts";

/**
 * Armazenamento em memória com transação por cópia: `update` trabalha numa cópia do estado e só a publica se
 * a função termina sem erro (rollback em qualquer exceção). A função é síncrona: sem `await` entre a leitura
 * e o commit, duas operações concorrentes nunca calculam sobre o mesmo snapshot desatualizado.
 * Entidades são imutáveis, então copiar os arrays basta.
 */
export class InMemoryStore {
  private state: StoreState;

  constructor(initial: StoreState) {
    this.state = cloneStoreState(initial);
  }

  /** `fn` recebe uma cópia: alterá-la não afeta o armazenamento. */
  read<T>(fn: (state: StoreState) => T): T {
    return fn(cloneStoreState(this.state));
  }

  update<T>(fn: (draft: StoreState) => T): T {
    const draft = cloneStoreState(this.state);
    const result = fn(draft);
    this.state = draft;
    return result;
  }
}
