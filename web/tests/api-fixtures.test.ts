import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decode, type Decoder } from "@/lib/api/decode";
import {
  definitionDecoder, houseDecoder, myHouseDecoder, notificationDecoder, participationDecoder, roomDecoder, snapshotDecoder,
  swapDecoder, taskItemDecoder,
} from "@/lib/api/types";

// Mesmo papel do `RemoteAPITests` do Swift: os exemplos gerados pelo backend (`API_FIXTURES=write npm test`)
// têm de decodificar no web. Fixture nova sem decodificador aqui também falha.
const directory = join(__dirname, "../../backend/test/fixtures/api");

const decoders: Record<string, Decoder<unknown>> = {
  "house-snapshot.json": snapshotDecoder,
  "house.json": houseDecoder,
  "me-house.json": myHouseDecoder,
  "notification.json": notificationDecoder,
  "room-participation.json": participationDecoder,
  "room.json": roomDecoder,
  "task-definition.json": definitionDecoder,
  "task-item.json": taskItemDecoder,
  "task-item-completed.json": taskItemDecoder,
  "task-item-sporadic.json": taskItemDecoder,
  "task-swap-request.json": swapDecoder,
};

describe("fixtures da api", () => {
  const files = readdirSync(directory).filter((file) => file.endsWith(".json")).sort();

  it("todas têm decodificador", () => {
    expect(files.filter((file) => decoders[file] === undefined)).toEqual([]);
  });

  for (const file of files) {
    it(`decodifica ${file}`, () => {
      const decoder = decoders[file];
      if (decoder === undefined) return;
      expect(() => decode(decoder, JSON.parse(readFileSync(join(directory, file), "utf8")))).not.toThrow();
    });
  }

  it("instantes viram milissegundos e o snapshot mantém as listas", () => {
    const snapshot = decode(snapshotDecoder, JSON.parse(readFileSync(join(directory, "house-snapshot.json"), "utf8")));
    expect(typeof snapshot.home.house.createdAt).toBe("number");
    expect(snapshot.home.house.accessCode).toMatch(/^[A-Z0-9]+$/);
    expect(Array.isArray(snapshot.myTasks)).toBe(true);
  });

  it("recusa campo de tipo errado com o caminho", () => {
    const room = JSON.parse(readFileSync(join(directory, "room.json"), "utf8"));
    expect(() => decode(roomDecoder, { ...room, responsibleCount: "2" })).toThrow(/\$\.responsibleCount/);
  });
});
