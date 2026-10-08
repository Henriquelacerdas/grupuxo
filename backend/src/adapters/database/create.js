import { PutCommand, GetCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { db } from "./db.js";

export async function createHouse(houseId, houseName, userId) {
    const params = {
        TableName: "HouseholdApp",
        Item: {
            // Aqui você define a chave no exato momento da inserção:
            PK: `HOUSE#${houseId}`,
            SK: "METADATA",
            
            // Atributos normais do seu objeto
            name: houseName,
            creator_id: userId,
            created_at: new Date().toISOString()
        }
    };

    await db.send(new PutCommand(params));
    console.log("Casa criada e gravada com sucesso!");
}

export async function createRoom(houseId, roomId, roomName) {
    const params = {
        TableName: "HouseholdApp",
        Item: {
            // O PK continua sendo o da casa para agrupá-los fisicamente
            PK: `HOUSE#${houseId}`,
            
            // O SK identifica que este item específico é um cômodo
            SK: `ROOM#${roomId}`,
            
            name: roomName,
            is_common: true,
            created_at: new Date().toISOString()
        }
    };

    await db.send(new PutCommand(params));
    console.log("Cômodo adicionado à casa!");
}

export async function createTask(roomId, taskData) {
    const timestamp = new Date().toISOString();

    const params = {
        TableName: "HouseholdApp",
        Item: {
            // Chaves na Tabela Única
            PK: `ROOM#${roomId}`,
            SK: `TASK#${taskData.id}`,

            // Atributos mapeados da tabela SQL
            name: taskData.name,
            description: taskData.description,
            recurrence: taskData.recurrence,
            effort: taskData.effort,
            periodicity: taskData.periodicity,
            is_common: taskData.is_common,
            is_active: taskData.is_active,
            icon: taskData.icon,
            color: taskData.color,
            responsible: taskData.responsible, // ID do usuário responsável
            created_at: timestamp,
            updated_at: timestamp
        }
    };

    await db.send(new PutCommand(params));
    console.log("Tarefa criada e associada ao cômodo com sucesso!");
}

export async function addUserToHouse(userData, houseId) {
    const timestamp = new Date().toISOString();

    const params = {
        TransactItems: [
            // 1. O item do Perfil do Usuário
            {
                Put: {
                    TableName: "HouseholdApp",
                    Item: {
                        PK: `USER#${userData.id}`,
                        SK: "METADATA",
                        house_id: houseId,
                        name: userData.name,
                        email: userData.email,
                        apple_user_id: userData.appleUserId,
                        created_at: timestamp,
                        updated_at: timestamp
                    }
                }
            },
            // 2. O item de Vínculo na Casa (para consultar os membros facilmente)
            {
                Put: {
                    TableName: "HouseholdApp",
                    Item: {
                        PK: `HOUSE#${houseId}`,
                        SK: `MEMBER#${userData.id}`,
                        user_name: userData.name,
                        email: userData.email,
                        joined_at: timestamp
                    }
                }
            }
        ]
    };

    try {
        // Usamos transação para garantir que ou os dois itens são salvos, ou nenhum é
        await db.send(new TransactWriteCommand(params));
        console.log("Utilizador criado e vinculado à casa com sucesso!");
    } catch (error) {
        console.error("Erro ao adicionar utilizador à casa:", error);
        throw error;
    }
}

export async function addUserToRoom(roomId, userId, membershipId) {
    const params = {
        TableName: "HouseholdApp",
        Item: {
            // Chaves na Tabela Única agrupadas pelo cômodo
            PK: `ROOM#${roomId}`,
            SK: `MEMBER#${userId}`,

            // Atributos da relação
            id: membershipId,
            user_id: userId,
            joined_at: new Date().toISOString()
        }
    };

    await db.send(new PutCommand(params));
    console.log("Usuário vinculado ao cômodo com sucesso!");
}

export async function createTaskOccurrence(taskId, occurrenceData) {
    const params = {
        TableName: "HouseholdApp",
        Item: {
            // Chaves na Tabela Única agrupadas pela tarefa pai
            PK: `TASK#${taskId}`,
            SK: `OCCURRENCE#${occurrenceData.id}`,

            // Atributos da ocorrência
            id: occurrenceData.id,
            last_due_at: occurrenceData.lastDueAt,
            last_completed_at: occurrenceData.lastCompletedAt || null,
            status: occurrenceData.status,
            sequence_number: occurrenceData.sequenceNumber
        }
    };

    await db.send(new PutCommand(params));
    console.log("Ocorrência da tarefa registrada com sucesso!");
}

export async function updateFairnessBalance(houseId, userId, balanceData) {
    const params = {
        TableName: "HouseholdApp",
        Item: {
            // Chaves na Tabela Única agrupadas pela casa e identificadas pelo usuário
            PK: `HOUSE#${houseId}`,
            SK: `FAIRNESS#${userId}`,

            // Atributos do balanço de justiça
            id: balanceData.id,
            debt: balanceData.debt,
            updated_at: new Date().toISOString()
        }
    };

    await db.send(new PutCommand(params));
    console.log("Balanço de justiça atualizado com sucesso!");
}

export async function createVacation(userId, vacationData) {
    const params = {
        TableName: "HouseholdApp",
        Item: {
            // Chaves na Tabela Única agrupadas pelo usuário
            PK: `USER#${userId}`,
            SK: `VACATION#${vacationData.id}`,

            // Atributos das férias
            id: vacationData.id,
            starts_at: vacationData.startsAt,
            ends_at: vacationData.endsAt,
            status: vacationData.status
        }
    };

    await db.send(new PutCommand(params));
    console.log("Período de férias cadastrado com sucesso!");
}

export async function createNotification(receiverId, notificationData) {
    const params = {
        TableName: "HouseholdApp",
        Item: {
            // Chaves na Tabela Única agrupadas pelo usuário receptor
            PK: `USER#${receiverId}`,
            SK: `NOTIFICATION#${notificationData.id}`,

            // Atributos da notificação
            id: notificationData.id,
            type: notificationData.type,
            messagem: notificationData.messagem,
            receiver_id: receiverId,
            created_at: notificationData.createdAt || new Date().toISOString(),
            read_at: notificationData.readAt || null
        }
    };

    await db.send(new PutCommand(params));
    console.log("Notificação criada com sucesso!");
}

export async function createRoomPermission(roomId, permissionData) {
    const params = {
        TableName: "HouseholdApp",
        Item: {
            // Chaves na Tabela Única agrupadas pelo cômodo
            PK: `ROOM#${roomId}`,
            SK: `PERMISSION#${permissionData.id}`,

            // Atributos da tabela
            id: permissionData.id,
            rating: permissionData.rating,
            submitted_at: permissionData.submittedAt || new Date().toISOString(),
            period_start: permissionData.periodStart,
            period_end: permissionData.periodEnd
        }
    };

    await db.send(new PutCommand(params));
    console.log("Permissão/Avaliação do cômodo registrada com sucesso!");
}

export async function createTaskQueueSlot(taskId, slotData) {
    const params = {
        TableName: "HouseholdApp",
        Item: {
            // Chaves na Tabela Única agrupadas pela tarefa
            PK: `TASK#${taskId}`,
            SK: `SLOT#${slotData.id}`,

            // Atributos do slot da fila
            id: slotData.id,
            position: slotData.position,
            effective_from: slotData.effectiveFrom,
            effective_to: slotData.effectiveTo
        }
    };

    await db.send(new PutCommand(params));
    console.log("Slot da fila da tarefa criado com sucesso!");
}
