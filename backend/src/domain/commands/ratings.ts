import { at, lastWhere } from "../arrays.ts";
import type { Instant } from "../dates.ts";
import {
  isCurrentMember, RATING_LEVELS, RATING_TAGS, tagMatchesLevel, type Room, type RoomRating, type RoomRatingLevel, type RoomRatingTag,
  type RoomScheduleVersion,
} from "../entities.ts";
import { DomainError } from "../errors.ts";
import type { HouseID, RoomID, UserID } from "../ids.ts";
import type { StoreState } from "../store-state.ts";
import { schedulingFor, type CommandContext } from "./context.ts";

// Avaliar a semana e Resumo da semana (docs/DESIGN.md, docs/PRODUTO.md). Cada morador avalia, uma vez, os cômodos cujo
// ciclo acabou e de que não cuidou; a janela para avaliar vai do fim do ciclo até 2 dias depois ("Termina terça"). O
// resultado só sai com 2 ou mais avaliações **ou** quando a janela fecha, é só o agregado (nível e tags marcadas por ao
// menos duas pessoas) e só quem cuidou do cômodo o vê. Quem avaliou nunca sai do servidor.

/** Dias, depois do fim do ciclo, em que ainda dá para avaliar (e em que o resultado sai mesmo com 1 voto). */
export const RATING_WINDOW_DAYS = 2;
/** Avaliações mínimas para o resultado sair antes de a janela fechar. */
export const MIN_RATINGS_FOR_RESULT = 2;
/** Uma tag só aparece no resultado se pelo menos duas pessoas a marcaram (sem nomes nem contagem). */
export const MIN_VOTES_PER_TAG = 2;

export interface RatedPeriod {
  readonly room: Room;
  readonly periodStart: Instant;
  readonly periodEnd: Instant;
  /** Fim da janela: depois dele não se avalia mais e o resultado já pode sair. */
  readonly windowEnd: Instant;
  /** Quem cuidou do cômodo nesse ciclo (não avalia; vê o resultado). */
  readonly responsibleIDs: readonly UserID[];
}

export interface PendingRating {
  readonly roomID: RoomID;
  readonly roomName: string;
  readonly periodStart: Instant;
  readonly periodEnd: Instant;
  readonly windowEnd: Instant;
}

export interface RatingResult {
  readonly roomID: RoomID;
  readonly roomName: string;
  readonly periodStart: Instant;
  readonly periodEnd: Instant;
  readonly level: RoomRatingLevel;
  readonly tags: readonly RoomRatingTag[];
}

export interface RatingInput {
  readonly periodStart: Instant;
  readonly level: RoomRatingLevel;
  readonly tags: readonly RoomRatingTag[];
}

const LEVEL_SCORE: Readonly<Record<RoomRatingLevel, number>> = { needsWork: 1, good: 2, great: 3 };

/** Quem cuida do cômodo no ciclo `period` segundo a versão da escala em vigor (ordem de ID). */
export function responsibleAt(version: RoomScheduleVersion | undefined, period: number): UserID[] {
  if (version === undefined || version.queue.length === 0) return [];
  const users = new Set<UserID>();
  for (let role = 0; role < version.responsibleCount; role++) {
    const slot = (period - version.periodIndex) * version.responsibleCount + role;
    users.add(at(version.queue, slot % version.queue.length));
  }
  return [...users].sort();
}

/** O ciclo que acabou mais recentemente (o anterior ao de `date`), ou `null` se o cômodo ainda está no primeiro. */
export function lastEndedPeriod(ctx: CommandContext, state: StoreState, room: Room, date: Instant): RatedPeriod | null {
  if (room.calendarAnchor === null || room.scheduleVersions.length === 0) return null;
  const scheduling = schedulingFor(ctx, state, room.houseID);
  const current = scheduling.periodIndex(room, date);
  if (current < 1) return null; // ainda no primeiro ciclo: nada terminou
  const previous = current - 1;
  const periodStart = scheduling.addingWeeks(previous * room.periodicity.intervalWeeks, room.calendarAnchor);
  const periodEnd = scheduling.addingWeeks(room.periodicity.intervalWeeks, periodStart);
  const windowEnd = scheduling.adding("day", RATING_WINDOW_DAYS, periodEnd);
  const version = lastWhere(room.scheduleVersions, (v) => v.effectiveAt <= periodStart);
  return { room, periodStart, periodEnd, windowEnd, responsibleIDs: responsibleAt(version, previous) };
}

/** O ciclo que ainda dá para avaliar em `date` (dentro da janela depois do fim do ciclo). */
function ratedPeriod(ctx: CommandContext, state: StoreState, room: Room, date: Instant): RatedPeriod | null {
  const period = lastEndedPeriod(ctx, state, room, date);
  return period === null || date >= period.windowEnd ? null : period;
}

