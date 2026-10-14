import { repositoryContract } from "../contract/repositories.ts";
import { dynamoEnvironment, inMemoryEnvironment } from "./environment.ts";

repositoryContract("em memória", async (world, state, codes) => inMemoryEnvironment(world, state, codes));
repositoryContract("DynamoDB", async (world, state, codes) => dynamoEnvironment(world, state, undefined, codes));
