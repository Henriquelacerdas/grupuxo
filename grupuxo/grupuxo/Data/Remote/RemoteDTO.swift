import Foundation
import GrupuxoDomain

// Formato JSON da `api` (BACKEND.md seção 6.1; exemplos executáveis em `backend/test/fixtures/api/`).
// O servidor não expõe campos internos do agendamento: o app preenche os padrões do domínio.

struct UserDTO: Decodable, Sendable {
    let id: UUID
    let name: String

    var domain: User { User(id: id, name: name, email: nil) }
}

struct HouseDTO: Decodable, Sendable {
    let id: UUID
    let name: String
    let accessCode: String
    let timezone: String
    let createdAt: Date

    var domain: House { House(id: id, name: name, accessCode: accessCode, createdAt: createdAt) }
}

struct PeriodicityDTO: Codable, Sendable {
    let executionsPerPeriod: Int
    let intervalWeeks: Int

    init(_ value: WeeklyPeriodicity) {
        executionsPerPeriod = value.executionsPerPeriod
        intervalWeeks = value.intervalWeeks
    }

    var domain: WeeklyPeriodicity {
        WeeklyPeriodicity(executionsPerPeriod: executionsPerPeriod, intervalWeeks: intervalWeeks)
    }
}

struct RoomDTO: Decodable, Sendable {
    let id: UUID
    let houseID: UUID
    let name: String
    let kind: RoomKind
    let category: RoomCategory
    let visibility: RoomVisibility
    let periodicity: PeriodicityDTO
    let responsibleCount: Int
    let calendarAnchor: Date?
    let icon: String
    let color: RoomColor

    var domain: Room {
        Room(
            id: id, houseID: houseID, name: name, kind: kind, category: category, visibility: visibility,
            periodicity: periodicity.domain, responsibleCount: responsibleCount, calendarAnchor: calendarAnchor,
            icon: icon, color: color
        )
    }
}

struct MyHouseDTO: Decodable, Sendable {
    let house: HouseDTO
    let members: [UserDTO]
    let rooms: [RoomDTO]
}

struct RoomParticipationDTO: Decodable, Sendable {
    let room: RoomDTO
    let isMember: Bool
    let memberCount: Int
    let responsibleNames: [String]
    let periodStart: Date
    let periodEnd: Date

    var domain: RoomParticipation {
        RoomParticipation(
            room: room.domain, isMember: isMember, memberCount: memberCount,
            responsibleNames: responsibleNames, periodStart: periodStart, periodEnd: periodEnd
        )
    }
}

/// `{ kind: "none" }`, `{ kind: "recurring", frequency, interval }` ou `{ kind: "weekly", periodicity }`.
struct RecurrenceDTO: Codable, Sendable {
    let kind: String
    let frequency: RecurrenceFrequency?
    let interval: Int?
    let periodicity: PeriodicityDTO?

    init(_ policy: RecurrencePolicy) {
        switch policy {
        case .none:
            (kind, frequency, interval, periodicity) = ("none", nil, nil, nil)
        case let .recurring(frequency, interval):
            (kind, self.frequency, self.interval, periodicity) = ("recurring", frequency, interval, nil)
        case let .weekly(value):
            (kind, frequency, interval, periodicity) = ("weekly", nil, nil, PeriodicityDTO(value))
        }
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(kind, forKey: .kind)
        try values.encodeIfPresent(frequency, forKey: .frequency)
        try values.encodeIfPresent(interval, forKey: .interval)
        try values.encodeIfPresent(periodicity, forKey: .periodicity)
    }

    var domain: RecurrencePolicy? {
        switch kind {
        // `RecurrencePolicy.none` explícito: um `.none` solto viraria `Optional.none`.
        case "none": RecurrencePolicy.none
        case "recurring":
            if let frequency, let interval { .recurring(frequency: frequency, interval: interval) } else { nil }
        case "weekly":
            periodicity.map { .weekly($0.domain) }
        default: nil
        }
    }
}

struct TaskDefinitionDTO: Decodable, Sendable {
    let id: UUID
    let roomID: UUID
    let name: String
    let details: String
    let effort: Int
    let kind: TaskKind
    let recurrence: RecurrenceDTO
    let assignmentPolicy: TaskAssignmentPolicy
    let calendarAnchor: Date?
    let endedAt: Date?

    func domain() throws -> TaskDefinition {
        guard let recurrence = recurrence.domain else { throw APIError.invalidResponse }
        return TaskDefinition(
            id: id, roomID: roomID, name: name, details: details, effort: TaskEffort(points: effort),
            kind: kind, recurrence: recurrence, assignmentPolicy: assignmentPolicy,
            calendarAnchor: calendarAnchor, endedAt: endedAt
        )
    }
}

