import Foundation
import GrupuxoDomain

// Repositórios do domínio sobre a `api`. Os parâmetros `requestedBy`/`requesting`/`at` são ignorados de propósito: o
// servidor usa o usuário do token e o próprio relógio (BACKEND.md seção 6.1). Operações sem rota lançam
// `APIError.unsupported` (moradores sem conta, edição de tarefa e exclusão de avulsa); as telas que dependem delas
// ficam escondidas neste build.

extension UUID {
    /// O servidor só reconhece UUID em minúsculo nos caminhos.
    var apiString: String { uuidString.lowercased() }
}

struct RemoteHouseRepository: HouseRepository {
    let api: APIClient

    func addMember(name: String, to houseID: House.ID, requestedBy: User.ID, at date: Date) async throws -> User {
        throw APIError.unsupported
    }

    func removeMember(
        userID: User.ID, from houseID: House.ID, requestedBy: User.ID, at date: Date, confirmRoomDeletion: Bool
    ) async throws {
        throw APIError.unsupported
    }

    func house(id: House.ID) async throws -> House {
        let mine = try await api.get(MyHouseDTO.self, "v1/me/house")
        guard mine.house.id == id else { throw DomainError.entityNotFound }
        return mine.house.domain
    }

    func houses(for userID: User.ID) async throws -> [House] {
        do {
            return [try await api.get(MyHouseDTO.self, "v1/me/house").house.domain]
        } catch let error as APIError where error.code == "no_house" {
            return []
        }
    }

    func members(in houseID: House.ID) async throws -> [User] {
        let mine = try await api.get(MyHouseDTO.self, "v1/me/house")
        guard mine.house.id == houseID else { throw DomainError.entityNotFound }
        return mine.members.map(\.domain)
    }

    func memberIDs(in houseID: House.ID) async throws -> [User.ID] {
        try await members(in: houseID).map(\.id)
    }
}

struct RemoteRoomRepository: RoomRepository {
    let api: APIClient

    func participation(in roomID: Room.ID, requesting userID: User.ID, at date: Date) async throws -> RoomParticipation {
        try await api.get(RoomParticipationDTO.self, "v1/rooms/\(roomID.apiString)").domain
    }

    func room(id: Room.ID, requesting userID: User.ID) async throws -> Room {
        try await participation(in: id, requesting: userID, at: .now).room
    }

    func rooms(in houseID: House.ID, requesting userID: User.ID) async throws -> [Room] {
        let mine = try await api.get(MyHouseDTO.self, "v1/me/house")
        guard mine.house.id == houseID else { throw DomainError.entityNotFound }
        return mine.rooms.map(\.domain)
    }

    func create(_ room: Room, memberships: [RoomMembership]) async throws -> Room {
        let body = CreateRoomBody(
            name: room.name, visibility: room.visibility, category: room.category,
            periodicity: PeriodicityDTO(room.periodicity), responsibleCount: room.responsibleCount,
            icon: room.icon, color: room.color,
            participantIDs: room.visibility == .privateRoom ? memberships.map { $0.userID.apiString } : nil
        )
        return try await api.post(RoomDTO.self, "v1/houses/\(room.houseID.apiString)/rooms", body: body).domain
    }
}

/// O servidor acha uma tarefa pelo cômodo (`/v1/rooms/{roomID}/tasks/{taskID}`), mas os casos de uso só têm o ID
/// da tarefa. Guardamos o cômodo de cada tarefa já listada.
actor TaskRoomIndex {
    private var rooms: [TaskDefinition.ID: Room.ID] = [:]

    func remember(_ items: [TaskItem]) {
        for item in items { rooms[item.definition.id] = item.definition.roomID }
    }

    func remember(_ definition: TaskDefinition) {
        rooms[definition.id] = definition.roomID
    }

    func room(of taskID: TaskDefinition.ID) throws -> Room.ID {
        guard let room = rooms[taskID] else { throw DomainError.entityNotFound }
        return room
    }
}

struct RemoteTaskRepository: TaskRepository {
    let api: APIClient
    let index = TaskRoomIndex()

    func tasks(for userID: User.ID, in houseID: House.ID) async throws -> [TaskItem] {
        try await items(from: "v1/me/tasks")
    }

    func tasks(in roomID: Room.ID, requesting userID: User.ID) async throws -> [TaskItem] {
        try await items(from: "v1/rooms/\(roomID.apiString)/tasks")
    }

    func sporadicTasks(in houseID: House.ID, requesting userID: User.ID) async throws -> [TaskItem] {
        try await items(from: "v1/me/sporadic-tasks")
    }

    func taskDefinition(id: TaskDefinition.ID, requesting userID: User.ID) async throws -> TaskDefinition {
        let roomID = try await index.room(of: id)
        let definition = try await api.get(
            TaskDefinitionDTO.self, "v1/rooms/\(roomID.apiString)/tasks/\(id.apiString)"
        ).domain()
        await index.remember(definition)
        return definition
    }

    func updateTaskDetails(
        id: TaskDefinition.ID, name: String, details: String, requestedBy userID: User.ID
    ) async throws -> TaskDefinition {
        throw APIError.unsupported
    }

    func endTask(_ taskID: TaskDefinition.ID, requestedBy userID: User.ID, at date: Date) async throws {
        let roomID = try await index.room(of: taskID)
        try await api.send("POST", "v1/rooms/\(roomID.apiString)/tasks/\(taskID.apiString)/end")
    }

    func deleteSporadicTask(id: TaskDefinition.ID, requestedBy userID: User.ID) async throws {
        throw APIError.unsupported
    }

