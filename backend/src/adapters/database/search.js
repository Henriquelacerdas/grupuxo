import { PutCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "./db.js";

//moradores da casa
async function getHouseMembers(houseId) {
    const params = {
        TableName: "HouseholdApp",
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
            ":pk": `HOUSE#${houseId}`,
            ":skPrefix": "MEMBER#"
        }
    };

    const response = await db.send(new QueryCommand(params));
    return response.Items; // Retorna a lista com todos os moradores da casa de uma só vez!
}

//usuario da casa
async function getUserProfile(userId) {
    const params = {
        TableName: "HouseholdApp",
        Key: {
            PK: `USER#${userId}`,
            SK: "METADATA"
        }
    };

    const response = await db.send(new GetCommand(params));
    return response.Item; // Retorna o perfil completo do utilizador e o house_id dele
}

//tarefas de um comodo
async function getTasksByRoom(roomId) {
    const params = {
        TableName: "HouseholdApp",
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
            ":pk": `ROOM#${roomId}`,
            ":skPrefix": "TASK#"
        }
    };

    const response = await db.send(new QueryCommand(params));
    return response.Items; // Retorna todas as tarefas daquele cômodo de uma só vez!
}

//moradores do quarto
async function getUsersInRoom(roomId) {
    const params = {
        TableName: "HouseholdApp",
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
            ":pk": `ROOM#${roomId}`,
            ":skPrefix": "MEMBER#"
        }
    };

    const response = await db.send(new QueryCommand(params));
    return response.Items; // Retorna todos os usuários daquele cômodo de uma vez só!
}

//historico de ocorrencia de tarefas
async function getTaskOccurrences(taskId) {
    const params = {
        TableName: "HouseholdApp",
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
            ":pk": `TASK#${taskId}`,
            ":skPrefix": "OCCURRENCE#"
        }
    };

    const response = await db.send(new QueryCommand(params));
    return response.Items; // Retorna todas as ocorrências/histórico daquela tarefa
}

//balaco de pesos
async function getHouseFairnessBalances(houseId) {
    const params = {
        TableName: "HouseholdApp",
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
            ":pk": `HOUSE#${houseId}`,
            ":skPrefix": "FAIRNESS#"
        }
    };

    const response = await db.send(new QueryCommand(params));
    return response.Items; // Retorna a lista com o saldo de justiça de cada membro da casa
}

//historico de ferias de um usuario
async function getUserVacations(userId) {
    const params = {
        TableName: "HouseholdApp",
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
            ":skPrefix": "VACATION#"
        }
    };

    const response = await db.send(new QueryCommand(params));
    return response.Items; // Retorna todos os períodos de férias daquele usuário
}

//notificacoes de um usuario
async function getUserNotifications(userId) {
    const params = {
        TableName: "HouseholdApp",
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
            ":pk": `USER#${userId}`,
            ":skPrefix": "NOTIFICATION#"
        },
        ScanIndexForward: false // Opcional: traz as mais recentes primeiro se o SK incluir o timestamp
    };

    const response = await db.send(new QueryCommand(params));
    return response.Items; // Retorna a lista de notificações daquele usuário
}

//avaliacoes do comodo
async function getRoomPermissions(roomId) {
    const params = {
        TableName: "HouseholdApp",
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
            ":pk": `ROOM#${roomId}`,
            ":skPrefix": "PERMISSION#"
        }
    };

    const response = await db.send(new QueryCommand(params));
    return response.Items; // Retorna todas as avaliações daquele cômodo
}

//fila de uma tarefa
async function getTaskQueueSlots(taskId) {
    const params = {
        TableName: "HouseholdApp",
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
            ":pk": `TASK#${taskId}`,
            ":skPrefix": "SLOT#"
        }
    };

    const response = await db.send(new QueryCommand(params));
    return response.Items; // Retorna todos os slots e posições da fila daquela tarefa
}

export { getHouseMembers, getUserProfile, getTasksByRoom, getUsersInRoom, getTaskOccurrences, getHouseFairnessBalances, getUserVacations, getUserNotifications, getRoomPermissions, getTaskQueueSlots }
