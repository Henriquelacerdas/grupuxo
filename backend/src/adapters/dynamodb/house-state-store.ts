import { DomainError } from "../../domain/errors.ts";
import type { House } from "../../domain/entities.ts";
import { userID, type HouseID, type UserID } from "../../domain/ids.ts";
import { cloneStoreState, emptyStoreState, type StoreState } from "../../domain/store-state.ts";
import {
  MAX_BATCH_GET_KEYS, MAX_TRANSACT_ACTIONS, DynamoConditionFailedError, DynamoTransactionCanceledError, queryAll,
  type DynamoClient, type DynamoItem, type DynamoKey, type DynamoTransactAction, type DynamoValue,
} from "./client.ts";
import {
  decodeAbsence, decodeAssignment, decodeDefinition, decodeHouse, decodeHouseMembership, decodeNotification,
  decodeOccurrence, decodeRoom, decodeRoomMembership, decodeSwap, decodeUser, encodeAbsence, encodeAssignment,
  encodeDefinition, encodeHouse, encodeHouseMembership, encodeNotification, encodeOccurrence, encodeRoom,
  encodeRoomMembership, encodeSwap, encodeUser, houseIDFromGSISK,
} from "./codec.ts";
import { DynamoStoreError } from "./errors.ts";
import {
  ACCESS_CODE_SK, GSI1, META_SK, PROFILE_SK, SK_PREFIX, accessCodePK, housePK, lookupPK, userPK,
} from "./keys.ts";
import { isList, isRecord, str } from "./reader.ts";

/** Relógio e aleatoriedade injetados: o adaptador não usa `setTimeout` nem `Math.random` globais. */
export interface DynamoRuntime {
  sleep(milliseconds: number): Promise<void>;
  /** Em [0, 1). */
  random(): number;
}

/** Tentativas por comando antes de desistir de um conflito de `version` (BACKEND.md seção 4). */
export const MAX_ATTEMPTS = 3;
const MAX_JITTER_MS = 50;
const SEED_PARALLELISM = 25;

export type LookupKind = keyof typeof lookupPK;

/** O que fazer com um comando que gera mais ações do que cabem numa transação (BACKEND.md seção 4). */
export type OversizedWrites = "fail" | "split";

export interface HouseStateStoreOptions {
  /**
   * `fail` (padrão): falha fechado, sem gravar (`tooManyWrites`). `split`: divide a escrita em várias transações
   * (atalho provisório do TestFlight, PLANO.md seção 2): a primeira leva o `META` condicionado a `version`; se uma
   * transação seguinte falhar, a casa fica pela metade (`partialWrite`).
   */
  readonly oversizedWrites?: OversizedWrites;
}

/** Opções de `update`. */
export interface UpdateOptions {
  /**
   * Perfis a carregar mesmo que a casa ainda não os cite (quem está entrando): o perfil existe na tabela, então
   * não vira um `Put` novo e o comando de domínio o encontra em `state.users`.
   */
  readonly extraProfileIDs?: readonly UserID[];
}

interface LoadedHouse {
  /** `false` se a partição não tem o item `META` (casa inexistente). */
  readonly exists: boolean;
  readonly version: number;
  readonly state: StoreState;
  /** Itens da partição, **re-codificados** do estado lido (comparação canônica), por `SK`. */
  readonly baseline: ReadonlyMap<string, DynamoItem>;
  readonly profileIDs: ReadonlySet<UserID>;
}

function equalValues(a: DynamoValue | undefined, b: DynamoValue | undefined): boolean {
  if (a === b) return true;
  if (isList(a)) return isList(b) && a.length === b.length && a.every((value, index) => equalValues(value, b[index]));
  if (!isRecord(a) || !isRecord(b)) return false;
  const left = Object.keys(a);
  return left.length === Object.keys(b).length && left.every((key) => Object.hasOwn(b, key) && equalValues(a[key], b[key]));
}