    func create(_ definition: TaskDefinition, requestedBy userID: User.ID, at date: Date) async throws -> TaskDefinition {
        let body = CreateTaskBody(
            name: definition.name, details: definition.details, effort: definition.effort.points,
            kind: definition.kind, recurrence: RecurrenceDTO(definition.recurrence),
            assignmentPolicy: definition.assignmentPolicy
        )
        let created = try await api.post(
            TaskDefinitionDTO.self, "v1/rooms/\(definition.roomID.apiString)/tasks", body: body
        ).domain()
        await index.remember(created)
        return created
    }

    /// O servidor replaneja a escala sozinho a cada mudança.
    func refreshSchedule(in houseID: House.ID, at date: Date) async throws {}

    func addMember(userID: User.ID, to roomID: Room.ID, at date: Date) async throws {
        try await api.send("POST", "v1/rooms/\(roomID.apiString)/members", body: RoomMemberBody(userID: userID.apiString))
    }

    func removeMember(userID: User.ID, from roomID: Room.ID, at date: Date, confirmDeletion: Bool) async throws {
        try await api.send(
            "DELETE", "v1/rooms/\(roomID.apiString)/members/\(userID.apiString)",
            query: confirmDeletion ? ["confirmDeletion": "true"] : [:]
        )
    }

    func complete(occurrenceID: TaskOccurrence.ID, by userID: User.ID, at date: Date) async throws {
        try await api.send("POST", "v1/occurrences/\(occurrenceID.apiString)/complete")
    }

    func reopen(occurrenceID: TaskOccurrence.ID, by userID: User.ID) async throws {
        try await api.send("POST", "v1/occurrences/\(occurrenceID.apiString)/reopen")
    }

    func claim(occurrenceID: TaskOccurrence.ID, by userID: User.ID, at date: Date) async throws {
        try await api.send("POST", "v1/occurrences/\(occurrenceID.apiString)/claim")
    }

    func release(occurrenceID: TaskOccurrence.ID, by userID: User.ID) async throws {
        try await api.send("POST", "v1/occurrences/\(occurrenceID.apiString)/release")
    }

    private func items(from path: String) async throws -> [TaskItem] {
        let items = try await api.get(TaskListDTO.self, path).tasks.map { try $0.domain() }
        await index.remember(items)
        return items
    }
}

struct RemoteTaskSwapRepository: TaskSwapRepository {
    let api: APIClient

    func swapCandidates(
        for requesterID: User.ID, offering offeredOccurrenceID: TaskOccurrence.ID, in houseID: House.ID, at date: Date
    ) async throws -> [TaskItem] {
        try await api.get(TaskListDTO.self, "v1/occurrences/\(offeredOccurrenceID.apiString)/swap-candidates")
            .tasks.map { try $0.domain() }
    }

    func createRequest(
        requesterID: User.ID, offeredOccurrenceID: TaskOccurrence.ID, requestedOccurrenceID: TaskOccurrence.ID, at date: Date
    ) async throws -> TaskSwapRequest {
        let body = CreateSwapBody(
            offeredOccurrenceID: offeredOccurrenceID.apiString, requestedOccurrenceID: requestedOccurrenceID.apiString
        )
        return try await api.post(TaskSwapRequestDTO.self, "v1/swaps", body: body).domain
    }

    func incomingRequests(for userID: User.ID, in houseID: House.ID) async throws -> [TaskSwapRequest] {
        try await api.get(MySwapsDTO.self, "v1/me/swaps").incoming.map(\.domain)
    }

    func outgoingRequests(for userID: User.ID, in houseID: House.ID) async throws -> [TaskSwapRequest] {
        try await api.get(MySwapsDTO.self, "v1/me/swaps").outgoing.map(\.domain)
    }

    func accept(requestID: TaskSwapRequest.ID, by userID: User.ID, at date: Date) async throws -> TaskSwapRequest {
        try await api.post(TaskSwapRequestDTO.self, "v1/swaps/\(requestID.apiString)/accept").domain
    }

    func reject(requestID: TaskSwapRequest.ID, by userID: User.ID, at date: Date) async throws -> TaskSwapRequest {
        try await api.post(TaskSwapRequestDTO.self, "v1/swaps/\(requestID.apiString)/reject").domain
    }
}

struct RemoteNotificationRepository: NotificationRepository {
    let api: APIClient

    func notifications(for userID: User.ID) async throws -> [AppNotification] {
        try await api.get(NotificationListDTO.self, "v1/me/notifications").notifications
            .map { $0.domain(recipientUserID: userID) }
    }

    func markAsRead(notificationID: AppNotification.ID, by userID: User.ID, at date: Date) async throws {
        try await api.send("POST", "v1/notifications/\(notificationID.apiString)/read")
    }
}

struct RemoteWhatsAppConnectionRepository: WhatsAppConnectionRepository {
    let api: APIClient

    func connection() async throws -> WhatsAppConnection? {
        let status = try await api.get(WhatsAppStatusDTO.self, "v1/me/whatsapp")
        guard status.linked, let phone = status.phone, let linkedAt = status.linkedAt else { return nil }
        return WhatsAppConnection(maskedPhone: phone, linkedAt: linkedAt)
    }

    func createInvitation() async throws -> WhatsAppInvitation {
        do {
            let invitation = try await api.post(WhatsAppInvitationDTO.self, "v1/me/whatsapp/link")
            return WhatsAppInvitation(url: invitation.url, expiresAt: invitation.expiresAt)
        } catch let error as APIError where error.code == "already_linked" {
            throw WhatsAppConnectionError.alreadyLinked
        }
    }

    func disconnect() async throws {
        try await api.send("DELETE", "v1/me/whatsapp")
    }
}
