//
//  db.ts
//  
//
//  Created by Erika Hacimoto on 07/10/26.
//

import { DynamoDBClient, CreateTableCommand } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({ region: "us-east-1" });

async function createHouseholdTable() {
    const params = {
        TableName: "HouseholdApp",
        KeySchema: [
            { AttributeName: "PK", KeyType: "HASH" }, // Partition Key
            { AttributeName: "SK", KeyType: "RANGE" }  // Sort Key
        ],
        AttributeDefinitions: [
            { AttributeName: "PK", AttributeType: "S" },
            { AttributeName: "SK", AttributeType: "S" }
        ],
        BillingMode: "PAY_PER_REQUEST" // Pagamento por uso (Serverless)
    };

    try {
        const command = new CreateTableCommand(params);
        await client.send(command);
        console.log("Tabela 'HouseholdApp' criada com sucesso!");
    } catch (error) {
        if (error.name === "ResourceInUseException") {
            console.log("Aviso: A tabela 'HouseholdApp' já existe.");
        } else {
            console.error("Erro ao criar a tabela:", error);
        }
    }
}

createHouseholdTable();
