//import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
//import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
//
//const client = new DynamoDBClient({ region: "us-east-1" });
//
//// O DocumentClient facilita muito a vida para enviar objetos JSON diretamente
//export const db = DynamoDBDocumentClient.from(client);



import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const isLocal = process.env.NODE_ENV === "local";

const clientConfig = {
  region: process.env.AWS_REGION || "us-east-1"
};

// Se for ambiente local, aponta para o Docker e injeta credenciais fictícias
if (isLocal) {
  clientConfig.endpoint = "http://localhost:8000";
  clientConfig.credentials = {
    accessKeyId: "MockAccessKey",
    secretAccessKey: "MockSecretKey"
  };
}

const client = new DynamoDBClient(clientConfig);
export const db = DynamoDBDocumentClient.from(client);
