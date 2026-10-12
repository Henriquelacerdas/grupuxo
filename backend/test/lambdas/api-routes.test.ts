import { dynamoApiEnv, inMemoryApiEnv } from "./api-support.ts";
import { houseRoutes } from "./api-routes-house.ts";
import { roomRoutes } from "./api-routes-rooms.ts";

// As mesmas rotas, no adaptador em memória e no DynamoDB (cliente falso, escrita dividida ligada).
houseRoutes("em memória", inMemoryApiEnv);
houseRoutes("DynamoDB", dynamoApiEnv);
roomRoutes("em memória", inMemoryApiEnv);
roomRoutes("DynamoDB", dynamoApiEnv);
