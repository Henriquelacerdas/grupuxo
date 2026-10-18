// test-runner-completo.ts
import {
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand
} from "@aws-sdk/lib-dynamodb";
import { dynamoDbDocumentClient } from "./client";
import { MAIN_TABLE_NAME } from "./table-definition";
import { KeyBuilder } from "./keys";

async function runAllTests() {
  console.log("🧪 A iniciar bateria completa de testes por tipo de entrada...\n");

  const sessionId = "sessao_prod_01";
  const msgId = "msg_999";
  const phone = "+351912345678";

  // =========================================================================
  // ENTRADA 1: Inserção de Múltiplos Registos (WhatsApp + Entidade Genérica)
  // =========================================================================
  console.log("--- 1. Testando Entrada de Gravação (PutCommand) ---");
  
  const waKeys = KeyBuilder.whatsAppMessageWithSearch(
    sessionId,
    msgId,
    "STATUS",
    "entregue"
  );

  await dynamoDbDocumentClient.send(
    new PutCommand({
      TableName: MAIN_TABLE_NAME,
      Item: {
        ...waKeys,
        sender: phone,
        text: "Mensagem de teste de entrada completa",
        status: "ENVIADO",
        createdAt: new Date().toISOString()
      }
    })
  );
  console.log("✅ Mensagem gravada na tabela.");

  // =========================================================================
  // ENTRADA 2: Leitura Direta por Chave Primária (GetCommand)
  // =========================================================================
  console.log("\n--- 2. Testando Leitura Direta por ID (GetCommand) ---");

  const getResult = await dynamoDbDocumentClient.send(
    new GetCommand({
      TableName: MAIN_TABLE_NAME,
      Key: {
        PK: waKeys.PK,
        SK: waKeys.SK
      }
    })
  );
  console.log("✅ Registo obtido diretamente por PK/SK:", getResult.Item);

  // =========================================================================
  // ENTRADA 3: Consulta de Todo o Histórico de uma Sessão (Query por PK)
  // =========================================================================
  console.log("\n--- 3. Testando Leitura de Histórico da Sessão (Query Command) ---");

  const sessionHistory = await dynamoDbDocumentClient.send(
    new QueryCommand({
      TableName: MAIN_TABLE_NAME,
      KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
      ExpressionAttributeValues: {
        ":pk": `WA#SESSION#${sessionId}`,
        ":skPrefix": "MSG#"
      }
    })
  );
  console.log(`✅ ${sessionHistory.Items?.length || 0} mensagens encontradas nesta sessão.`);

  // =========================================================================
  // ENTRADA 4: Atualização Parcial de Dados (UpdateCommand)
  // =========================================================================
  console.log("\n--- 4. Testando Atualização de Estado (UpdateCommand) ---");

  const updateResultStatus = await dynamoDbDocumentClient.send(
    new UpdateCommand({
      TableName: MAIN_TABLE_NAME,
      Key: {
        PK: waKeys.PK,
        SK: waKeys.SK
      },
      UpdateExpression: "SET #st = :newStatus, updatedAt = :updatedAt",
      ExpressionAttributeNames: {
        "#st": "status"
      },
      ExpressionAttributeValues: {
        ":newStatus": "LIDO",
        ":updatedAt": new Date().toISOString()
      },
      ReturnValues: "ALL_NEW"
    })
  );
  console.log("✅ Registo atualizado com sucesso:", updateResultStatus.Attributes);

//  // =========================================================================
//  // ENTRADA 5: Remoção de Registo (DeleteCommand)
//  // =========================================================================
//  console.log("\n--- 5. Testando Remoção de Registo (DeleteCommand) ---");
//
//  await dynamoDbDocumentClient.send(
//    new DeleteCommand({
//      TableName: MAIN_TABLE_NAME,
//      Key: {
//        PK: waKeys.PK,
//        SK: waKeys.SK
//      }
//    })
//  );
//  console.log("✅ Registo apagado com sucesso.");
//
//  // Confirmar que o item já não existe
//  const verifyDelete = await dynamoDbDocumentClient.send(
//    new GetCommand({
//      TableName: MAIN_TABLE_NAME,
//      Key: {
//        PK: waKeys.PK,
//        SK: waKeys.SK
//      }
//    })
//  );
//  console.log("ℹ️ Verificação pós-remoção (deve ser undefined):", verifyDelete.Item);
    
    const keys = KeyBuilder.whatsAppMessageWithSearch("sessao_123", "msg_01", "STATUS", "ativo");
      await dynamoDbDocumentClient.send(
        new PutCommand({
          TableName: MAIN_TABLE_NAME,
          Item: {
            ...keys,
            mensagem: "Teste para visualizar no NoSQL Workbench",
            autor: "WhatsApp App"
          }
        })
      );
    
    console.log("🚀 A inserir Perfil, Casa e Quarto na Tabela Única...\n");

    const profileId = "prof_001";
    const houseId = "house_100";
    const roomId = "room_201";

    // -------------------------------------------------------------------------
    // 1. Criar Perfil de Utilizador
    // -------------------------------------------------------------------------
    const profileKeys = KeyBuilder.profile(profileId);
    const profileItem = {
        ...profileKeys,
        nome: "Carlos Silva",
        email: "carlos@exemplo.com",
        role: "ADMIN",
        GSI1_PK: "SEARCH#PROFILE",
        GSI1_SK: "carlos silva",
        createdAt: new Date().toISOString()
    };

    await dynamoDbDocumentClient.send(
        new PutCommand({ TableName: MAIN_TABLE_NAME, Item: profileItem })
    );
    console.log("✅ Perfil criado com sucesso!");

    // -------------------------------------------------------------------------
    // 2. Criar Casa
    // -------------------------------------------------------------------------
    const houseKeys = KeyBuilder.house(houseId);
    const houseItem = {
        ...houseKeys,
        nomeCasa: "Moradia da Praia",
        endereco: "Avenida Beira Mar, 123",
        proprietarioId: profileId,
        GSI1_PK: "SEARCH#HOUSE",
        GSI1_SK: "moradia da praia",
        createdAt: new Date().toISOString()
    };

    await dynamoDbDocumentClient.send(
        new PutCommand({ TableName: MAIN_TABLE_NAME, Item: houseItem })
    );
    console.log("✅ Casa criada com sucesso!");

    // -------------------------------------------------------------------------
    // 3. Criar Quarto (pertencente à Casa criada)
    // -------------------------------------------------------------------------
    const roomKeys = KeyBuilder.room(houseId, roomId);
    const roomItem = {
        ...roomKeys,
        nomeQuarto: "Suíte Principal",
        andar: 1,
        temBanheiro: true,
        GSI1_PK: "SEARCH#ROOM",
        GSI1_SK: "suite principal",
        createdAt: new Date().toISOString()
    };

    await dynamoDbDocumentClient.send(
        new PutCommand({ TableName: MAIN_TABLE_NAME, Item: roomItem })
    );
    console.log("✅ Quarto criado com sucesso!");

    // -------------------------------------------------------------------------
    // 4. BÓNUS: Consultar a Casa E TODOS os seus Quartos juntas numa só chamada
    // -------------------------------------------------------------------------
    console.log("\n🔍 A consultar a Casa e os seus Quartos (Query por PK)...");
      
    const houseWithRooms = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: MAIN_TABLE_NAME,
          KeyConditionExpression: "PK = :pk",
          ExpressionAttributeValues: {
            ":pk": `HOUSE#${houseId}`
          }
        })
    );

    console.log("✅ Dados da Casa + Quartos associados:");
    console.dir(houseWithRooms.Items, { depth: null });
    
    console.log("🚀 A testar a gestão de Tarefas na Tabela Única...\n");

    const taskId = "task_501";

    // -------------------------------------------------------------------------
    // 1. Criar uma Tarefa para a Casa / Quarto
    // -------------------------------------------------------------------------
    const taskKeys = KeyBuilder.task(houseId, taskId);
    const taskItem = {
        ...taskKeys,
        titulo: "Limpar filtro do ar condicionado",
        descricao: "Manutenção preventiva no ar condicionado da suíte",
        quartoId: roomId,
        atribuidoA: profileId,
        status: "PENDENTE", // PENDENTE | EM_ANDAMENTO | CONCLUIDA
        prioridade: "ALTA",
        dataLimite: "2026-10-25",
        // Chaves para pesquisa no índice secundário GSI1
        GSI1_PK: "SEARCH#TASK",
        GSI1_SK: "pendente#alta",
        createdAt: new Date().toISOString()
    };

    await dynamoDbDocumentClient.send(
        new PutCommand({ TableName: MAIN_TABLE_NAME, Item: taskItem })
    );
    console.log("✅ Tarefa criada com sucesso!");

    // -------------------------------------------------------------------------
    // 2. Listar APENAS as tarefas de uma Casa
    // -------------------------------------------------------------------------
    console.log(`\n🔍 A buscar todas as tarefas da Casa (${houseId})...`);

    const houseTasks = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: MAIN_TABLE_NAME,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
          ExpressionAttributeValues: {
            ":pk": `HOUSE#${houseId}`,
            ":skPrefix": "TASK#"
          }
        })
    );

    console.log(`✅ ${houseTasks.Items?.length || 0} tarefa(s) encontrada(s) na casa:`);
    console.dir(houseTasks.Items, { depth: null });

    // -------------------------------------------------------------------------
    // 3. Atualizar Estado da Tarefa (ex: marcar como CONCLUIDA)
    // -------------------------------------------------------------------------
    console.log("\n🔄 A atualizar o estado da tarefa para CONCLUIDA...");

    const updateResult = await dynamoDbDocumentClient.send(
        new UpdateCommand({
          TableName: MAIN_TABLE_NAME,
          Key: {
            PK: taskKeys.PK,
            SK: taskKeys.SK
          },
          UpdateExpression: "SET #st = :newStatus, GSI1_SK = :newGsiSk, updatedAt = :updatedAt",
          ExpressionAttributeNames: {
            "#st": "status"
          },
          ExpressionAttributeValues: {
            ":newStatus": "CONCLUIDA",
            ":newGsiSk": "concluida#alta",
            ":updatedAt": new Date().toISOString()
          },
          ReturnValues: "ALL_NEW"
        })
    );

    console.log("✅ Estado da tarefa atualizado:", updateResult.Attributes);

    // -------------------------------------------------------------------------
    // 4. Pesquisar Tarefas Concluídas no GSI1
    // -------------------------------------------------------------------------
    console.log("\n🔍 A pesquisar tarefas concluídas via GSI1...");

    const completedTasks = await dynamoDbDocumentClient.send(
        new QueryCommand({
          TableName: MAIN_TABLE_NAME,
          IndexName: "GSI1",
          KeyConditionExpression: "GSI1_PK = :pk AND begins_with(GSI1_SK, :sk)",
          ExpressionAttributeValues: {
            ":pk": "SEARCH#TASK",
            ":sk": "concluida"
          }
        })
    );

    console.log("✅ Tarefas concluídas encontradas no GSI1:", completedTasks.Items);
}

runAllTests();