function referencedUserIDs(state: StoreState): Set<UserID> {
  const ids = new Set<UserID>();
  for (const m of state.houseMemberships) ids.add(m.userID);
  for (const m of state.roomMemberships) ids.add(m.userID);
  for (const a of state.assignments) ids.add(a.userID);
  for (const s of state.taskSwapRequests) { ids.add(s.requesterID); ids.add(s.receiverID); }
  for (const n of state.notifications) ids.add(n.recipientUserID);
  for (const o of state.occurrences) {
    if (o.completedByUserID !== null) ids.add(o.completedByUserID);
    for (const key of Object.keys(o.completionDebtImpacts ?? {})) ids.add(userID(key));
  }
  for (const d of state.definitions) {
    for (const id of d.rotationQueue) ids.add(id);
    for (const id of d.pendingRotation?.queue ?? []) ids.add(id);
  }
  for (const r of state.rooms) for (const v of r.scheduleVersions) for (const id of v.queue) ids.add(id);
  return ids;
}

/** Itens da partição da casa (tudo menos o `META` e os perfis, que são globais). */
function encodePartition(houseID: HouseID, state: StoreState): Map<string, DynamoItem> {
  const items = new Map<string, DynamoItem>();
  const add = (item: DynamoItem): void => {
    items.set(str(item, "SK"), item);
  };
  for (const m of state.houseMemberships) {
    if (m.houseID !== houseID) throw new DynamoStoreError("unsupportedChange");
    add(encodeHouseMembership(m));
  }
  for (const r of state.rooms) {
    if (r.houseID !== houseID) throw new DynamoStoreError("unsupportedChange");
    add(encodeRoom(r));
  }
  for (const m of state.roomMemberships) add(encodeRoomMembership(houseID, m));
  for (const d of state.definitions) add(encodeDefinition(houseID, d));
  for (const o of state.occurrences) add(encodeOccurrence(houseID, o));
  for (const a of state.assignments) add(encodeAssignment(houseID, a));
  for (const s of state.taskSwapRequests) add(encodeSwap(houseID, s));
  for (const n of state.notifications) add(encodeNotification(houseID, n));
  for (const a of state.absences) add(encodeAbsence(houseID, a));
  return items;
}

/**
 * Divide as ações em transações de até `MAX_TRANSACT_ACTIONS`. O `META` (ação 0) fica na primeira, e os `Put`
 * condicionais de perfil novo vêm logo depois dele, para que uma condição violada falhe antes de qualquer
 * gravação. Sem excesso, devolve uma só transação, na ordem original.
 */
