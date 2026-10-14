import { dynamoApiEnv, inMemoryApiEnv } from "./api-support.ts";
import { houseRoutes } from "./api-routes-house.ts";
import { roomRoutes } from "./api-routes-rooms.ts";
import { occurrenceRoutes } from "./api-routes-occurrences.ts";
import { taskRoutes } from "./api-routes-tasks.ts";

// As mesmas rotas, no adaptador em memória e no DynamoDB (cliente falso, escrita dividida ligada).
houseRoutes("em memória", inMemoryApiEnv);
houseRoutes("DynamoDB", dynamoApiEnv);
roomRoutes("em memória", inMemoryApiEnv);
roomRoutes("DynamoDB", dynamoApiEnv);
taskRoutes("em memória", inMemoryApiEnv);
taskRoutes("DynamoDB", dynamoApiEnv);
occurrenceRoutes("em memória", inMemoryApiEnv);
occurrenceRoutes("DynamoDB", dynamoApiEnv);
