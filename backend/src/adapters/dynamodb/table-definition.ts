// Definição da tabela como dado puro (sem SDK): referência para o Terraform (`infra/`) e para um futuro script
// guardado contra o DynamoDB Local. Nada aqui cria tabela; criar, alterar ou apagar a tabela real exige
// autorização explícita (CLAUDE.md). Modelo de itens: docs/BACKEND.md seção 4.

export const MAIN_TABLE_NAME = process.env.TABLE_NAME || "SingleTableApp";

export const TableDefinition = {
  TableName: MAIN_TABLE_NAME,
  AttributeDefinitions: [
    { AttributeName: "PK", AttributeType: "S" },
    { AttributeName: "SK", AttributeType: "S" },
    { AttributeName: "GSI1_PK", AttributeType: "S" },
    { AttributeName: "GSI1_SK", AttributeType: "S" }
  ],
  KeySchema: [
    { AttributeName: "PK", KeyType: "HASH" },
    { AttributeName: "SK", KeyType: "RANGE" }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: "GSI1",
      KeySchema: [
        { AttributeName: "GSI1_PK", KeyType: "HASH" },
        { AttributeName: "GSI1_SK", KeyType: "RANGE" }
      ],
      Projection: { ProjectionType: "ALL" }
    }
  ],
  BillingMode: "PAY_PER_REQUEST"
};