function splitTransactions(actions: readonly DynamoTransactAction[]): DynamoTransactAction[][] {
  if (actions.length <= MAX_TRANSACT_ACTIONS) return [[...actions]];
  const [meta, ...others] = actions;
  const isNewProfile = (action: DynamoTransactAction): boolean =>
    action.kind === "put" && action.item["SK"] === PROFILE_SK && action.condition !== undefined;
  const ordered = [...(meta === undefined ? [] : [meta]), ...others.filter(isNewProfile), ...others.filter((a) => !isNewProfile(a))];
  return chunks(ordered, MAX_TRANSACT_ACTIONS);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

/**
 * Carrega o estado de uma casa, executa um comando de domínio sobre uma cópia e grava só a diferença, com
 * bloqueio otimista por `version` (BACKEND.md seção 4, "Concorrência e transações"). Nenhuma regra de negócio
 * mora aqui: o comando é o mesmo que o `InMemoryStore.update` executa.
 */
export class HouseStateStore {
  private readonly client: DynamoClient;
  private readonly runtime: DynamoRuntime;
  private readonly oversizedWrites: OversizedWrites;

  constructor(client: DynamoClient, runtime: DynamoRuntime, options: HouseStateStoreOptions = {}) {
    this.client = client;
    this.runtime = runtime;
    this.oversizedWrites = options.oversizedWrites ?? "fail";
  }

  /** Leitura consistente; nunca grava. */
  async read<T>(houseID: HouseID, fn: (state: StoreState) => T): Promise<T> {
    const loaded = await this.load(houseID, []);
    return fn(cloneStoreState(loaded.state));
  }

  /**
   * Transação por cópia: `fn` recebe um rascunho do estado e pode lançar (nada é gravado). Sem diferença, nada é
   * gravado. Conflito de `version` recarrega e repete, até `MAX_ATTEMPTS`; esgotado, `DynamoStoreError("conflict")`.
   * Acima de 100 ações: `tooManyWrites` (padrão) ou, com `oversizedWrites: "split"`, várias transações em sequência
   * (só o conflito na primeira repete; falha depois dela é `partialWrite`). Se o comando tira a casa do estado
   * (o último morador saiu), apaga a partição inteira e o `ACCESSCODE#` (veja `deletion`).
   */
  async update<T>(houseID: HouseID, fn: (draft: StoreState) => T, options: UpdateOptions = {}): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
      const loaded = await this.load(houseID, options.extraProfileIDs ?? []);
      const draft = cloneStoreState(loaded.state);
      const result = fn(draft);
      const { actions, deletesHouse } = this.diff(houseID, loaded, draft);
      if (actions.length === 0) return result;
      if (!loaded.exists) throw new DomainError("entityNotFound");
      // Excluir a casa sempre pode dividir: a primeira transação apaga o `META` e o resto fica inerte (veja `deletion`).
      if (actions.length > MAX_TRANSACT_ACTIONS && this.oversizedWrites === "fail" && !deletesHouse) {
        throw new DynamoStoreError("tooManyWrites");
      }
      const [first = [], ...rest] = splitTransactions(actions);
      try {
        await this.client.transactWrite(first);
      } catch (error) {
        // A ação 0 é sempre o `META` condicionado a `version`: só a falha dela é conflito de concorrência.
        const conflict = error instanceof DynamoTransactionCanceledError && error.reasons[0] === "ConditionalCheckFailed";
        if (!conflict) throw error;
        if (attempt >= MAX_ATTEMPTS) throw new DynamoStoreError("conflict");
        await this.runtime.sleep(Math.floor(this.runtime.random() * MAX_JITTER_MS * attempt));
        continue;
      }
      // A primeira transação (com o `META`) já foi aplicada: daqui em diante não há como repetir nem desfazer.
      for (const batch of rest) {
        try {
          await this.client.transactWrite(batch);
        } catch {
          throw new DynamoStoreError("partialWrite");
        }
      }
      return result;
    }
  }

  /** Casa de uma entidade pelo ID, via `GSI1` (eventualmente consistente: uma segunda busca antes de desistir). */
  async houseOf(kind: LookupKind, id: string): Promise<HouseID> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const items = await queryAll(this.client, {
        indexName: GSI1, keyCondition: "#pk = :pk", names: { "#pk": "GSI1PK" }, values: { ":pk": lookupPK[kind](id) },
        consistentRead: false, scanForward: true,
      });
      const first = items[0];
      if (first !== undefined) return houseIDFromGSISK(str(first, "GSI1SK"));
      if (attempt === 1) await this.runtime.sleep(Math.floor(this.runtime.random() * MAX_JITTER_MS));
    }
    throw new DomainError("entityNotFound");
  }

  /** Carga inicial de uma casa (desenvolvimento e testes): o mesmo caminho condicional de `createHouse`. */
  async seedHouse(state: StoreState): Promise<void> {
    await this.createHouse(state);
  }

  /**
   * Grava uma casa nova (`state` com exatamente uma casa, a do `META`, e tudo o que ela tem). É o único caminho que
   * cria uma casa, porque `update` exige o `META`. Falha cedo se o ID ou o código de acesso já existirem
   * (`houseExists`, `accessCodeTaken`). Os itens entram em lotes de 25 e a casa só "aparece" (`META` com
   * `version = 0` + `ACCESSCODE#`, numa transação condicional) no fim; uma falha no meio deixa itens órfãos,
   * inertes até a casa ser publicada, e repetir a carga os sobrescreve. Perfis de `state.users` entram só se
   * ainda não existirem (os de moradores com conta já estão na tabela).
   */
  async createHouse(state: StoreState): Promise<void> {
    const house = state.houses[0];
    if (state.houses.length !== 1 || house === undefined) throw new DynamoStoreError("unsupportedChange");
    const pk = housePK(house.id);
    if (await this.client.get({ key: { PK: pk, SK: META_SK }, consistentRead: true }) !== undefined) {
      throw new DynamoStoreError("houseExists");
    }
    if (await this.client.get({ key: { PK: accessCodePK(house.accessCode), SK: ACCESS_CODE_SK }, consistentRead: true }) !== undefined) {
      throw new DynamoStoreError("accessCodeTaken");
    }
    for (const batch of chunks(state.users, SEED_PARALLELISM)) {
      await Promise.all(batch.map((user) => this.putProfileIfAbsent(user)));
    }
    for (const batch of chunks([...encodePartition(house.id, state).values()], SEED_PARALLELISM)) {
      await Promise.all(batch.map((item) => this.client.put({ item })));
    }
    try {
      await this.client.transactWrite([
        { kind: "put", item: encodeHouse(house, 0), condition: "attribute_not_exists(PK)" },
        {
          kind: "put", item: { PK: accessCodePK(house.accessCode), SK: ACCESS_CODE_SK, houseID: house.id },
          condition: "attribute_not_exists(PK)",
        },
      ]);
    } catch (error) {
      if (error instanceof DynamoTransactionCanceledError) {
        throw new DynamoStoreError(error.reasons[0] === "ConditionalCheckFailed" ? "houseExists" : "accessCodeTaken");
      }
      throw error;
    }
  }

  private async putProfileIfAbsent(user: StoreState["users"][number]): Promise<void> {
    try {
      await this.client.put({ item: encodeUser(user), condition: "attribute_not_exists(PK)" });
    } catch (error) {
      if (!(error instanceof DynamoConditionFailedError)) throw error;
    }
  }

  private diff(houseID: HouseID, loaded: LoadedHouse, draft: StoreState): { actions: DynamoTransactAction[]; deletesHouse: boolean } {
    const house = loaded.state.houses[0];
    if (loaded.exists && house !== undefined && draft.houses.length === 0) {
      return { actions: this.deletion(houseID, house, loaded, draft), deletesHouse: true };
    }
    return { actions: this.changes(houseID, loaded, draft), deletesHouse: false };
  }

  /**
   * Exclusão da casa: o comando tem de ter tirado tudo da partição e não pode ter mexido em perfis. Ordem: `META`
   * (condicionado a `version`, ação 0 como em toda escrita), `ACCESSCODE#` (o código fica livre), participações (o
   * `GSI1` deixa de mostrar a casa aos moradores) e o resto. Tudo cabe na primeira transação numa casa pequena; se
   * não couber, as seguintes apagam o que sobrou, já inerte (nenhuma consulta enxerga itens sem o `META`), e uma
   * falha nelas é `partialWrite` com órfãos inofensivos.
   */
  private deletion(houseID: HouseID, house: House, loaded: LoadedHouse, draft: StoreState): DynamoTransactAction[] {
    if (encodePartition(houseID, draft).size > 0 || draft.users.length !== loaded.state.users.length ||
      draft.users.some((user, index) => {
        const before = loaded.state.users[index];
        return before === undefined || !equalValues(encodeUser(before), encodeUser(user));
      })) {
      throw new DynamoStoreError("unsupportedChange");
    }
    const pk = housePK(houseID);
    const keys = [...loaded.baseline.keys()];
    const isMembership = (sk: string): boolean => sk.startsWith(SK_PREFIX.membership);
    return [
      {
        kind: "delete", key: { PK: pk, SK: META_SK }, condition: "#version = :read",
        names: { "#version": "version" }, values: { ":read": loaded.version },
      },
      {
        kind: "delete", key: { PK: accessCodePK(house.accessCode), SK: ACCESS_CODE_SK }, condition: "#houseID = :house",
        names: { "#houseID": "houseID" }, values: { ":house": houseID },
      },
      ...[...keys.filter(isMembership), ...keys.filter((sk) => !isMembership(sk))]
        .map((sk): DynamoTransactAction => ({ kind: "delete", key: { PK: pk, SK: sk } })),
    ];
  }

  private changes(houseID: HouseID, loaded: LoadedHouse, draft: StoreState): DynamoTransactAction[] {
    const next = encodePartition(houseID, draft);
    const changes: DynamoTransactAction[] = [];
    for (const [sk, item] of next) {
      if (!equalValues(loaded.baseline.get(sk), item)) changes.push({ kind: "put", item });
    }
    for (const sk of loaded.baseline.keys()) {
      if (!next.has(sk)) changes.push({ kind: "delete", key: { PK: housePK(houseID), SK: sk } });
    }
    for (const user of draft.users) {
      if (loaded.profileIDs.has(user.id)) {
        const before = loaded.state.users.find((candidate) => candidate.id === user.id);
        if (before === undefined || !equalValues(encodeUser(before), encodeUser(user))) throw new DynamoStoreError("unsupportedChange");
      } else {
        changes.push({ kind: "put", item: encodeUser(user), condition: "attribute_not_exists(PK)" });
      }
    }
    const before = loaded.state.houses[0];
    const after = draft.houses[0];
    if (loaded.exists) {
      // Os comandos não alteram a casa em si; se um dia alterarem, o modelo precisa saber persisti-lo.
      if (before === undefined || after === undefined || draft.houses.length !== 1 ||
        !equalValues(encodeHouse(before, 0), encodeHouse(after, 0))) {
        throw new DynamoStoreError("unsupportedChange");
      }
    }
    if (changes.length === 0 || before === undefined) return changes;
    // `META` primeiro: o motivo da ação 0 diferencia conflito de `version` de qualquer outra condição.
    const meta: DynamoTransactAction = {
      kind: "put", item: encodeHouse(before, loaded.version + 1), condition: "#version = :read",
      names: { "#version": "version" }, values: { ":read": loaded.version },
    };
    return [meta, ...changes];
  }

  private async load(houseID: HouseID, extraProfileIDs: readonly UserID[]): Promise<LoadedHouse> {
    const items = await queryAll(this.client, {
      keyCondition: "#pk = :pk", names: { "#pk": "PK" }, values: { ":pk": housePK(houseID) },
      consistentRead: true, scanForward: true,
    });
    const state = emptyStoreState();
    let house: House | undefined;
    let version = 0;
    for (const item of items) {
      const sk = str(item, "SK");
      if (sk === META_SK) {
        const decoded = decodeHouse(item);
        house = decoded.house;
        version = decoded.version;
        state.houses.push(decoded.house);
      } else if (sk.startsWith(SK_PREFIX.membership)) state.houseMemberships.push(decodeHouseMembership(item, houseID));
      else if (sk.startsWith(SK_PREFIX.roomMembership)) state.roomMemberships.push(decodeRoomMembership(item));
      else if (sk.startsWith(SK_PREFIX.room)) state.rooms.push(decodeRoom(item, houseID));
      else if (sk.startsWith(SK_PREFIX.definition)) state.definitions.push(decodeDefinition(item));
      else if (sk.startsWith(SK_PREFIX.occurrence)) state.occurrences.push(decodeOccurrence(item));
      else if (sk.startsWith(SK_PREFIX.assignment)) state.assignments.push(decodeAssignment(item));
      else if (sk.startsWith(SK_PREFIX.swap)) state.taskSwapRequests.push(decodeSwap(item));
      else if (sk.startsWith(SK_PREFIX.notification)) state.notifications.push(decodeNotification(item));
      else if (sk.startsWith(SK_PREFIX.absence)) state.absences.push(decodeAbsence(item));
    }
    const wanted = [...new Set([...referencedUserIDs(state), ...extraProfileIDs])].sort();
    const profiles = await this.loadProfiles(wanted);
    state.users.push(...profiles);
    return {
      exists: house !== undefined, version, state, baseline: encodePartition(houseID, state),
      profileIDs: new Set(profiles.map((user) => user.id)),
    };
  }

  private async loadProfiles(ids: readonly UserID[]): Promise<StoreState["users"]> {
    const users: StoreState["users"] = [];
    for (const batch of chunks(ids, MAX_BATCH_GET_KEYS)) {
      const keys: DynamoKey[] = batch.map((id) => ({ PK: userPK(id), SK: PROFILE_SK }));
      const items = await this.client.batchGet(keys);
      for (const item of items) users.push(decodeUser(item));
    }
    return users.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
}

