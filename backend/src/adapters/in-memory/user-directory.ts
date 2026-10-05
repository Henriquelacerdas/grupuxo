import type { CognitoSub } from "../../auth/token-verifier.ts";
import { UserDirectoryError, parseProfileName, type UserDirectory, type UserProfile } from "../../auth/user-directory.ts";
import { userID, type IDGenerator, type UserID } from "../../domain/ids.ts";
import type { InMemoryStore } from "./store.ts";

/**
 * Diretório em memória. O morador criado entra em `StoreState.users`, a mesma lista que o domínio lê (no
 * PostgreSQL, a mesma tabela `users`); só o mapa `cognito_sub → UserID` é daqui. Em JavaScript cada método
 * roda sem intercalar, então verificar e gravar (sem `await` no meio) é atômico, como o `ON CONFLICT` será.
 */
export class InMemoryUserDirectory implements UserDirectory {
  private readonly store: InMemoryStore;
  private readonly newID: IDGenerator;
  private readonly bySub = new Map<CognitoSub, UserID>();

  /** `known`: contas que já existem (seed de desenvolvimento), cujos moradores já estão no `store`. */
  constructor(store: InMemoryStore, newID: IDGenerator, known: Iterable<readonly [CognitoSub, UserID]> = []) {
    this.store = store;
    this.newID = newID;
    for (const [sub, id] of known) this.bySub.set(sub, id);
  }

  async userForSub(cognitoSub: CognitoSub): Promise<UserID | null> {
    return this.bySub.get(cognitoSub) ?? null;
  }

  async ensureUser(cognitoSub: CognitoSub, profile: UserProfile): Promise<UserID> {
    if (parseProfileName(profile.name) !== profile.name) throw new UserDirectoryError("invalidProfile");
    const existing = this.bySub.get(cognitoSub);
    if (existing !== undefined) return existing;
    const id = userID(this.newID());
    this.store.update((state) => {
      state.users.push({ id, name: profile.name, email: null });
    });
    this.bySub.set(cognitoSub, id);
    return id;
  }
}
