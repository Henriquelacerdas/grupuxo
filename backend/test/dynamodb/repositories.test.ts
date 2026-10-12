import { repositoryContract } from "../contract/repositories.ts";
import { dynamoEnvironment, inMemoryEnvironment } from "./environment.ts";

repositoryContract("em memória", async (world, state) => inMemoryEnvironment(world, state));
repositoryContract("DynamoDB", async (world, state) => dynamoEnvironment(world, state));