struct TaskOccurrenceDTO: Decodable, Sendable {
    let id: UUID
    let taskDefinitionID: UUID
    let availableAt: Date
    let dueAt: Date?
    let status: TaskOccurrenceStatus
    let completedAt: Date?
    let completedByUserID: UUID?
    let effort: Int

    var domain: TaskOccurrence {
        TaskOccurrence(
            id: id, taskDefinitionID: taskDefinitionID, availableAt: availableAt, dueAt: dueAt, status: status,
            completedAt: completedAt, completedByUserID: completedByUserID, effortSnapshot: TaskEffort(points: effort)
        )
    }
}

struct TaskAssignmentDTO: Decodable, Sendable {
    let id: UUID
    let userID: UUID
    let assignedAt: Date
    let endedAt: Date?

    func domain(occurrenceID: UUID) -> TaskAssignment {
        TaskAssignment(id: id, occurrenceID: occurrenceID, userID: userID, assignedAt: assignedAt, endedAt: endedAt)
    }
}

struct TaskItemDTO: Decodable, Sendable {
    let definition: TaskDefinitionDTO
    let occurrence: TaskOccurrenceDTO
    let assignment: TaskAssignmentDTO?
    let assignee: UserDTO?
    let suggestedAssignee: UserDTO?

    func domain() throws -> TaskItem {
        TaskItem(
            definition: try definition.domain(),
            occurrence: occurrence.domain,
            assignment: assignment?.domain(occurrenceID: occurrence.id),
            assignee: assignee?.domain,
            suggestedAssignee: suggestedAssignee?.domain
        )
    }
}

struct TaskListDTO: Decodable, Sendable {
    let tasks: [TaskItemDTO]
}

struct TaskSwapRequestDTO: Decodable, Sendable {
    let id: UUID
    let requesterID: UUID
    let receiverID: UUID
    let offeredOccurrenceID: UUID
    let requestedOccurrenceID: UUID
    let status: TaskSwapRequestStatus
    let createdAt: Date
    let resolvedAt: Date?

    var domain: TaskSwapRequest {
        TaskSwapRequest(
            id: id, requesterID: requesterID, receiverID: receiverID, offeredOccurrenceID: offeredOccurrenceID,
            requestedOccurrenceID: requestedOccurrenceID, status: status, createdAt: createdAt, resolvedAt: resolvedAt
        )
    }
}

struct MySwapsDTO: Decodable, Sendable {
    let incoming: [TaskSwapRequestDTO]
    let outgoing: [TaskSwapRequestDTO]
}

struct NotificationDTO: Decodable, Sendable {
    let id: UUID
    let kind: AppNotificationKind
    let swapRequestID: UUID
    let createdAt: Date
    let readAt: Date?

    /// O destinatário é sempre quem chamou: o servidor não repete o id.
    func domain(recipientUserID: User.ID) -> AppNotification {
        AppNotification(
            id: id, recipientUserID: recipientUserID, kind: kind, swapRequestID: swapRequestID,
            createdAt: createdAt, readAt: readAt
        )
    }
}

struct NotificationListDTO: Decodable, Sendable {
    let notifications: [NotificationDTO]
}

struct RegisteredAccountDTO: Decodable, Sendable {
    let id: UUID
}

struct WhatsAppStatusDTO: Decodable, Sendable {
    let linked: Bool
    let phone: String?
    let linkedAt: Date?
}

struct WhatsAppInvitationDTO: Decodable, Sendable {
    let url: URL
    let expiresAt: Date
}

// MARK: - Corpos das requisições

struct RegisterAccountBody: Encodable, Sendable { let name: String }

struct CreateHouseBody: Encodable, Sendable {
    let name: String
    let timezone: String
}

struct JoinHouseBody: Encodable, Sendable { let code: String }

struct CreateRoomBody: Encodable, Sendable {
    let name: String
    let visibility: RoomVisibility
    let category: RoomCategory
    let periodicity: PeriodicityDTO
    let responsibleCount: Int
    let icon: String
    let color: RoomColor
    /// Só vale em cômodo privado.
    let participantIDs: [String]?
}

struct CreateTaskBody: Encodable, Sendable {
    let name: String
    let details: String
    let effort: Int
    let kind: TaskKind
    let recurrence: RecurrenceDTO
    let assignmentPolicy: TaskAssignmentPolicy
}

struct RoomMemberBody: Encodable, Sendable { let userID: String }

struct CreateSwapBody: Encodable, Sendable {
    let offeredOccurrenceID: String
    let requestedOccurrenceID: String
}
