import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateRatings } from "../src/domain/commands/ratings.ts";
import type { RoomRating, RoomRatingLevel, RoomRatingTag } from "../src/domain/entities.ts";
import { roomID, userID } from "../src/domain/ids.ts";
import { uuid } from "./support/world.ts";

const room = roomID(uuid(1));
const rating = (n: number, level: RoomRatingLevel, tags: readonly RoomRatingTag[] = []): RoomRating => ({
  roomID: room, periodStart: 0, raterID: userID(uuid(100 + n)), level, tags, ratedAt: 0,
});

test("sem avaliações não há resultado", () => {
  assert.equal(aggregateRatings([]), null);
});

test("o nível é a média arredondada dos três níveis", () => {
  assert.equal(aggregateRatings([rating(1, "great"), rating(2, "great")])?.level, "great");
  assert.equal(aggregateRatings([rating(1, "needsWork"), rating(2, "needsWork"), rating(3, "good")])?.level, "needsWork");
  assert.equal(aggregateRatings([rating(1, "good"), rating(2, "great"), rating(3, "great")])?.level, "great");
  assert.equal(aggregateRatings([rating(1, "needsWork"), rating(2, "great")])?.level, "good", "empate vai para o meio");
});

test("toda tag marcada aparece, na ordem do catálogo, sem repetição e sem contagem", () => {
  const result = aggregateRatings([
    rating(1, "good", ["onTime", "spotless"]),
    rating(2, "good", ["spotless", "tidy", "onTime"]),
    rating(3, "good", ["careful"]),
  ]);
  assert.deepEqual(result?.tags, ["spotless", "tidy", "onTime", "careful"]);
  assert.deepEqual(aggregateRatings([rating(1, "good", ["spotless"])])?.tags, ["spotless"], "uma voz já vira tag");
  assert.deepEqual(aggregateRatings([rating(1, "good"), rating(2, "great")])?.tags, [], "sem tags marcadas, sem tags");
});