/** Cômodos que o morador enxerga: todos os comuns da casa e os privados de que participa. */
function visibleRooms(state: StoreState, houseID: HouseID, userID: UserID): Room[] {
  if (!state.houseMemberships.some((m) => m.houseID === houseID && m.userID === userID)) throw new DomainError("entityNotFound");
  return state.rooms
    .filter((r) => r.houseID === houseID)
    .filter((r) => r.visibility === "common" || state.roomMemberships.some((m) => m.roomID === r.id && m.userID === userID && isCurrentMember(m)))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Cômodos cujo ciclo acabou, que o morador pode avaliar (não cuidou deles) e ainda não avaliou. */
export function pendingRatings(ctx: CommandContext, state: StoreState, houseID: HouseID, userID: UserID, date: Instant): PendingRating[] {
  const result: PendingRating[] = [];
  for (const room of visibleRooms(state, houseID, userID)) {
    const period = ratedPeriod(ctx, state, room, date);
    if (period === null || period.responsibleIDs.length === 0 || period.responsibleIDs.includes(userID)) continue;
    if (state.roomRatings.some((r) => r.roomID === room.id && r.periodStart === period.periodStart && r.raterID === userID)) continue;
    result.push({ roomID: room.id, roomName: room.name, periodStart: period.periodStart, periodEnd: period.periodEnd, windowEnd: period.windowEnd });
  }
  return result;
}

/** Grava (ou refaz, dentro da janela) a avaliação do morador. Fora da janela, cômodo errado ou quem cuidou: `taskUnavailable`. */
export function rateRoom(
  ctx: CommandContext, state: StoreState, roomID: RoomID, userID: UserID, input: RatingInput, date: Instant,
): void {
  const room = state.rooms.find((r) => r.id === roomID);
  if (room === undefined) throw new DomainError("entityNotFound");
  const visible = visibleRooms(state, room.houseID, userID);
  if (!visible.some((r) => r.id === roomID)) throw new DomainError("entityNotFound");
  const period = ratedPeriod(ctx, state, room, date);
  if (
    period === null || period.periodStart !== input.periodStart || period.responsibleIDs.length === 0 ||
    period.responsibleIDs.includes(userID)
  ) {
    throw new DomainError("taskUnavailable");
  }
  if (
    !RATING_LEVELS.includes(input.level) ||
    !input.tags.every((tag) => RATING_TAGS.includes(tag) && tagMatchesLevel(tag, input.level))
  ) {
    throw new DomainError("invalidRating");
  }
  const tags = RATING_TAGS.filter((tag) => input.tags.includes(tag)); // ordem do catálogo, sem repetição
  const rating: RoomRating = { roomID, periodStart: period.periodStart, raterID: userID, level: input.level, tags, ratedAt: date };
  state.roomRatings = [
    ...state.roomRatings.filter((r) => !(r.roomID === roomID && r.periodStart === period.periodStart && r.raterID === userID)),
    rating,
  ];
}

/** Agrega as avaliações de um ciclo: nível médio arredondado e tags marcadas por ao menos duas pessoas. */
export function aggregateRatings(ratings: readonly RoomRating[]): { level: RoomRatingLevel; tags: RoomRatingTag[] } | null {
  if (ratings.length === 0) return null;
  const average = ratings.reduce((sum, r) => sum + LEVEL_SCORE[r.level], 0) / ratings.length;
  const level = RATING_LEVELS.find((candidate) => LEVEL_SCORE[candidate] === Math.min(3, Math.max(1, Math.round(average)))) ?? "good";
  const tags = RATING_TAGS.filter((tag) => ratings.filter((r) => r.tags.includes(tag)).length >= MIN_VOTES_PER_TAG);
  return { level, tags: [...tags] };
}

/**
 * Resumo da semana de quem cuidou dos cômodos: o ciclo que acabou, com o resultado já liberado (2 ou mais avaliações
 * ou janela fechada). Vale para o ciclo mais recente de cada cômodo, até o fim do ciclo seguinte.
 */
export function ratingSummary(ctx: CommandContext, state: StoreState, houseID: HouseID, userID: UserID, date: Instant): RatingResult[] {
  const result: RatingResult[] = [];
  for (const room of visibleRooms(state, houseID, userID)) {
    const period = lastEndedPeriod(ctx, state, room, date);
    if (period === null || !period.responsibleIDs.includes(userID)) continue;
    const ratings = state.roomRatings.filter((r) => r.roomID === room.id && r.periodStart === period.periodStart);
    if (ratings.length < MIN_RATINGS_FOR_RESULT && date < period.windowEnd) continue;
    const aggregate = aggregateRatings(ratings);
    if (aggregate === null) continue;
    result.push({
      roomID: room.id, roomName: room.name, periodStart: period.periodStart, periodEnd: period.periodEnd,
      level: aggregate.level, tags: aggregate.tags,
    });
  }
  return result;
}
