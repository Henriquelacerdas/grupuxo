import { DynamoDBClient, CreateTableCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({
  region: "us-east-1",
  endpoint: "http://localhost:8000",
  credentials: {
    accessKeyId: "MockAccessKey",
    secretAccessKey: "MockSecretKey"
  }
});

async function createTableLocal() {
  const params = {
    TableName: "HouseholdApp",
    KeySchema: [
      { AttributeName: "PK", KeyType: "HASH" },  // Partition Key
      { AttributeName: "SK", KeyType: "RANGE" }  // Sort Key
    ],
    AttributeDefinitions: [
      { AttributeName: "PK", AttributeType: "S" },
      { AttributeName: "SK", AttributeType: "S" },
      { AttributeName: "phoneE164", AttributeType: "S" } // Necessário para o GSI do WhatsApp
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: "PhoneIndex",
        KeySchema: [
          { AttributeName: "phoneE164", KeyType: "HASH" }
        ],
        Projection: {
          ProjectionType: "ALL"
        },
        ProvisionedThroughput: {
          ReadCapacityUnits: 5,
          WriteCapacityUnits: 5
        }
      }
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5
    }
  };

  try {
    await client.send(new CreateTableCommand(params));
    console.log("Tabela 'HouseholdApp' criada com sucesso no DynamoDB Local!");
  } catch (error) {
    if (error.name === "ResourceInUseException") {
      console.log("A tabela já existe no ambiente local.");
    } else {
      console.error("Erro ao criar tabela:", error);
    }
  }
}

createTableLocal();
