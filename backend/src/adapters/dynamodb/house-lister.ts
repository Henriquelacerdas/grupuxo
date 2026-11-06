import type { HouseID } from "../../domain/ids.ts";
import type { DynamoClient, DynamoItem } from "./client.ts";
import { houseIDFromPK } from "./codec.ts";
import { META_SK } from "./keys.ts";
import { str } from "./reader.ts";

/** Lista todas as casas (itens `META`) por varredura filtrada. Só a tarefa agendada usa: nunca o caminho do app. */
export async function listHouseIDs(client: DynamoClient): Promise<HouseID[]> {
  const ids: HouseID[] = [];
  let startKey: DynamoItem | undefined;
  do {
    const page = await client.scan({
      filter: "#sk = :meta", names: { "#sk": "SK" }, values: { ":meta": META_SK }, ...(startKey === undefined ? {} : { startKey }),
    });
    for (const item of page.items) ids.push(houseIDFromPK(str(item, "PK")));
    startKey = page.lastKey;
  } while (startKey !== undefined);
  return ids.sort();
}
