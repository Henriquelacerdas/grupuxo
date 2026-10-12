// Definição da tabela como dado puro (sem SDK): referência para o Terraform (`infra/`) e para um futuro script
// guardado contra o DynamoDB Local. Nada aqui cria tabela; criar, alterar ou apagar a tabela real exige
// autorização explícita (CLAUDE.md). Modelo de itens: docs/BACKEND.md seção 4.

export const TABLE_DEFINITION = {
  /** `grupuxo-dev`, `grupuxo-prod`: o nome vem de `TABLE_NAME`, uma tabela por ambiente. */
  billingMode: "PAY_PER_REQUEST",
  keySchema: [
    { attributeName: "PK", keyType: "HASH" },
    { attributeName: "SK", keyType: "RANGE" },
  ],
  attributeDefinitions: [
    { attributeName: "PK", attributeType: "S" },
    { attributeName: "SK", attributeType: "S" },
    { attributeName: "GSI1PK", attributeType: "S" },
    { attributeName: "GSI1SK", attributeType: "S" },
  ],
  globalSecondaryIndexes: [
    {
      indexName: "GSI1",
      keySchema: [
        { attributeName: "GSI1PK", keyType: "HASH" },
        { attributeName: "GSI1SK", keyType: "RANGE" },
      ],
      projection: "ALL",
    },
  ],
  /** Época Unix em **segundos**; o TTL só limpa, a lógica nunca depende dele. */
  ttlAttribute: "ttl",
} as const;
