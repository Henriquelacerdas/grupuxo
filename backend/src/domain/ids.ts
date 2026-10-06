declare const brand: unique symbol;

/** Tipo nominal: impede passar, por exemplo, um `RoomID` onde se espera um `UserID`. */
export type Brand<Base, Name extends string> = Base & { readonly [brand]: Name };

export type UserID = Brand<string, "UserID">;
export type HouseID = Brand<string, "HouseID">;
export type HouseMembershipID = Brand<string, "HouseMembershipID">;
export type RoomID = Brand<string, "RoomID">;
export type RoomMembershipID = Brand<string, "RoomMembershipID">;
export type TaskDefinitionID = Brand<string, "TaskDefinitionID">;
export type TaskOccurrenceID = Brand<string, "TaskOccurrenceID">;
export type TaskAssignmentID = Brand<string, "TaskAssignmentID">;
export type AbsenceID = Brand<string, "AbsenceID">;
export type TaskSwapRequestID = Brand<string, "TaskSwapRequestID">;
export type NotificationID = Brand<string, "NotificationID">;

/** Gerador de IDs injetado (no servidor, `crypto.randomUUID`; nos testes, sequencial). */
export type IDGenerator = () => string;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Normaliza (minúsculo) e valida um UUID. É o único ponto que "promove" uma `string` a ID nominal. */
export function parseID<Name extends string>(value: string): Brand<string, Name> {
  const normalized = value.toLowerCase();
  if (!UUID_PATTERN.test(normalized)) throw new TypeError(`UUID inválido: ${value}`);
  return normalized as Brand<string, Name>;
}

export const userID = (value: string): UserID => parseID<"UserID">(value);
export const houseID = (value: string): HouseID => parseID<"HouseID">(value);
export const houseMembershipID = (value: string): HouseMembershipID => parseID<"HouseMembershipID">(value);
export const roomID = (value: string): RoomID => parseID<"RoomID">(value);
export const roomMembershipID = (value: string): RoomMembershipID => parseID<"RoomMembershipID">(value);
export const taskDefinitionID = (value: string): TaskDefinitionID => parseID<"TaskDefinitionID">(value);
export const taskOccurrenceID = (value: string): TaskOccurrenceID => parseID<"TaskOccurrenceID">(value);
export const taskAssignmentID = (value: string): TaskAssignmentID => parseID<"TaskAssignmentID">(value);
export const absenceID = (value: string): AbsenceID => parseID<"AbsenceID">(value);
export const taskSwapRequestID = (value: string): TaskSwapRequestID => parseID<"TaskSwapRequestID">(value);
export const notificationID = (value: string): NotificationID => parseID<"NotificationID">(value);

/** Ordem por texto do UUID, usada em todo desempate do algoritmo (equivale a `uuidString <` do Swift). */
export function compareIDs(a: string, b: string): -1 | 0 | 1 {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortedIDs<T extends string>(ids: Iterable<T>): T[] {
  return [...ids].sort(compareIDs);
}

/** Remove duplicatas preservando a primeira ocorrência. */
export function uniqueIDs<T extends string>(ids: Iterable<T>): T[] {
  return [...new Set(ids)];
}

/** Leitura segura de dicionários indexados por ID (sem tocar no protótipo). */
export function lookup<V>(record: Readonly<Record<string, V>>, key: string): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

/** Remove `readonly` de primeiro nível: "rascunho" de uma entidade, equivalente ao `var` + `inout` do Swift. */
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
