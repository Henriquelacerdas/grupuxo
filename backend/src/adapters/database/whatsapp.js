import { GetCommand, PutCommand, DeleteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { WhatsAppLinkError } from "../../whatsapp/ports.ts"; // Ajuste o caminho se necessário

export class DynamoWhatsAppLinkStore {
  constructor(dbClient) {
    // Recebe o cliente do DynamoDB (DynamoDBDocumentClient) já instanciado
    this.db = dbClient;
  }

  async linkForPhone(phoneE164) {
    // Nota: Como o phoneE164 não é a chave primária,
    // isso exige um GSI (Global Secondary Index) chamado 'PhoneIndex' na sua tabela.
    const params = {
      TableName: "HouseholdApp",
      IndexName: "PhoneIndex",
      KeyConditionExpression: "phoneE164 = :phone",
      ExpressionAttributeValues: {
        ":phone": phoneE164
      }
    };

    const result = await this.db.send(new QueryCommand(params));
    if (!result.Items || result.Items.length === 0) return null;
    
    const item = result.Items[0];
    return {
      userID: item.userID,
      phoneE164: item.phoneE164,
      consentedAt: item.consentedAt,
      linkedAt: item.linkedAt
    };
  }

  async linkForUser(userID) {
    const params = {
      TableName: "HouseholdApp",
      Key: {
        PK: `USER#${userID}`,
        SK: "WHATSAPP#LINK"
      }
    };

    const result = await this.db.send(new GetCommand(params));
    if (!result.Item) return null;

    return {
      userID: result.Item.userID,
      phoneE164: result.Item.phoneE164,
      consentedAt: result.Item.consentedAt,
      linkedAt: result.Item.linkedAt
    };
  }

  async create(link) {
    try {
      const params = {
        TableName: "HouseholdApp",
        Item: {
          PK: `USER#${link.userID}`,
          SK: "WHATSAPP#LINK",
          userID: link.userID,
          phoneE164: link.phoneE164,
          consentedAt: link.consentedAt,
          linkedAt: link.linkedAt
        },
        // Garante que não vai sobrescrever se já existir um registro para este usuário
        ConditionExpression: "attribute_not_exists(PK)"
      };

      await this.db.send(new PutCommand(params));
    } catch (error) {
      // Equivalente ao tratamento de erro de chave única do Postgres,
      // mas adaptado para a exceção condicional do DynamoDB
      if (error.name === 'ConditionalCheckFailedException') {
        throw new WhatsAppLinkError({ code: 'userAlreadyLinked' });
      }
      throw error;
    }
  }

  async remove(userID) {
    const params = {
      TableName: "HouseholdApp",
      Key: {
        PK: `USER#${userID}`,
        SK: "WHATSAPP#LINK"
      }
    };

    await this.db.send(new DeleteCommand(params));
  }
}
